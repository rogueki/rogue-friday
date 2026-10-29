"""Secret values must never reach the speech output."""

import importlib.util
import sys
import unittest
from pathlib import Path

VOICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(VOICE))

from speech_redaction import redact_secrets


class RedactSecretsTests(unittest.TestCase):
    def test_labeled_password_with_lautet(self):
        result = redact_secrets("Das Passwort lautet Sommer2026!")
        self.assertNotIn("Sommer2026", result)
        self.assertIn("Passwort lautet", result)
        self.assertIn("ausgeblendet", result)

    def test_labeled_api_key_values(self):
        self.assertNotIn("abc123def456", redact_secrets("api_key=abc123def456"))
        result = redact_secrets('API-Key: "x y z"')
        self.assertNotIn("x y z", result)
        self.assertIn("ausgeblendet", result)

    def test_bearer_token(self):
        result = redact_secrets("Authorization: Bearer abcdefghijkl12345")
        self.assertNotIn("abcdefghijkl12345", result)

    def test_known_key_formats(self):
        samples = {
            "openai": "sk-ABCDEFGHIJKLMNOPQRSTUV",
            "github": "ghp_" + "aB3dE5gH7jK9mN1pQ3sT5vX7",
            "telegram": "123456789:" + "AAFxyz_abcDEF0123456789ghiJKLmnop12",
            "aws": "AKIA" + "ABCD1234EFGH5678",
        }
        for name, secret in samples.items():
            with self.subTest(name=name):
                result = redact_secrets(f"Dein Key {secret} bitte merken")
                self.assertNotIn(secret, result)
                self.assertIn("ausgeblendet", result)

    def test_long_random_string(self):
        secret = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
        self.assertEqual(len(secret), 40)
        self.assertNotIn(secret, redact_secrets(f"Hash {secret} fertig"))

    def test_normal_sentences_stay_unchanged(self):
        for sentence in (
            "Der Token ist abgelaufen.",
            "Donaudampfschifffahrtsgesellschaftskapitaen kommt um 15 Uhr.",
            "Termin am 21.10.2026 um 15 Uhr",
            "Deine PIN-Eingabe war korrekt.",
        ):
            with self.subTest(sentence=sentence):
                self.assertEqual(redact_secrets(sentence), sentence)

    def test_empty_input(self):
        self.assertEqual(redact_secrets(""), "")


class CleanForSpeechTests(unittest.TestCase):
    def test_clean_for_speech_drops_secret_and_url(self):
        # Reuse the existing voice test's isolated dependency stubs; no model is initialized.
        source = VOICE / "tests" / "test_personal_wake.py"
        spec = importlib.util.spec_from_file_location("isolated_voice_test_helpers", source)
        helpers = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helpers)
        voice_module = helpers.load_voice_module()
        spoken = voice_module.clean_for_speech("Das **Passwort**: geheim_wert_123 https://x.example")
        self.assertNotIn("geheim", spoken)
        self.assertNotIn("https", spoken)


if __name__ == "__main__":
    unittest.main()
