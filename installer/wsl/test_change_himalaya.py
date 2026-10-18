import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import change_himalaya as mail


class ChangeHimalayaTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.config = self.root / "config.toml"
        self.config.write_text("synthetic")
        cli = self.root / ".local" / "bin" / "himalaya"
        cli.parent.mkdir(parents=True)
        cli.write_text("synthetic")
        self.addCleanup(patch.stopall)
        patch.object(mail, "CONFIG", self.config).start()
        patch.object(mail.Path, "home", return_value=self.root).start()
        patch.object(mail, "read_status", return_value={"readyForLocalUse": True}).start()
        patch.object(mail, "run", return_value={"mailboxes": [{"id": "Inbox"}, {"id": "Archive"}]}).start()

    def call(self, request):
        with patch("sys.stdin", io.StringIO(json.dumps(request))), patch("sys.stdout", new_callable=io.StringIO):
            mail.main()

    def test_move_and_flag_have_fixed_arguments(self):
        with patch.object(mail.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            self.call({"action": "move", "mailbox": "Inbox", "id": "504", "destination": "Archive"})
            self.assertEqual(run.call_args.args[0][-6:], ["message", "move", "--from", "Inbox", "--to", "Archive", "504"][-6:])
            self.call({"action": "flag", "mailbox": "Inbox", "id": "504"})
            self.assertEqual(run.call_args.args[0][-6:], ["flag", "add", "--mailbox", "Inbox", "--flag", "flagged", "504"][-6:])

    def test_unknown_folder_and_uid_are_rejected_before_mutation(self):
        with patch.object(mail.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                self.call({"action": "move", "mailbox": "Inbox", "id": "504", "destination": "Missing"})
            with self.assertRaises(ValueError):
                self.call({"action": "flag", "mailbox": "Inbox", "id": "-1"})
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
