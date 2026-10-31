"""configure_obsidian.py aendert nur OBSIDIAN_VAULT_PATH: Revisionskonflikt, ungueltiger Pfad, Erhalt anderer Schluessel."""
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import configure_obsidian as cfg


class ConfigureObsidianTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = Path(self.temp.name) / ".hermes" / ".env"
        self.env.parent.mkdir(parents=True)
        self.env.write_text('OPENAI_API_KEY=platzhalter\nOBSIDIAN_VAULT_PATH="/mnt/d/Alt"\nTELEGRAM_ALLOWED_USERS=1\n', encoding="utf-8")
        self.patch = patch.object(cfg, "ENV", self.env)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def run_main(self, *args):
        out = io.StringIO()
        with patch.object(sys, "argv", ["configure_obsidian.py", *args]), redirect_stdout(out):
            code = cfg.main()
        return code, (json.loads(out.getvalue()) if out.getvalue().strip() else None)

    def test_status_reports_the_current_vault_and_its_revision(self):
        code, body = self.run_main("status")
        self.assertEqual(code, 0)
        self.assertEqual(body["path"], "/mnt/d/Alt")
        self.assertEqual(body["revision"], cfg.revision("/mnt/d/Alt"))
        self.assertTrue(body["configured"])
        self.assertFalse(body["readable"])

    def test_stale_revision_is_a_conflict_and_changes_nothing(self):
        before = self.env.read_bytes()
        code, body = self.run_main("set", str(cfg.revision("/mnt/d/Anders")), "/mnt/d/Neu")
        self.assertEqual(code, 3)
        self.assertEqual(body, {"error": "conflict"})
        self.assertEqual(self.env.read_bytes(), before)

    def test_unsafe_or_unreadable_vault_is_rejected(self):
        before = self.env.read_bytes()
        rev = str(cfg.revision("/mnt/d/Alt"))
        for path in ("/home/owner/vault", '/mnt/d/Vault"x', "/mnt/d/Vault\nEVIL=1", "/mnt/d/gibt-es-nicht"):
            code, body = self.run_main("set", rev, path)
            self.assertEqual(code, 4, path)
            self.assertEqual(body, {"error": "invalid_vault"})
        self.assertEqual(self.env.read_bytes(), before)

    def test_valid_vault_replaces_only_its_key_privately_and_restarts_the_gateway(self):
        readable = {"path": "/mnt/d/Neu", "revision": cfg.revision("/mnt/d/Neu"), "configured": True, "readable": True, "applied": True}
        with patch.object(cfg, "result", side_effect=lambda path, applied=None: {**readable, "applied": readable["applied"] if applied is None else applied}), \
             patch.object(cfg.subprocess, "run") as run:
            run.return_value.returncode = 0
            code, body = self.run_main("set", str(cfg.revision("/mnt/d/Alt")), "/mnt/d/Neu")
        self.assertEqual(code, 0)
        self.assertTrue(body["applied"])
        text = self.env.read_text(encoding="utf-8")
        self.assertIn("OPENAI_API_KEY=platzhalter\n", text)
        self.assertIn("TELEGRAM_ALLOWED_USERS=1\n", text)
        self.assertEqual(text.count("OBSIDIAN_VAULT_PATH="), 1)
        self.assertIn('OBSIDIAN_VAULT_PATH="/mnt/d/Neu"\n', text)
        self.assertEqual(stat.S_IMODE(os.stat(self.env).st_mode), 0o600)
        self.assertEqual(run.call_args.args[0], ["systemctl", "--user", "restart", "hermes-gateway.service"])
        self.assertEqual([p.name for p in self.env.parent.iterdir() if p.name.startswith(".env.")], [])

    def test_real_vault_probe_needs_the_obsidian_folder(self):
        vault = Path(self.temp.name) / "vault"
        vault.mkdir()
        self.assertFalse(cfg.result(str(vault))["readable"])
        (vault / ".obsidian").mkdir()
        self.assertTrue(cfg.result(str(vault))["readable"])
        self.assertEqual([p.name for p in vault.iterdir()], [".obsidian"])


if __name__ == "__main__":
    unittest.main()
