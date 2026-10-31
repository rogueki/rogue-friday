import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import configure_voice
import enable_voice_adapter
import prepare_voice


class LinuxVoiceServiceTest(unittest.TestCase):
    def test_config_fields_and_readiness_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root) / "state"
            config_dir = Path(root) / "config"
            (config_dir / "secrets").mkdir(parents=True, mode=0o700)
            with (patch.object(configure_voice, "STATE_PATH", state),
                  patch.object(configure_voice, "SECRET_PATH", config_dir / "secrets/elevenlabs.key"),
                  patch.object(configure_voice, "CONFIG_PATH", config_dir / "voice.json"),
                  patch.object(configure_voice.pwd, "getpwnam", return_value=type("Account", (), {
                      "pw_uid": os.getuid(), "pw_gid": os.getgid()})()),
                  patch.object(configure_voice.os, "geteuid", return_value=0),
                  patch.object(configure_voice.os, "fchown"),
                  patch.dict(configure_voice.os.environ, {"SUDO_UID": str(os.getuid())})):
                key = config_dir / "input.key"
                key.write_text("synthetic-test-key")
                key.chmod(0o600)
                configure_voice.configure("elevenlabs", "SyntheticVoiceId12345", "file", str(key),
                                         43694, 43693, 3100)
            voice = json.loads((config_dir / "voice.json").read_text())
            self.assertEqual(voice["audio_transport"], "browser")
            self.assertEqual(voice["browser_audio_port"], 43695)
            self.assertEqual(voice["speaker_profile"], str(state / "voice/profiles/owner/embeddings/owner_ecapa.npy"))
            self.assertEqual(voice["hermes_url"], "http://127.0.0.1:43693/v1/chat/completions")
            self.assertNotIn("synthetic-test-key", json.dumps(voice))
            with patch.object(prepare_voice, "STATE", state), patch.object(prepare_voice, "BRIDGE_KEY", state / "data/voice-bridge/auth.key"):
                missing = prepare_voice.missing_prerequisites(voice)
            self.assertIn("private trained owner speaker profile", missing)
            self.assertIn("private trained personal wake model and metadata", missing)

    def test_adapter_switch_keeps_other_sections(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "adapters.yaml"
            path.write_text("allowlist: {}\nadapters:\n  voice:\n    provider: friday-voice-http\n    enabled: false\n  calendar:\n    provider: local-calendar\n")
            path.chmod(0o640)
            enable_voice_adapter.configure(path, 43694, "Hey Friday")
            data = enable_voice_adapter.yaml.safe_load(path.read_text())
            self.assertEqual(data["adapters"]["voice"]["provider"], "friday-voice-http")
            self.assertEqual(data["adapters"]["voice"]["config"]["baseUrl"], "http://127.0.0.1:43694")
            self.assertEqual(data["adapters"]["calendar"]["provider"], "local-calendar")
            enable_voice_adapter.configure(path, 43694, "Hey Friday", disable=True)
            data = enable_voice_adapter.yaml.safe_load(path.read_text())
            self.assertEqual(data["adapters"]["voice"]["provider"], "friday-voice-http")
            self.assertIs(data["adapters"]["voice"]["enabled"], False)
            self.assertNotIn("config", data["adapters"]["voice"])


if __name__ == "__main__":
    unittest.main()
