import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("configure_wiki_path.py")


class WikiPathTests(unittest.TestCase):
    def test_status_update_clear_preserves_other_hermes_values(self):
        with tempfile.TemporaryDirectory(prefix="friday-wiki-test-") as temp:
            root = Path(temp)
            hermes = root / ".hermes"
            hermes.mkdir()
            envfile = hermes / ".env"
            envfile.write_text('OBSIDIAN_VAULT_PATH="/mnt/c/notes"\n', encoding="utf-8")
            bin_dir = root / "bin"
            bin_dir.mkdir()
            systemctl = bin_dir / "systemctl"
            systemctl.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            systemctl.chmod(0o700)
            environment = {**os.environ, "HOME": str(root), "PATH": str(bin_dir) + ":" + os.environ["PATH"]}

            def run(action, payload=None):
                result = subprocess.run([sys.executable, str(SCRIPT), action], input=json.dumps(payload) if payload else None,
                                        text=True, capture_output=True, env=environment, check=False)
                return result.returncode, json.loads(result.stdout)

            code, initial = run("status")
            self.assertEqual(code, 0)
            self.assertEqual(initial["path"], str(root / "wiki"))
            self.assertFalse(initial["configured"])
            wiki = root / "notes"
            wiki.mkdir()
            code, updated = run("update", {"path": str(wiki), "revision": initial["revision"]})
            self.assertEqual(code, 0)
            self.assertTrue(updated["configured"])
            self.assertTrue(updated["customized"])
            self.assertTrue(updated["applied"])
            self.assertIn('OBSIDIAN_VAULT_PATH="/mnt/c/notes"', envfile.read_text(encoding="utf-8"))
            self.assertIn(f'WIKI_PATH="{wiki}"', envfile.read_text(encoding="utf-8"))
            self.assertEqual(envfile.stat().st_mode & 0o777, 0o600)
            code, conflict = run("update", {"path": str(wiki), "revision": initial["revision"]})
            self.assertEqual((code, conflict["error"]), (3, "conflict"))
            code, cleared = run("update", {"path": "", "revision": updated["revision"]})
            self.assertEqual(code, 0)
            self.assertFalse(cleared["customized"])
            self.assertNotIn("WIKI_PATH=", envfile.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
