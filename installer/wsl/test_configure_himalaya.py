import importlib.util
import io
import json
import os
import ssl
from pathlib import Path
import subprocess
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
        self.assertEqual(parsed["accounts"]["friday"]["imap"]["server"], "imaps://imap.example.test:993")
        self.assertEqual(parsed["accounts"]["friday"]["smtp"]["server"], "smtp://smtp.example.test:587")
        self.assertTrue(parsed["accounts"]["friday"]["smtp"]["starttls"])
        self.assertEqual(parsed["accounts"]["friday"]["mailbox"]["alias"]["sent"], "Sent")
        self.assertEqual(parsed["accounts"]["friday"]["imap"]["sasl"]["plain"]["password"]["command"],
                         ["cat", str(module.SECRETS / "imap-secret")])
        self.assertNotIn("imap-secret-test", config)
        self.assertNotIn("smtp-secret-test", config)
        self.assertEqual(os.stat(module.CONFIG).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(module.SECRETS / "imap-secret").st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(module.SECRETS / "smtp-secret").st_mode & 0o777, 0o600)
        self.assertFalse(module.valid({**self.profile, "imapHost": "imap.example.test; evil"}))
        self.assertFalse(module.valid({**self.profile, "smtpEncryption": "none"}))
        binary = os.environ.get("HIMALAYA_CLI_TEST_BINARY")
        if binary:
            result = subprocess.run([binary, "--config", str(module.CONFIG), "account", "list", "--json"],
                                    capture_output=True, text=True, timeout=5, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_legacy_managed_profile_is_not_ready(self):
        module.CONFIG.parent.mkdir(parents=True)
        module.CONFIG.write_text(module.HEADER + '[accounts.friday]\nbackend.type = "imap"\n')
        for name in ("imap-secret", "smtp-secret"):
            module.atomic(module.SECRETS / name, "synthetic\n")
        with patch.object(module.shutil, "which", return_value="/usr/bin/himalaya"), patch.object(module.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "himalaya v2.2.1"
            status = module.read_status()
        self.assertTrue(status["managed"])
        self.assertFalse(status["readyForLocalUse"])
        self.profile["revision"] = status["revision"]
        with patch("sys.argv", ["configure_himalaya.py", "update"]), patch("sys.stdin", io.StringIO(json.dumps(self.profile))), patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(module.main(), 0)
        self.assertIn('imap.server = "imaps://imap.example.test:993"', module.CONFIG.read_text())

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

    def test_smtp_check_authenticates_over_starttls_without_sending(self):
        self.profile["revision"] = module.read_status()["revision"]
        with patch("sys.argv", ["configure_himalaya.py", "update"]), patch("sys.stdin", io.StringIO(json.dumps(self.profile))), patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(module.main(), 0)
        with patch.object(module, "read_status", return_value={"readyForLocalUse": True}), \
             patch.object(module.smtplib, "SMTP") as smtp, \
             patch.object(module.smtplib, "SMTP_SSL") as smtp_ssl:
            client = smtp.return_value
            self.assertEqual(module.check_smtp(), {"ok": True})
            smtp.assert_called_once()
            smtp_ssl.assert_not_called()
            client.starttls.assert_called_once()
            tls_context = client.starttls.call_args.kwargs["context"]
            self.assertEqual(tls_context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(tls_context.check_hostname)
            client.login.assert_called_once_with("user@example.test", "smtp-secret-test")
            self.assertFalse(client.sendmail.called)
            self.assertFalse(client.send_message.called)
            client.login.side_effect = module.smtplib.SMTPAuthenticationError(535, b"synthetic secret")
            self.assertEqual(module.check_smtp(), {"ok": False})
            client.login.side_effect = None
            client.starttls.side_effect = module.smtplib.SMTPNotSupportedError("no TLS")
            self.assertEqual(module.check_smtp(), {"ok": False})


if __name__ == "__main__":
    unittest.main()
