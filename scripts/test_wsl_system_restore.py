import hashlib
import importlib.util
import json
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("wsl_system_restore", Path(__file__).with_name("wsl-system-restore.py"))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RestoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.home = self.root / "home"
        self.source.mkdir()
        self.home.mkdir()
        checkout = self.home / ".hermes/hermes-agent"
        checkout.mkdir(parents=True)
        subprocess.run(["git", "-C", str(checkout), "init", "-q"], check=True)
        subprocess.run(["git", "-C", str(checkout), "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                        "commit", "--allow-empty", "-qm", "pinned"], check=True)
        self.revision = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()

    def snapshot(self):
        entries = {"hermes/friday-messenger-bridge.key": b"synthetic-secret",
                   "hermes/friday-messenger-bridge-applied.sha256": b"stale-apply-marker",
                   "friday-mail/account.json": b"{}", "himalaya/config.toml": b"name = 'test'"}
        database = self.source / "friday-calendar/events.sqlite3"
        database.parent.mkdir(parents=True)
        with closing(sqlite3.connect(database)) as connection:
            connection.execute("CREATE TABLE events (name TEXT)")
            connection.execute("INSERT INTO events VALUES ('uncheckpointed')")
            connection.commit()
        for name, data in entries.items():
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        files = {file.relative_to(self.source).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
                 for file in self.source.rglob("*") if file.is_file()}
        manifest = {"version": 1, "files": files, "sqlite": ["friday-calendar/events.sqlite3"],
                    "excludedRebuildable": restore.EXCLUDED, "hermesRevision": self.revision}
        (self.source / "manifest.json").write_text(json.dumps(manifest))

    def test_imports_private_state_to_clean_pinned_home(self):
        self.snapshot()
        result = restore.import_snapshot(self.source, self.home)
        self.assertEqual(result["fileCount"], 4)
        self.assertEqual((self.home / ".hermes/friday-messenger-bridge.key").read_bytes(), b"synthetic-secret")
        self.assertFalse((self.home / ".hermes/friday-messenger-bridge-applied.sha256").exists())
        if os.name == "posix":
            self.assertEqual((self.home / ".config/friday/calendar/events.sqlite3").stat().st_mode & 0o777, 0o600)
        with closing(sqlite3.connect(self.home / ".config/friday/calendar/events.sqlite3")) as connection:
            self.assertEqual(connection.execute("SELECT name FROM events").fetchone(), ("uncheckpointed",))

    def test_rejects_existing_state_without_overwrite(self):
        self.snapshot()
        target = self.home / ".hermes/friday-messenger-bridge.key"
        target.write_text("newer")
        with self.assertRaisesRegex(ValueError, "already exists"):
            restore.import_snapshot(self.source, self.home)
        self.assertEqual(target.read_text(), "newer")
        self.assertFalse((self.home / ".config/friday/mail/account.json").exists())

    def test_rolls_back_import_only_while_files_are_unchanged(self):
        self.snapshot()
        restore.import_snapshot(self.source, self.home)
        key = self.home / ".hermes/friday-messenger-bridge.key"
        key.write_text("newer")
        with self.assertRaisesRegex(ValueError, "changed"):
            restore.rollback_snapshot(self.source, self.home)
        self.assertEqual(key.read_text(), "newer")
        key.write_bytes(b"synthetic-secret")
        result = restore.rollback_snapshot(self.source, self.home)
        self.assertEqual(result["removedFileCount"], 4)
        self.assertFalse(key.exists())
        self.assertFalse((self.home / restore.RECEIPT_NAME).exists())
        self.assertTrue((self.home / ".hermes/hermes-agent/.git").is_dir())

    def test_rejects_wrong_revision_and_tampering(self):
        self.snapshot()
        manifest = self.source / "manifest.json"
        data = json.loads(manifest.read_text())
        data["hermesRevision"] = "0" * 40
        manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "pinned revision"):
            restore.import_snapshot(self.source, self.home)
        data["hermesRevision"] = self.revision
        manifest.write_text(json.dumps(data))
        (self.source / "friday-mail/account.json").write_text("tampered")
        with self.assertRaisesRegex(ValueError, "checksum"):
            restore.import_snapshot(self.source, self.home)

    def test_rejects_unlisted_file_and_traversal(self):
        self.snapshot()
        (self.source / "extra").write_text("surprise")
        with self.assertRaisesRegex(ValueError, "inventory"):
            restore.inventory(self.source)
        (self.source / "extra").unlink()
        manifest = self.source / "manifest.json"
        data = json.loads(manifest.read_text())
        data["files"]["../escape"] = "0" * 64
        manifest.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            restore.inventory(self.source)

    def test_rolls_back_only_files_created_by_failed_import(self):
        self.snapshot()
        original = restore.digest
        checks = 0

        def fail_after_copy(path):
            nonlocal checks
            checks += 1
            if checks > 5:
                raise OSError("copy verification failed")
            return original(path)

        restore.digest = fail_after_copy
        try:
            with self.assertRaisesRegex(OSError, "copy verification failed"):
                restore.import_snapshot(self.source, self.home)
        finally:
            restore.digest = original
        self.assertTrue((self.home / ".hermes/hermes-agent/.git").is_dir())
        self.assertFalse((self.home / ".config/friday/mail/account.json").exists())
        self.assertFalse((self.home / ".hermes/friday-messenger-bridge.key").exists())


if __name__ == "__main__":
    unittest.main()
