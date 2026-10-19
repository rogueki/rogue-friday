import base64
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from configure_memory_bridge import PINNED_HERMES, configure, snapshot, restore


class BridgeSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.checkout = self.root / "installer"
        self.plugin = self.checkout / "wsl/friday_memory_plugin"
        self.plugin.mkdir(parents=True)
        (self.plugin / "plugin.yaml").write_text("name: friday-memory\n", encoding="utf-8")
        (self.plugin / "__init__.py").write_text("def register(ctx): pass\n", encoding="utf-8")
        self.home = self.root / "home"
        self.home.mkdir()
        self.source = self.root / "hermes-source"
        (self.source / "hermes_cli").mkdir(parents=True)
        (self.source / "hermes_cli/plugins.py").write_text('"pre_llm_call", "post_llm_call", "on_session_finalize"', encoding="utf-8")
        self.key = base64.b64encode(b"a" * 32).decode("ascii")

    def tearDown(self):
        self.temp.cleanup()

    def test_pinned_install_preserves_existing_config_and_is_idempotent(self):
        hermes = self.home / ".hermes"
        hermes.mkdir()
        config = hermes / "config.yaml"
        config.write_text("model: test\nplugins:\n  enabled:\n    - existing\n", encoding="utf-8")
        with patch("configure_memory_bridge.subprocess.run") as run:
            run.side_effect = lambda args, **_: type("Result", (), {"stdout": PINNED_HERMES + "\n" if "rev-parse" in args else ""})()
            self.assertTrue(configure(self.checkout, 3100, self.key, self.home, self.source))
            self.assertFalse(configure(self.checkout, 3100, self.key, self.home, self.source))
        self.assertIn("existing", config.read_text(encoding="utf-8"))
        self.assertIn("friday-memory", config.read_text(encoding="utf-8"))
        if os.name != "nt":
            self.assertEqual((hermes / "friday-memory-bridge.key").stat().st_mode & 0o777, 0o600)

    def test_wrong_revision_fails_before_creating_plugin(self):
        with patch("configure_memory_bridge.subprocess.run") as run:
            run.return_value.stdout = "0" * 40
            with self.assertRaisesRegex(ValueError, "unsupported"):
                configure(self.checkout, 3100, self.key, self.home, self.source)
        self.assertFalse((self.home / ".hermes/plugins").exists())

    def test_rollback_restores_existing_config_and_removes_new_plugin(self):
        hermes = self.home / ".hermes"
        hermes.mkdir()
        config = hermes / "config.yaml"
        config.write_text("model: old\n", encoding="utf-8")
        run_id = "a" * 32
        snapshot(self.home, run_id)
        with patch("configure_memory_bridge.subprocess.run") as run:
            run.side_effect = lambda args, **_: type("Result", (), {"stdout": PINNED_HERMES + "\n" if "rev-parse" in args else ""})()
            configure(self.checkout, 3100, self.key, self.home, self.source)
        restore(self.home, run_id)
        self.assertEqual(config.read_text(encoding="utf-8"), "model: old\n")
        self.assertFalse((hermes / "plugins/friday-memory/__init__.py").exists())


if __name__ == "__main__":
    unittest.main()
