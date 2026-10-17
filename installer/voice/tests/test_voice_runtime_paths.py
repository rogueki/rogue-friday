import os
import posixpath
import sys
import unittest
from unittest.mock import mock_open, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import voice_runtime_paths as paths


class VoiceRuntimePathsTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "FRIDAY_DATA_DIR": "",
            "FRIDAY_STATE_ROOT": "",
            "FRIDAY_CONFIG_DIR": "",
            "FRIDAY_DASHBOARD_PORT": "",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_windows_paths_remain_root_relative_even_with_linux_env(self):
        root = os.path.abspath(os.path.join(os.sep, "Friday"))
        os.environ["FRIDAY_DATA_DIR"] = os.path.join(root, "data")
        os.environ["FRIDAY_STATE_ROOT"] = os.path.join(root, "state")

        with patch.object(sys, "platform", "win32"):
            self.assertEqual(
                paths.voice_bridge_key_path(root),
                os.path.join(root, "dashboard", "data", "voice-bridge", "auth.key"),
            )
            self.assertEqual(
                paths.onboarding_offer_path(root),
                os.path.join(root, "dashboard", "data", "voice-bridge", "onboarding-offer.json"),
            )
            self.assertEqual(
                paths.content_studio_state_path(root),
                os.path.join(root, "run", "content-studio-voice.json"),
            )

    def test_linux_paths_use_persistent_data_and_state_roots(self):
        os.environ["FRIDAY_DATA_DIR"] = "/srv/friday/data"
        os.environ["FRIDAY_STATE_ROOT"] = "/srv/friday"
        root = "/opt/friday/current"

        with patch.object(sys, "platform", "linux"):
            self.assertEqual(
                paths.voice_bridge_key_path(root),
                posixpath.join("/srv/friday/data", "voice-bridge", "auth.key"),
            )
            self.assertEqual(
                paths.onboarding_offer_path(root),
                posixpath.join("/srv/friday/data", "voice-bridge", "onboarding-offer.json"),
            )
            self.assertEqual(
                paths.content_studio_state_path(root),
                posixpath.join("/srv/friday", "run", "content-studio-voice.json"),
            )

    def test_linux_dashboard_port_prefers_validated_env_then_config(self):
        os.environ["FRIDAY_CONFIG_DIR"] = "/etc/friday"
        config_reader = mock_open(read_data=(
            "dataMode: hybrid\nserver:\n  host: 127.0.0.1\n  port: 3107\n"
        ))

        with patch.object(sys, "platform", "linux"), patch.object(paths, "open", config_reader, create=True):
            self.assertEqual(paths.dashboard_port("/opt/friday/current"), 3107)
            os.environ["FRIDAY_DASHBOARD_PORT"] = "3108"
            self.assertEqual(paths.dashboard_port("/opt/friday/current"), 3108)

        config_reader.assert_called_once()

    def test_invalid_linux_port_values_are_rejected(self):
        os.environ["FRIDAY_CONFIG_DIR"] = "/etc/friday"
        os.environ["FRIDAY_DASHBOARD_PORT"] = "99999"
        config_reader = mock_open(read_data="server:\n  port: 70000\n")

        with patch.object(sys, "platform", "linux"), patch.object(paths, "open", config_reader, create=True):
            self.assertEqual(paths.dashboard_port("/opt/friday/current"), paths.DEFAULT_DASHBOARD_PORT)

        config_reader.assert_called_once()

    def test_relative_linux_data_and_state_paths_are_ignored(self):
        os.environ["FRIDAY_DATA_DIR"] = "relative/path"
        os.environ["FRIDAY_STATE_ROOT"] = "../state"
        root = "/opt/friday/current"

        with patch.object(sys, "platform", "linux"):
            self.assertEqual(
                paths.voice_bridge_key_path(root),
                posixpath.join("/var/lib/friday", "data", "voice-bridge", "auth.key"),
            )
            self.assertEqual(
                paths.content_studio_state_path(root),
                posixpath.join("/var/lib/friday", "run", "content-studio-voice.json"),
            )


if __name__ == "__main__":
    unittest.main()
