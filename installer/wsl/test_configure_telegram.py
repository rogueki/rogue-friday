import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("configure_telegram", Path(__file__).with_name("configure_telegram.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TelegramSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.hermes = Path(self.temp.name) / ".hermes"
        self.hermes.mkdir()
        self.env = self.hermes / ".env"
        self.env.write_text('OTHER_KEY="keep"\n', encoding="utf-8")
        self.flags = False
        self.restarts = 0
        self.paths = mock.patch.multiple(module, HERMES=self.hermes, ENV=self.env, LOCK=self.hermes / ".lock")
        self.paths.start()
        self.addCleanup(self.paths.stop)
        self.commands = mock.patch.object(module, "command", side_effect=self.command)
        self.commands.start()
        self.addCleanup(self.commands.stop)

    def command(self, *args):
        if args[1:4] == ("config", "get", "platforms.telegram.enabled"):
            return mock.Mock(returncode=0, stdout="true" if self.flags else "false")
        if args[1:4] == ("config", "set", "platforms.telegram.enabled"):
            self.flags = args[4] == "true"
            return mock.Mock(returncode=0, stdout="")
        if args[:3] == ("systemctl", "--user", "restart"):
            self.restarts += 1
            return mock.Mock(returncode=0, stdout="")
        return mock.Mock(returncode=0, stdout="active")

    def submit(self, data):
        with mock.patch.object(module.sys, "stdin", io.StringIO(json.dumps(data))), mock.patch("sys.stdout", new_callable=io.StringIO) as output:
            code = module.update(module.read_lines())
            return code, json.loads(output.getvalue()) if output.getvalue() else None

    def test_private_idempotent_update_clear_and_unrelated_values(self):
        request = {"token": "123456789:" + "a" * 35, "clearToken": False,
                   "allowedUserIds": ["123456789"], "enabled": True,
                   "revision": module.snapshot()["revision"]}
        code, result = self.submit(request)
        self.assertEqual(code, 0)
        self.assertTrue(result["tokenConfigured"])
        self.assertNotIn(request["token"], json.dumps(result))
        self.assertEqual(self.env.stat().st_mode & 0o777, 0o600)
        self.assertIn('OTHER_KEY="keep"', self.env.read_text())
        self.assertEqual(self.restarts, 1)
        request["token"] = ""
        request["revision"] = result["revision"]
        code, result = self.submit(request)
        self.assertEqual((code, result["applied"], self.restarts), (0, None, 1))
        request.update(clearToken=True, enabled=False, revision=result["revision"])
        code, result = self.submit(request)
        self.assertEqual(code, 0)
        self.assertFalse(result["tokenConfigured"])
        self.assertEqual(self.restarts, 2)

    def test_rejects_bad_owner_and_stale_revision(self):
        request = {"token": "123456789:" + "a" * 35, "clearToken": False,
                   "allowedUserIds": ["@name"], "enabled": True,
                   "revision": module.snapshot()["revision"]}
        self.assertEqual(self.submit(request)[0], 2)
        request["allowedUserIds"] = ["123456789"]
        request["revision"] = 1
        self.assertEqual(self.submit(request)[0], 3)
        self.assertEqual(self.restarts, 0)


if __name__ == "__main__":
    unittest.main()
