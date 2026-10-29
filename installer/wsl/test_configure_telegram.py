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
REAL_BOT_PROBE = module.bot_probe


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
        self.probe = mock.patch.object(module, "bot_probe", return_value={"botAuthentication": "verified",
            "botId": "123456789", "botUsername": "fake_bot", "receiveMode": "polling"})
        self.probe.start()
        self.addCleanup(self.probe.stop)

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

    def test_getme_and_webhook_probe_uses_fixed_telegram_methods(self):
        token = "123456789:" + "a" * 35
        urls = []
        def fake_open(url, timeout):
            urls.append(url)
            body = {"ok": True, "result": {"id": 123456789, "is_bot": True, "username": "friday_bot"}} if url.endswith("/getMe") else \
                   {"ok": True, "result": {"url": "https://example.test/hook"}}
            return mock.MagicMock(__enter__=lambda self: io.BytesIO(json.dumps(body).encode()), __exit__=lambda *args: None)
        with mock.patch.object(module, "urlopen", side_effect=fake_open):
            result = REAL_BOT_PROBE(token)
        self.assertEqual((result["botAuthentication"], result["botId"], result["receiveMode"]),
                         ("verified", "123456789", "webhook"))
        self.assertEqual([url.rsplit("/", 1)[-1] for url in urls], ["getMe", "getWebhookInfo"])
        self.assertNotIn(token, json.dumps(result))

    def test_known_webhook_conflict_blocks_polling_activation(self):
        token = "123456789:" + "a" * 35
        request = {"token": token, "clearToken": False, "allowedUserIds": ["123456789"],
                   "enabled": True, "revision": module.snapshot()["revision"]}
        with mock.patch.object(module, "bot_probe", return_value={"botAuthentication": "verified",
                "botId": "123456789", "botUsername": "fake_bot", "receiveMode": "webhook"}):
            code, result = self.submit(request)
        self.assertEqual((code, result["error"]), (4, "invalid_bot_or_webhook_conflict"))
        self.assertEqual(self.restarts, 0)

    def _store_working_token(self):
        working = "111111111:" + "w" * 35
        self.env.write_text(f'OTHER_KEY="keep"\nTELEGRAM_BOT_TOKEN="{working}"\nTELEGRAM_ALLOWED_USERS="123456789"\n', encoding="utf-8")
        return working

    def test_rejected_new_token_keeps_the_working_one_even_when_disabled(self):
        working = self._store_working_token()
        request = {"token": "222222222:" + "x" * 35, "clearToken": False, "allowedUserIds": ["123456789"],
                   "enabled": False, "revision": module.snapshot()["revision"]}
        with mock.patch.object(module, "bot_probe", return_value={"botAuthentication": "invalid",
                "botId": None, "botUsername": None, "receiveMode": "unknown"}):
            code, result = self.submit(request)
        self.assertEqual((code, result["error"]), (4, "bot_token_rejected"))
        self.assertIn(working, self.env.read_text(encoding="utf-8"))
        self.assertEqual(self.restarts, 0)

    def test_unreachable_telegram_changes_nothing(self):
        working = self._store_working_token()
        unknown = {"botAuthentication": "unknown", "botId": None, "botUsername": None, "receiveMode": "unknown"}
        for token, enabled in (("222222222:" + "x" * 35, False), ("", True)):
            request = {"token": token, "clearToken": False, "allowedUserIds": ["123456789"],
                       "enabled": enabled, "revision": module.snapshot()["revision"]}
            with mock.patch.object(module, "bot_probe", return_value=unknown):
                code, result = self.submit(request)
            self.assertEqual((code, result["error"]), (4, "bot_unverified"))
        self.assertIn(working, self.env.read_text(encoding="utf-8"))
        self.assertFalse(self.flags)
        self.assertEqual(self.restarts, 0)

    def test_refused_flag_switch_leaves_env_untouched(self):
        before = self.env.read_text(encoding="utf-8")
        original = self.command
        def refuse(*args):
            if args[1:4] == ("config", "set", "platforms.telegram.enabled"):
                return mock.Mock(returncode=1, stdout="")
            return original(*args)
        request = {"token": "123456789:" + "a" * 35, "clearToken": False, "allowedUserIds": ["123456789"],
                   "enabled": True, "revision": module.snapshot()["revision"]}
        with mock.patch.object(module, "command", side_effect=refuse):
            code, result = self.submit(request)
        self.assertEqual((code, result["error"]), (5, "config_unavailable"))
        self.assertEqual(self.env.read_text(encoding="utf-8"), before)


if __name__ == "__main__":
    unittest.main()
