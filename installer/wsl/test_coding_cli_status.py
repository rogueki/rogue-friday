import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import coding_runner


class CodingCliStatusTest(unittest.TestCase):
    def test_normalizes_fake_cli_output_without_account_details(self):
        fixtures = {
            "codex": ("0.163.0", "Logged in as private@example.invalid"),
            "opencode": ("1.19.2", "└  1 credentials private@example.invalid"),
            "claude": ("2.1.301", '{"loggedIn": false, "email": "private@example.invalid"}'),
        }
        with tempfile.TemporaryDirectory() as directory:
            for name, (version, status) in fixtures.items():
                binary = Path(directory) / name
                binary.write_text("#!/usr/bin/python3\nimport sys\nprint(" + repr(version) + " if '--version' in sys.argv else " + repr(status) + ")\n", encoding="utf-8")
                binary.chmod(0o700)
            env = os.environ.copy()
            env["PATH"] = directory + ":/usr/bin:/bin"
            output = io.StringIO()
            with patch.object(coding_runner, "base_env", return_value=env), contextlib.redirect_stdout(output):
                coding_runner.cli_status()
            payload = json.loads(output.getvalue())
            self.assertEqual([item["authState"] for item in payload["clis"]],
                             ["signed_in", "stored_credentials", "signed_out"])
            self.assertEqual([item["installed"] for item in payload["clis"]], [True, True, True])
            self.assertNotIn("private@example.invalid", output.getvalue())


if __name__ == "__main__":
    unittest.main()
