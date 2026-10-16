import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "configure_calendar_bridge.py"
spec = importlib.util.spec_from_file_location("configure_calendar_bridge", SCRIPT)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CalendarBridgeSetupTests(unittest.TestCase):
    def test_stdin_key_accepts_plain_and_single_utf8_bom_prefix(self):
        key = b"A" * 43 + b"="
        self.assertEqual(bridge.decode_stdin_key(key + b"\r\n"), key.decode("ascii"))
        self.assertEqual(bridge.decode_stdin_key(b"\xef\xbb\xbf" + key + b"\r\n"), key.decode("ascii"))

    def test_stdin_key_rejects_non_ascii_or_repeated_bom(self):
        key = b"A" * 43 + b"="
        for value in (b"\xef\xbb\xbf\xef\xbb\xbf" + key, b"\xff" + key):
            with self.subTest(value=value[:6]), self.assertRaises(UnicodeDecodeError):
                bridge.decode_stdin_key(value)

    def test_enable_preserves_unrelated_settings_and_comments(self):
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / "config.yaml"
            for original in (
                "# keep this comment\nmodel: test-model\n",
                "model: test-model\nplugins:\n  enabled:\n    - existing-plugin\n  # keep plugin comment\n  other: true\napi:\n  port: 43793\n",
                "plugins:\n  enabled: [] # keep inline comment\nmodel: test-model\n",
            ):
                with self.subTest(original=original):
                    config.write_text(original)
                    self.assertTrue(bridge.enable_preserving_config(config))
                    updated = config.read_text()
                    self.assertIn("# keep", updated)
                    self.assertIn("model: test-model", updated)
                    self.assertFalse(bridge.enable_preserving_config(config))
                    self.assertEqual(config.read_text(), updated)
                    if "api:" in original:
                        self.assertIn("api:\n  port: 43793", updated)

    def test_rejects_explicitly_disabled_plugin_without_rewriting(self):
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / "config.yaml"
            original = "# own choices\nplugins:\n  disabled:\n    - friday-dashboard-calendar\n"
            config.write_text(original)
            with self.assertRaises(ValueError):
                bridge.enable_preserving_config(config)
            self.assertEqual(config.read_text(), original)

    def test_installs_private_key_plugin_and_profile_idempotently(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            checkout = directory / "checkout"
            source = checkout / "plugins/friday_dashboard_calendar"
            source.mkdir(parents=True)
            (source / "plugin.yaml").write_text("name: friday-dashboard-calendar\n")
            (source / "__init__.py").write_text("def register(ctx): pass\n")
            home = directory / "home"
            home.mkdir()
            key = "A" * 43 + "="
            self.assertTrue(bridge.configure(checkout, 3101, key, home))
            self.assertFalse(bridge.configure(checkout, 3101, key, home))
            hermes = home / ".hermes"
            self.assertEqual((hermes / "friday-calendar-bridge.key").read_text(), key + "\n")
            self.assertIn("friday-dashboard-calendar", (hermes / "config.yaml").read_text())
            self.assertTrue((hermes / "plugins/friday-dashboard-calendar/__init__.py").is_file())
            if __import__("os").name != "nt":
                self.assertEqual((hermes / "friday-calendar-bridge.key").stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
