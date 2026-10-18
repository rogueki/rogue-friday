import json
import sys
import tempfile
import unittest
import shutil
import hashlib
from pathlib import Path
from unittest.mock import patch


VOICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(VOICE))
sys.path.insert(0, str(VOICE.parent / "fast_tts"))
import voice_persona
import server
import prepare_voice_pairs


class Response:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps({"voices": ["friday-female", "classic"]}).encode()


class VoicePersonaTest(unittest.TestCase):
    def test_local_streaming_uses_two_actual_references_and_preserves_other_config(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            refs = root / "config" / "voice-references"
            models = root / "models" / "tts"
            refs.mkdir(parents=True)
            models.mkdir(parents=True)
            for choice, name in (("friday-female", "de_DE-kerstin-low"), ("classic", "de_DE-thorsten-medium")):
                (refs / f"{choice}-reference.wav").write_bytes(b"reference")
                (refs / f"{choice}-streaming.wav").write_bytes(b"streaming")
                (refs / f"{choice}-reference.txt").write_text("Test words", encoding="utf-8")
                (models / f"{name}.onnx").write_bytes(b"piper")
            cfg = {"voice_mode": "local", "tts_backend": "streaming_qwen",
                   "tts_url": "http://127.0.0.1:43795/tts/stream", "wake_phrase": "Hey Friday"}
            with patch.object(voice_persona.urllib.request, "urlopen", return_value=Response()):
                female = voice_persona.resolve(cfg, temp, "friday-female")
                male = voice_persona.resolve(female, temp, "classic")
            self.assertEqual(female["tts_reference"], str(refs / "friday-female-streaming.wav"))
            self.assertEqual(male["tts_reference"], str(refs / "classic-streaming.wav"))
            self.assertEqual(male["wake_phrase"], "Hey Friday")
            self.assertTrue(female["tts_persona_streaming"] and male["tts_persona_streaming"])
            self.assertFalse(female["tts_film_filter"])
            self.assertTrue(male["tts_film_filter"])

    def test_missing_reference_and_old_tts_server_are_not_claimed_available(self):
        with tempfile.TemporaryDirectory() as temp:
            cfg = {"voice_mode": "local", "tts_backend": "streaming_qwen",
                   "tts_url": "http://127.0.0.1:43795/tts/stream"}
            with self.assertRaises(voice_persona.PersonaUnavailable):
                voice_persona.resolve(cfg, temp, "classic")
            refs = Path(temp) / "config" / "voice-references"
            models = Path(temp) / "models" / "tts"
            refs.mkdir(parents=True)
            models.mkdir(parents=True)
            (refs / "classic-reference.wav").write_bytes(b"reference")
            (refs / "classic-streaming.wav").write_bytes(b"streaming")
            (refs / "classic-reference.txt").write_text("Test words", encoding="utf-8")
            (models / "de_DE-thorsten-medium.onnx").write_bytes(b"piper")
            with patch.object(voice_persona.urllib.request, "urlopen", return_value=Response()):
                # The server response must explicitly advertise the requested persona.
                with patch.object(Response, "read", return_value=b'{"voices":[]}'):
                    with self.assertRaisesRegex(voice_persona.PersonaUnavailable, "Stimmen-Update"):
                        voice_persona.resolve(cfg, temp, "classic")

    def test_elevenlabs_requires_per_persona_saved_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            key = Path(temp) / "key.dpapi"
            key.write_bytes(b"stored")
            cfg = {"voice_mode": "elevenlabs", "elevenlabs_key_file": str(key),
                   "elevenlabs_voice_ids": {"friday-female": "female-id"}, "wake_phrase": "Hey Friday"}
            self.assertEqual(voice_persona.resolve(cfg, temp, "friday-female")["elevenlabs_voice_id"], "female-id")
            with self.assertRaises(voice_persona.PersonaUnavailable):
                voice_persona.resolve(cfg, temp, "classic")

    def test_fast_tts_selects_only_installed_pair(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            for choice in ("friday-female", "classic"):
                (folder / f"{choice}.wav").write_bytes(choice.encode())
                (folder / f"{choice}.txt").write_text(f"Words by {choice}", encoding="utf-8")
            voices = server.load_voice_clones(folder)
            self.assertEqual(server.select_voice("classic", voices, {})["ref_audio"], str(folder / "classic.wav"))
            self.assertEqual(server.select_voice("friday-female", voices, {})["ref_audio"], str(folder / "friday-female.wav"))
            with self.assertRaises(KeyError):
                server.select_voice("unknown", voices, {})

    def test_bundled_real_pairs_prepare_without_replacing_custom_setup(self):
        package = VOICE.parent
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            models = root / "models" / "tts"
            models.mkdir(parents=True)
            for name in ("de_DE-kerstin-low", "de_DE-thorsten-medium"):
                for extension in (".onnx", ".onnx.json"):
                    (models / f"{name}{extension}").write_bytes(b"installed")
            refs = root / "config" / "voice-references"
            refs.mkdir(parents=True)
            custom = refs / "friday-female-reference.wav"
            shutil.copy2(package / "voice_models" / "friday_ref.wav", custom)
            custom_text = refs / "friday-female-reference.txt"
            custom_text.write_text("Lokal eingestellter Referenztext\n", encoding="utf-8")
            original = hashlib.sha256(custom.read_bytes()).digest()
            available = prepare_voice_pairs.prepare(root, package)
            self.assertEqual(available, {"friday-female": True, "classic": True})
            self.assertEqual(hashlib.sha256(custom.read_bytes()).digest(), original)
            self.assertEqual(custom_text.read_text(encoding="utf-8"), "Lokal eingestellter Referenztext\n")
            for choice in available:
                self.assertTrue((refs / f"{choice}-reference.wav").is_file())
                self.assertTrue((refs / f"{choice}-reference.txt").read_text(encoding="utf-8").strip())


if __name__ == "__main__":
    unittest.main()
