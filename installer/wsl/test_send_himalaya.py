import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import send_himalaya as mail


class SendHimalayaTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.config = self.root / "config.toml"
        self.config.write_text('[accounts.friday]\nemail = "sender@example.test"\ndisplay-name = "Test Sender"\n')
        cli = self.root / ".local" / "bin" / "himalaya"
        cli.parent.mkdir(parents=True)
        cli.write_text("synthetic cli")
        self.addCleanup(patch.stopall)
        patch.object(mail, "CONFIG", self.config).start()
        patch.object(mail.Path, "home", return_value=self.root).start()
        patch.object(mail, "read_status", return_value={"readyForLocalUse": True}).start()
        self.request = {"to": ["recipient@example.test"], "subject": "Hello", "body": "A synthetic message"}

    def test_fixed_smtp_argv_stdin_and_no_save(self):
        with patch.object(mail.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertEqual(mail.send(self.request), {"state": "sent"})
        args, kwargs = run.call_args
        self.assertEqual(args[0][-3:], ["message", "send", "--no-save"])
        self.assertIn("smtp", args[0])
        self.assertIn(b"To: recipient@example.test", kwargs["input"])
        self.assertIn(b"A synthetic message", kwargs["input"])
        self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)

    def test_header_injection_rejected_before_subprocess(self):
        with patch.object(mail.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                mail.send({**self.request, "subject": "Hello\r\nBcc: attacker@example.test"})
            with self.assertRaises(ValueError):
                mail.send({**self.request, "to": ["recipient@example.test\nBcc: attacker@example.test"]})
            run.assert_not_called()

    def test_nonzero_and_timeout_are_unknown(self):
        with patch.object(mail.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaisesRegex(RuntimeError, "mail_outcome_unknown"):
                mail.send(self.request)
        with patch.object(mail.subprocess, "run", side_effect=subprocess.TimeoutExpired("himalaya", 20)):
            with self.assertRaisesRegex(RuntimeError, "mail_outcome_unknown"):
                mail.send(self.request)


if __name__ == "__main__":
    unittest.main()
