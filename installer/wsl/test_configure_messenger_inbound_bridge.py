import base64
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from subprocess import CompletedProcess

from configure_messenger_inbound_bridge import configure, ensure_applied, PINNED_HERMES


class MessengerBridgeSetupTests(unittest.TestCase):
    def test_failed_restart_leaves_no_apply_marker_and_retry_restarts(self):
        with tempfile.TemporaryDirectory() as temp:
            hermes = Path(temp)
            (hermes / "friday-messenger-bridge.key").write_text("synthetic")
            (hermes / "friday-messenger-bridge.json").write_text("{}")
            installed = hermes / "plugins/friday-memory/__init__.py"
            installed.parent.mkdir(parents=True)
            installed.write_text("_messenger_admitted\n_yuanbao_server\n")
            calls = []
            def failed(argv, **_kwargs):
                calls.append(argv)
                return CompletedProcess(argv, 1, b"")
            with self.assertRaises(OSError):
                ensure_applied(hermes, True, failed)
            self.assertFalse((hermes / "friday-messenger-bridge-applied.sha256").exists())
            def succeeds(argv, **_kwargs):
                calls.append(argv)
                return CompletedProcess(argv, 0, b"active\n" if "is-active" in argv else b"")
            ensure_applied(hermes, False, succeeds)
            self.assertTrue((hermes / "friday-messenger-bridge-applied.sha256").exists())
            count = len(calls)
            ensure_applied(hermes, False, succeeds)
            self.assertEqual(len(calls), count)
            installed.write_text("_messenger_admitted\n_yuanbao_server\n# updated")
            ensure_applied(hermes, False, succeeds)
            self.assertEqual(len(calls), count + 2)

    def test_pinned_hook_and_private_key_are_required(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            checkout = root / "installer"
            source = root / "hermes"
            home = root / "owner"
            (checkout / "wsl/friday_memory_plugin").mkdir(parents=True)
            (checkout / "wsl/friday_memory_plugin/__init__.py").write_text("_messenger_admitted _yuanbao_server")
            (source / "hermes_cli").mkdir(parents=True)
            (source / "gateway").mkdir()
            (source / "hermes_cli/plugins.py").write_text('"post_gateway_admission"')
            (source / "gateway/run_inbound_consumer.py").write_text("post_gateway_admission")
            installed = home / ".hermes/plugins/friday-memory/__init__.py"
            installed.parent.mkdir(parents=True)
            installed.write_text("_messenger_admitted _yuanbao_server")
            key = base64.b64encode(b"z" * 32).decode()
            responses = [CompletedProcess([], 0, PINNED_HERMES), CompletedProcess([], 0, "")]
            with patch("configure_messenger_inbound_bridge.subprocess.run", side_effect=responses):
                self.assertTrue(configure(checkout, 48111, key, home, source))
            self.assertEqual((home / ".hermes/friday-messenger-bridge.key").read_text().strip(), key)
            self.assertFalse((home / ".hermes/friday-messenger-bridge.key").stat().st_mode & 0o077)
            responses = [CompletedProcess([], 0, PINNED_HERMES), CompletedProcess([], 0, "")]
            with patch("configure_messenger_inbound_bridge.subprocess.run", side_effect=responses):
                self.assertFalse(configure(checkout, 48111, key, home, source))
            with self.assertRaises(ValueError):
                configure(checkout, 48111, "invalid", home, source)


if __name__ == "__main__":
    unittest.main()
