import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import configure_voice


@unittest.skipUnless(os.name == "posix", "Linux-only installer helper")
class ConfigureVoiceTest(unittest.TestCase):
    def test_voice_loader_rejects_weak_permissions_and_symlink(self):
        # Import without installing the full audio stack on the VPS fixture.
        numpy_stub = types.ModuleType("numpy")
        numpy_stub.ndarray = type("ndarray", (), {})
        voice_dir = Path(__file__).resolve().parents[2] / "voice"
        sys.path.insert(0, str(voice_dir))
        with patch.dict(sys.modules, {"numpy": numpy_stub}):
            import importlib
            import elevenlabs_cloud
            importlib.reload(elevenlabs_cloud)
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "secrets"
            directory.mkdir(mode=0o700)
            key = directory / "elevenlabs.key"
            key.write_text("private-test-key\n")
            key.chmod(0o600)
            with patch.object(elevenlabs_cloud, "LINUX_SECRET_FILE", str(key)):
                self.assertEqual(elevenlabs_cloud.load_key(str(key)), "private-test-key")
                key.chmod(0o644)
                with self.assertRaises(RuntimeError):
                    elevenlabs_cloud.load_key(str(key))
                key.unlink()
                key.symlink_to(Path(root) / "other")
                with self.assertRaises(OSError):
                    elevenlabs_cloud.load_key(str(key))

    def test_cloud_writes_private_key_and_config_without_exposing_key(self):
        with tempfile.TemporaryDirectory() as root:
            config_dir = Path(root)
            secret_dir = config_dir / "secrets"
            secret_dir.mkdir(mode=0o700)
            input_file = config_dir / "input.key"
            input_file.write_text("test-private-key\n", encoding="ascii")
            input_file.chmod(0o600)
            voice_id = "SyntheticVoiceId12345"
            with (patch.object(configure_voice, "SECRET_PATH", secret_dir / "elevenlabs.key"),
                  patch.object(configure_voice, "CONFIG_PATH", config_dir / "voice.json"),
                  patch.object(configure_voice.pwd, "getpwnam", return_value=SimpleNamespace(
                      pw_uid=os.getuid(), pw_gid=os.getgid())),
                  patch.object(configure_voice.os, "geteuid", return_value=0),
                  patch.object(configure_voice.os, "fchown"),
                  patch.dict(configure_voice.os.environ, {"SUDO_UID": str(os.getuid())})):
                configure_voice.configure("elevenlabs", voice_id, "file", str(input_file))
            config = json.loads((config_dir / "voice.json").read_text())
            self.assertEqual(config["voice_mode"], "elevenlabs")
            self.assertEqual(config["elevenlabs_voice_id"], voice_id)
            self.assertNotIn("test-private-key", json.dumps(config))
            self.assertEqual((secret_dir / "elevenlabs.key").read_text(), "test-private-key\n")
            self.assertEqual((secret_dir / "elevenlabs.key").stat().st_mode & 0o777, 0o600)
            self.assertEqual((config_dir / "voice.json").stat().st_mode & 0o777, 0o640)

    def test_cloud_reinstall_reuses_valid_id_and_private_key(self):
        with tempfile.TemporaryDirectory() as root:
            config_dir = Path(root)
            secret_dir = config_dir / "secrets"
            secret_dir.mkdir(mode=0o700)
            key = secret_dir / "elevenlabs.key"
            key.write_text("previous-private-key\n")
            key.chmod(0o600)
            existing = {"voice_mode": "elevenlabs", "elevenlabs_voice_id": "SyntheticVoiceId12345",
                        "elevenlabs_key_file": str(key)}
            with (patch.object(configure_voice, "SECRET_PATH", key),
                  patch.object(configure_voice, "CONFIG_PATH", config_dir / "voice.json"),
                  patch.object(configure_voice, "existing_config", return_value=existing),
                  patch.object(configure_voice.pwd, "getpwnam", return_value=SimpleNamespace(
                      pw_uid=os.getuid(), pw_gid=os.getgid())),
                  patch.object(configure_voice.os, "geteuid", return_value=0),
                  patch.object(configure_voice.os, "fchown")):
                configure_voice.configure("elevenlabs", None, None, None)
                self.assertEqual(json.loads((config_dir / "voice.json").read_text())["elevenlabs_voice_id"],
                                 "SyntheticVoiceId12345")
                self.assertEqual(key.read_text(), "previous-private-key\n")
                key.chmod(0o644)
                with self.assertRaisesRegex(ValueError, "unsafe ownership or permissions"):
                    configure_voice.configure("elevenlabs", None, None, None)

    def test_key_rotation_rolls_back_when_config_write_fails(self):
        with tempfile.TemporaryDirectory() as root:
            config_dir = Path(root)
            secret_dir = config_dir / "secrets"
            secret_dir.mkdir(mode=0o700)
            key = secret_dir / "elevenlabs.key"
            key.write_text("previous-private-key\n")
            key.chmod(0o600)
            new_key = config_dir / "new.key"
            new_key.write_text("rotated-private-key\n")
            new_key.chmod(0o600)
            existing = {"voice_mode": "elevenlabs", "elevenlabs_voice_id": "SyntheticVoiceId12345",
                        "elevenlabs_key_file": str(key)}
            original_write = configure_voice.atomic_private_write

            def fail_config(path, data, owner, group, mode):
                if path == config_dir / "voice.json":
                    raise OSError("simulated config failure")
                return original_write(path, data, owner, group, mode)

            with (patch.object(configure_voice, "SECRET_PATH", key),
                  patch.object(configure_voice, "CONFIG_PATH", config_dir / "voice.json"),
                  patch.object(configure_voice, "existing_config", return_value=existing),
                  patch.object(configure_voice.pwd, "getpwnam", return_value=SimpleNamespace(
                      pw_uid=os.getuid(), pw_gid=os.getgid())),
                  patch.object(configure_voice.os, "geteuid", return_value=0),
                  patch.object(configure_voice.os, "fchown"),
                  patch.object(configure_voice, "atomic_private_write", side_effect=fail_config),
                  patch.dict(configure_voice.os.environ, {"SUDO_UID": str(os.getuid())})):
                with self.assertRaisesRegex(OSError, "simulated config failure"):
                    configure_voice.configure("elevenlabs", None, "file", str(new_key))
            self.assertEqual(key.read_text(), "previous-private-key\n")

    def test_rejects_world_readable_input(self):
        with tempfile.TemporaryDirectory() as root:
            input_file = Path(root) / "key"
            input_file.write_text("secret")
            input_file.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "private regular file"):
                configure_voice.read_key("file", str(input_file))

    def test_local_configuration_has_no_key_or_voice_id(self):
        with tempfile.TemporaryDirectory() as root:
            config_dir = Path(root)
            (config_dir / "secrets").mkdir(mode=0o700)
            with (patch.object(configure_voice, "SECRET_PATH", config_dir / "secrets/elevenlabs.key"),
                  patch.object(configure_voice, "CONFIG_PATH", config_dir / "voice.json"),
                  patch.object(configure_voice.pwd, "getpwnam", return_value=SimpleNamespace(
                      pw_uid=os.getuid(), pw_gid=os.getgid())),
                  patch.object(configure_voice.os, "geteuid", return_value=0),
                  patch.object(configure_voice.os, "fchown")):
                configure_voice.configure("local", None, None, None)
            config = json.loads((config_dir / "voice.json").read_text())
            self.assertEqual(config["voice_mode"], "streaming_qwen")
            self.assertIsNone(config["elevenlabs_key_file"])
            self.assertIsNone(config["elevenlabs_voice_id"])


if __name__ == "__main__":
    unittest.main()
