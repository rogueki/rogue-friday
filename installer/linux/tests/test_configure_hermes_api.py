import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import configure_hermes_api
import prepare_voice


@unittest.skipUnless(os.name == "posix", "Linux-only Hermes configuration")
class HermesApiConfigurationTest(unittest.TestCase):
    def test_preserves_provider_and_reuses_matching_key(self):
        with tempfile.TemporaryDirectory() as root:
            home = Path(root) / ".hermes"
            private = Path(root) / "secrets"
            home.mkdir()
            private.mkdir()
            env = home / ".env"
            key_file = private / "hermes-api.key"
            env.write_text("KIMI_API_KEY=synthetic-provider-secret\nAPI_SERVER_HOST=0.0.0.0\n")
            user = __import__("pwd").getpwuid(os.getuid()).pw_name
            configure_hermes_api.configure(env, key_file, 43693, user)
            first_key = key_file.read_text().strip()
            configure_hermes_api.configure(env, key_file, 43793, user)
            result = env.read_text()
            self.assertEqual(first_key, key_file.read_text().strip())
            self.assertIn("KIMI_API_KEY=synthetic-provider-secret", result)
            self.assertIn("API_SERVER_HOST=127.0.0.1", result)
            self.assertIn("API_SERVER_PORT=43793", result)
            self.assertEqual(result.count("API_SERVER_KEY="), 1)
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)
            self.assertEqual(key_file.stat().st_mode & 0o777, 0o600)

    def test_rejects_symlinked_key_without_changing_env(self):
        with tempfile.TemporaryDirectory() as root:
            home = Path(root) / ".hermes"
            private = Path(root) / "secrets"
            home.mkdir()
            private.mkdir()
            env = home / ".env"
            env.write_text("ANTHROPIC_API_KEY=synthetic\n")
            (private / "hermes-api.key").symlink_to(env)
            user = __import__("pwd").getpwuid(os.getuid()).pw_name
            with self.assertRaises(ValueError):
                configure_hermes_api.configure(env, private / "hermes-api.key", 43693, user)
            self.assertEqual(env.read_text(), "ANTHROPIC_API_KEY=synthetic\n")

    def test_voice_readiness_uses_bearer_authentication(self):
        with tempfile.TemporaryDirectory() as root:
            key = Path(root) / "hermes-api.key"
            key.write_text("synthetic-test-token\n")
            key.chmod(0o600)
            requests = []

            class Response:
                status = 200

                def __enter__(self):
                    return self

                def __exit__(self, *_):
                    return False

            class Opener:
                def open(self, request, timeout):
                    requests.append(request)
                    return Response()

            config = {"voice_mode": "elevenlabs", "audio_transport": "browser",
                      "hermes_key_file": str(key),
                      "hermes_url": "http://127.0.0.1:43693/v1/chat/completions"}
            with patch.object(prepare_voice.urllib.request, "build_opener", return_value=Opener()):
                missing = prepare_voice.missing_prerequisites(config)
            self.assertNotIn("authenticated loopback Hermes API server", missing)
            self.assertEqual(requests[0].full_url, "http://127.0.0.1:43693/v1/models")
            self.assertEqual(requests[0].get_header("Authorization"), "Bearer synthetic-test-token")


if __name__ == "__main__":
    unittest.main()
