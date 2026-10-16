#!/usr/bin/env python3
"""Isolated helper check; never touches the installed Hermes home."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("configure_skill_keys.py")


class SkillKeysTest(unittest.TestCase):
    def test_write_status_remove_and_reject(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            hermes = root / ".hermes"
            hermes.mkdir()
            envfile = hermes / ".env"
            envfile.write_text("UNRELATED=kept\nNOTION_API_KEY=old-test-value\n", encoding="utf-8")
            bin_dir = root / "bin"
            bin_dir.mkdir()
            fake = bin_dir / "systemctl"
            fake.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            fake.chmod(0o700)
            environment = {**os.environ, "HOME": str(root), "PATH": str(bin_dir) + ":" + os.environ["PATH"]}

            def run(action, payload=None):
                return subprocess.run([sys.executable, str(SCRIPT), action], input=json.dumps(payload) if payload else "",
                                      text=True, capture_output=True, env=environment, check=False)

            initial = json.loads(run("status").stdout)
            self.assertTrue(initial["configured"]["NOTION_API_KEY"])
            self.assertNotIn("old-test-value", json.dumps(initial))
            saved = run("update", {"key": "AIRTABLE_API_KEY", "value": "sample-token-secret"})
            self.assertEqual(saved.returncode, 0)
            self.assertTrue(json.loads(saved.stdout)["applied"])
            self.assertNotIn("sample-token-secret", saved.stdout + saved.stderr)
            self.assertIn("UNRELATED=kept", envfile.read_text(encoding="utf-8"))
            self.assertEqual(envfile.stat().st_mode & 0o777, 0o600)
            rejected = run("update", {"key": "OPENAI_API_KEY", "value": "sample-token-secret"})
            self.assertNotEqual(rejected.returncode, 0)
            self.assertNotIn("sample-token-secret", rejected.stdout + rejected.stderr)
            removed = run("update", {"key": "AIRTABLE_API_KEY", "value": ""})
            self.assertFalse(json.loads(removed.stdout)["configured"]["AIRTABLE_API_KEY"])
            self.assertIn("UNRELATED=kept", envfile.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
