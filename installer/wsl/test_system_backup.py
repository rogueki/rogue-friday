import sqlite3
import importlib.util
import json
from contextlib import closing
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "wsl-system-backup.py"
spec = importlib.util.spec_from_file_location("wsl_system_backup", SCRIPT)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
copy_snapshot, digest, inventory = module.copy_snapshot, module.digest, module.inventory


class SystemBackupTests(unittest.TestCase):
    def test_includes_hermes_and_mail_credentials_with_sqlite_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "home"
            (home / ".hermes").mkdir(parents=True)
            (home / ".hermes" / ".env").write_text("TEST_KEY=synthetic\n")
            calendar = home / ".config" / "friday" / "calendar"
            calendar.mkdir(parents=True)
            database = calendar / "actions.sqlite"
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("CREATE TABLE journal (id TEXT PRIMARY KEY)")
                connection.execute("INSERT INTO journal VALUES ('one')")
                connection.commit()
            entries = inventory(home)
            self.assertIn("hermes/.env", [entry[1] for entry in entries])
            self.assertIn("friday-calendar/actions.sqlite", [entry[1] for entry in entries])
            output = Path(temporary) / "output"
            module.export_snapshot(entries, output)
            copied = output / "friday-calendar" / "actions.sqlite"
            with closing(sqlite3.connect(copied)) as connection:
                self.assertEqual(connection.execute("SELECT id FROM journal").fetchone(), ("one",))
            self.assertEqual(len(digest(copied)), 64)
            self.assertIn("hermes/.env", json.loads((output / "manifest.json").read_text())["files"])

    def test_rejects_linked_secret(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "home"
            (home / ".hermes").mkdir(parents=True)
            outside = Path(temporary) / "outside"
            outside.write_text("synthetic")
            try:
                (home / ".hermes" / ".env").symlink_to(outside)
            except OSError:
                self.skipTest("symlink creation unavailable")
            with self.assertRaisesRegex(ValueError, "linked"):
                inventory(home)


if __name__ == "__main__":
    unittest.main()
