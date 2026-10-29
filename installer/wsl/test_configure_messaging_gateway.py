import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("configure_messaging_gateway", Path(__file__).with_name("configure_messaging_gateway.py"))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class MessagingGatewayTests(unittest.TestCase):
    def test_discord_env_write_preserves_unrelated_lines_and_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(gateway, "HERMES", root), patch.object(gateway, "ENV", root / ".env"):
                gateway.write_env(["UNRELATED=value\n", "DISCORD_BOT_TOKEN=old\n"], "discord",
                                  {"DISCORD_BOT_TOKEN": "new", "DISCORD_ALLOWED_USERS": "123456789012345678", "DISCORD_ALLOWED_CHANNELS": ""})
                text = (root / ".env").read_text()
                self.assertIn("UNRELATED=value", text)
                self.assertIn('DISCORD_BOT_TOKEN="new"', text)
                self.assertNotIn("old", text)
                self.assertEqual((root / ".env").stat().st_mode & 0o777, 0o600)

    def test_whatsapp_session_file_only_proves_presence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session = root / "platforms" / "whatsapp" / "session"
            session.mkdir(parents=True)
            with patch.object(gateway, "HERMES", root):
                self.assertFalse(gateway.linked())
                (session / "creds.json").write_text("{}")
                self.assertTrue(gateway.linked())

    def test_populated_legacy_whatsapp_session_takes_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / "platforms" / "whatsapp" / "session"
            legacy = root / "whatsapp" / "session"
            current.mkdir(parents=True)
            legacy.mkdir(parents=True)
            (current / "creds.json").write_text("{}")
            with patch.object(gateway, "HERMES", root):
                self.assertTrue(gateway.linked())  # Empty legacy directory does not shadow current.
                (legacy / "other.json").write_text("{}")
                self.assertFalse(gateway.linked())
                (legacy / "creds.json").write_text("{}")
                self.assertTrue(gateway.linked())

    def test_self_chat_identity_is_derived_from_linked_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session = root / "platforms" / "whatsapp" / "session"
            session.mkdir(parents=True)
            (session / "creds.json").write_text('{"me":{"id":"491701234567:5@s.whatsapp.net"}}')
            with patch.object(gateway, "HERMES", root):
                self.assertEqual(gateway.linked_phone(), "491701234567")

    def _discord_update(self, root, request, probe="verified", refuse_flag=False):
        calls = []
        def fake_command(*args):
            calls.append(args)
            if args[1:4] == ("config", "set", "platforms.discord.enabled"):
                return type("Result", (), {"returncode": 1 if refuse_flag else 0, "stdout": ""})()
            return type("Result", (), {"returncode": 0, "stdout": "false"})()
        with patch.object(gateway, "HERMES", root), patch.object(gateway, "ENV", root / ".env"), \
                patch.object(gateway, "command", side_effect=fake_command), \
                patch.object(gateway, "running", return_value=False), \
                patch.object(gateway, "platform_state", return_value="unknown"), \
                patch.object(gateway, "enabled", return_value=False), \
                patch.object(gateway, "discord_probe", return_value=probe) as probed:
            request = {**request, "revision": gateway.snapshot("discord", gateway.read_lines())["revision"]}
            output = io.StringIO()
            with patch.object(gateway.sys, "stdin", io.StringIO(json.dumps(request))), patch("sys.stdout", output):
                code = gateway.update("discord", gateway.read_lines())
        return code, json.loads(output.getvalue()) if output.getvalue() else None, calls, probed

    def test_new_discord_token_needs_discord_confirmation(self):
        working = "W" * 59
        for probe, error in (("rejected", "bot_token_rejected"), ("unverified", "bot_unverified")):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / ".env").write_text(f'DISCORD_BOT_TOKEN="{working}"\nDISCORD_ALLOWED_USERS="123456789012345678"\n')
                code, result, calls, _ = self._discord_update(root, {"token": "N" * 59, "clearToken": False,
                    "allowedUserIds": ["123456789012345678"], "allowedChannelIds": [], "enabled": False}, probe=probe)
                self.assertEqual((code, result), (4, {"error": error}))
                self.assertIn(working, (root / ".env").read_text())
                self.assertFalse(any(call[:2] == ("systemctl", "--user") for call in calls))

    def test_unchanged_token_is_not_probed_and_refused_flag_leaves_env_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = 'DISCORD_BOT_TOKEN="' + "W" * 59 + '"\nDISCORD_ALLOWED_USERS="123456789012345678"\n'
            (root / ".env").write_text(original)
            code, result, _, probed = self._discord_update(root, {"token": "", "clearToken": False,
                "allowedUserIds": ["123456789012345678", "223456789012345678"], "allowedChannelIds": [], "enabled": True},
                refuse_flag=True)
            self.assertEqual((code, result), (5, {"error": "config_unavailable"}))
            self.assertEqual((root / ".env").read_text(), original)
            probed.assert_not_called()


if __name__ == "__main__":
    unittest.main()
