import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "configure_mail_bridge.py"
spec = importlib.util.spec_from_file_location("configure_mail_bridge", SCRIPT)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class MailBridgeSetupTests(unittest.TestCase):
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
            original = "# own choices\nplugins:\n  disabled:\n    - friday-dashboard-mail\n"
            config.write_text(original)
            with self.assertRaises(ValueError):
                bridge.enable_preserving_config(config)
            self.assertEqual(config.read_text(), original)

    def test_rejects_invalid_key_before_creating_hermes_files(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            source = directory / "checkout/plugins/friday_dashboard_mail"
            source.mkdir(parents=True)
            (source / "plugin.yaml").write_text("name: friday-dashboard-mail\n")
            (source / "__init__.py").write_text("def register(ctx): pass\n")
            home = directory / "home"
            home.mkdir()
            for key in ("A" * 42 + "==", "A" * 43 + "!", "A" * 42 + "B="):
                with self.subTest(key=key[-2:]), self.assertRaises(ValueError):
                    bridge.configure(directory / "checkout", 3101, key, home)
            self.assertFalse((home / ".hermes").exists())

    def test_disabled_choice_is_preserved_before_plugin_copy(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            source = directory / "checkout/plugins/friday_dashboard_mail"
            source.mkdir(parents=True)
            (source / "plugin.yaml").write_text("name: friday-dashboard-mail\n")
            (source / "__init__.py").write_text("def register(ctx): pass\n")
            home = directory / "home"
            hermes = home / ".hermes"
            hermes.mkdir(parents=True)
            config = hermes / "config.yaml"
            config.write_text("plugins:\n  disabled:\n    - friday-dashboard-mail\n")
            with self.assertRaises(ValueError):
                bridge.configure(directory / "checkout", 3101, "A" * 43 + "=", home)
            self.assertFalse((hermes / "plugins").exists())
            self.assertFalse((hermes / "friday-mail-bridge.key").exists())

    def test_rejects_symlink_key_target(self):
        if not hasattr(os, "symlink"):
            self.skipTest("symlinks unavailable")
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            source = directory / "checkout/plugins/friday_dashboard_mail"
            source.mkdir(parents=True)
            (source / "plugin.yaml").write_text("name: friday-dashboard-mail\n")
            (source / "__init__.py").write_text("def register(ctx): pass\n")
            hermes = directory / "home/.hermes"
            hermes.mkdir(parents=True)
            victim = directory / "victim"
            victim.write_text("untouched")
            try:
                (hermes / "friday-mail-bridge.key").symlink_to(victim)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable")
            with self.assertRaises(ValueError):
                bridge.configure(directory / "checkout", 3101, "A" * 43 + "=", directory / "home")
            self.assertEqual(victim.read_text(), "untouched")

    def test_installs_private_key_plugin_and_profile_idempotently(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            checkout = directory / "checkout"
            source = checkout / "plugins/friday_dashboard_mail"
            source.mkdir(parents=True)
            (source / "plugin.yaml").write_text("name: friday-dashboard-mail\n")
            (source / "__init__.py").write_text("def register(ctx): pass\n")
            home = directory / "home"
            home.mkdir()
            key = "A" * 43 + "="
            self.assertTrue(bridge.configure(checkout, 3101, key, home))
            self.assertFalse(bridge.configure(checkout, 3101, key, home))
            hermes = home / ".hermes"
            self.assertEqual((hermes / "friday-mail-bridge.key").read_text(), key + "\n")
            self.assertIn("friday-dashboard-mail", (hermes / "config.yaml").read_text())
            self.assertTrue((hermes / "plugins/friday-dashboard-mail/__init__.py").is_file())
            if __import__("os").name != "nt":
                self.assertEqual((hermes / "friday-mail-bridge.key").stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
