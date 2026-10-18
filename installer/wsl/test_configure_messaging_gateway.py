import importlib.util
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


if __name__ == "__main__":
    unittest.main()
