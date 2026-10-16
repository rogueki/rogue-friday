import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import tomllib
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("configure_himalaya", Path(__file__).with_name("configure_himalaya.py"))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class HimalayaAccountTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.old_config, self.old_secrets = module.CONFIG, module.SECRETS
        module.CONFIG = root / ".config" / "himalaya" / "config.toml"
        module.SECRETS = root / ".config" / "friday" / "mail"
        self.addCleanup(self.restore)
        self.profile = {
            "email": "user@example.test", "displayName": "Test User", "imapHost": "imap.example.test",
            "imapPort": 993, "imapLogin": "user@example.test", "imapPassword": "imap-secret-test",
            "smtpHost": "smtp.example.test", "smtpPort": 587, "smtpLogin": "user@example.test",
            "smtpPassword": "smtp-secret-test", "smtpEncryption": "start-tls",
            "sentFolder": "Sent", "draftsFolder": "Drafts", "trashFolder": "Trash", "revision": 1,
        }

    def restore(self):
        module.CONFIG, module.SECRETS = self.old_config, self.old_secrets

    def test_profile_is_parseable_and_secrets_stay_outside_toml(self):
        self.profile["revision"] = module.read_status()["revision"]
        with patch("sys.argv", ["configure_himalaya.py", "update"]), patch("sys.stdin", io.StringIO(json.dumps(self.profile))), patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(module.main(), 0)
        status = json.loads(output.getvalue())
        self.assertTrue(status["managed"])
        self.assertTrue(status["credentialsPresent"])
        self.assertFalse(status["connectionChecked"])
        config = module.CONFIG.read_text()
        parsed = tomllib.loads(config)
        self.assertEqual(parsed["accounts"]["friday"]["backend"]["host"], "imap.example.test")
        self.assertEqual(parsed["accounts"]["friday"]["folder"]["aliases"]["sent"], "Sent")
        self.assertNotIn("imap-secret-test", config)
        self.assertNotIn("smtp-secret-test", config)
        self.assertEqual(os.stat(module.CONFIG).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(module.SECRETS / "imap-secret").st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(module.SECRETS / "smtp-secret").st_mode & 0o777, 0o600)
        self.assertFalse(module.valid({**self.profile, "imapHost": "imap.example.test; evil"}))
        self.assertFalse(module.valid({**self.profile, "smtpEncryption": "none"}))

    def test_existing_user_config_is_preserved(self):
        module.CONFIG.parent.mkdir(parents=True)
        module.CONFIG.write_text("[accounts.other]\nemail = 'other@example.test'\n")
        self.profile["revision"] = module.read_status()["revision"]
        with patch("sys.argv", ["configure_himalaya.py", "update"]), patch("sys.stdin", io.StringIO(json.dumps(self.profile))), patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(module.main(), 6)
        self.assertIn("accounts.other", module.CONFIG.read_text())

    def test_symlink_is_rejected(self):
        module.CONFIG.parent.mkdir(parents=True)
        target = Path(self.directory.name) / "target"
        target.write_text("existing")
        module.CONFIG.symlink_to(target)
        with self.assertRaises(ValueError):
            module.safe_file(module.CONFIG)


if __name__ == "__main__":
    unittest.main()
