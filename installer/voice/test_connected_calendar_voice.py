import datetime as dt
import unittest

from calendar_voice import CalendarVoice


class StubCalendarVoice(CalendarVoice):
    def __init__(self):
        super().__init__("/tmp", zone="Europe/Berlin")
        self.calls = []

    def _safe_request(self, path, body, request_key=None):
        self.calls.append((path, body, request_key))
        if path == "preview":
            return {"token": "fixture-token", "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=60)).isoformat(),
                    "accountId": "account-1", "calendarId": "calendar-1", "eventId": "", "etag": "",
                    "calendarName": "Arbeit", "event": {"title": body["title"], "start": body["start"], "end": body["end"]}}, None
        return {"state": "created"}, None


class ConnectedCalendarVoiceTest(unittest.TestCase):
    def test_named_calendar_preview_and_exact_confirmation(self):
        voice = StubCalendarVoice()
        preview = voice.handle("Erstelle Termin Probe am 20.10.2026 um 14 Uhr im Kalender Arbeit")
        self.assertIn("im Kalender Arbeit", preview)
        self.assertEqual(voice.calls[0][1]["calendarName"], "Arbeit")
        voice.arm_confirmation()
        self.assertIn("verbundenen Kalender angelegt", voice.handle("Ja"))
        self.assertEqual(voice.calls[1][0], "confirm")
        self.assertEqual({key: voice.calls[1][1][key] for key in ("accountId", "calendarId", "eventId", "etag")},
                         {"accountId": "account-1", "calendarId": "calendar-1", "eventId": "", "etag": ""})
        self.assertEqual(voice.calls[1][1]["request"], voice.calls[0][1])
        self.assertTrue(voice.calls[1][2].startswith("idem_voice_calendar_"))

    def test_no_confirmation_before_preview_was_spoken(self):
        voice = StubCalendarVoice()
        voice.handle("Erstelle Termin Probe am 20.10.2026 um 14 Uhr im Kalender Arbeit")
        self.assertIn("unterbrochen", voice.handle("Ja"))
        self.assertEqual(len(voice.calls), 1)


if __name__ == "__main__":
    unittest.main()
