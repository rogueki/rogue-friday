import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cloudtalk_voice import CloudTalkVoice, normalize_number


class CloudTalkVoiceTest(unittest.TestCase):
    def test_requires_spoken_confirmation_before_opening_protocol(self):
        opened = []
        voice = CloudTalkVoice(now=lambda: 10, open_url=opened.append)
        preview = voice.handle("Rufe 0170 1234567 über CloudTalk an")
        self.assertIn("+ 4 9 1 7 0", preview)
        self.assertEqual(opened, [])
        voice.arm_confirmation()
        answer = voice.handle("Ja")
        self.assertEqual(opened, ["ct+tel:+491701234567"])
        self.assertIn("nicht prüfen", answer)

    def test_cancel_timeout_and_interruption(self):
        opened = []
        now = [10]
        voice = CloudTalkVoice(now=lambda: now[0], open_url=opened.append)
        voice.handle("Rufe +491701234567 über CloudTalk an")
        self.assertIn("verworfen", voice.handle("Nein"))
        voice.handle("Rufe +491701234567 über CloudTalk an")
        voice.arm_confirmation()
        now[0] = 101
        self.assertIn("abgelaufen", voice.handle("Ja"))
        now[0] = 10
        voice.handle("Rufe +491701234567 über CloudTalk an")
        voice.arm_confirmation()
        self.assertIsNone(voice.handle("Wie ist das Wetter?"))
        self.assertIsNone(voice.handle("Ja"))
        self.assertEqual(opened, [])

    def test_rejects_non_phone_input(self):
        with self.assertRaises(ValueError):
            normalize_number("+49170;calc")


if __name__ == "__main__":
    unittest.main()
