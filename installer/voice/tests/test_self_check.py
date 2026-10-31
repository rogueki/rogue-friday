import datetime
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from self_check import AREAS, diagnose, spoken_summary


NOW = datetime.datetime(2024, 5, 1, 21, 0, tzinfo=datetime.timezone.utc)


def base_status(**overrides):
    status = {
        "audio_transport": "local",
        "input_stream_active": True,
        "input_device_name": "USB-Mikrofon",
        "wake_phrase": "F.R.I.D.A.Y.",
        "runtime_settings": {
            "wakeWordEnabled": True,
            "speakerVerificationRequired": False,
        },
        "speaker_profile": None,
        "conversation": {"backend": "local"},
    }
    status.update(overrides)
    return status


def finding_for(findings, area):
    for finding in findings:
        if finding["bereich"] == area:
            return finding
    return None


class DiagnoseTest(unittest.TestCase):
    def test_clean_status_reports_every_area_ok(self):
        findings = diagnose(
            base_status(),
            quiet_state=lambda: {"active": False},
            system_status=lambda: {"answer": "Alle Dienste laufen."},
            now=NOW,
        )
        self.assertEqual(
            [finding["bereich"] for finding in findings],
            ["mikrofon", "wake_word", "sprecher", "qwen", "dashboard", "ruhemodus", "system"],
        )
        self.assertTrue(all(finding["ok"] for finding in findings))

    def test_microphone_error_is_reported_without_raw_text(self):
        findings = diagnose(base_status(audio_error="ALSA: device busy"), now=NOW)
        mikrofon = finding_for(findings, "mikrofon")
        self.assertFalse(mikrofon["ok"])
        self.assertEqual(
            mikrofon["text"],
            "Das Mikrofon meldet einen Fehler. "
            "Prüfe unter Einstellungen → Sprache das Eingabegerät.",
        )
        self.assertNotIn("ALSA", mikrofon["text"])

    def test_inactive_stream_is_reported_for_local_transport(self):
        findings = diagnose(base_status(input_stream_active=False), now=NOW)
        mikrofon = finding_for(findings, "mikrofon")
        self.assertFalse(mikrofon["ok"])
        self.assertEqual(mikrofon["text"], "Das Mikrofon nimmt gerade nicht auf.")

    def test_browser_transport_without_stream_is_ok(self):
        findings = diagnose({"audio_transport": "browser", "input_stream_active": False}, now=NOW)
        self.assertEqual(len(findings), 1)
        self.assertTrue(findings[0]["ok"])
        self.assertEqual(findings[0]["text"], "Das Mikrofon läuft über den Browser.")

    def test_wake_word_disabled(self):
        status = base_status(
            runtime_settings={"wakeWordEnabled": False, "speakerVerificationRequired": False}
        )
        wake_word = finding_for(diagnose(status, now=NOW), "wake_word")
        self.assertFalse(wake_word["ok"])
        self.assertIn("Wake Word ist ausgeschaltet", wake_word["text"])

    def test_speaker_verification_without_profile(self):
        status = base_status(
            speaker_profile=None,
            runtime_settings={"wakeWordEnabled": True, "speakerVerificationRequired": True},
        )
        sprecher = finding_for(diagnose(status, now=NOW), "sprecher")
        self.assertFalse(sprecher["ok"])
        self.assertEqual(
            sprecher["text"],
            "Die Sprecherprüfung ist an, aber es gibt kein Sprecherprofil.",
        )

    def test_rejected_speaker_commands_are_counted(self):
        status = base_status(
            speaker_profile={"name": "Chef"},
            rejected_speaker=3,
            runtime_settings={"wakeWordEnabled": True, "speakerVerificationRequired": True},
        )
        sprecher = finding_for(diagnose(status, now=NOW), "sprecher")
        self.assertFalse(sprecher["ok"])
        self.assertEqual(
            sprecher["text"],
            "Seit dem Start habe ich 3 Befehle abgelehnt, weil die Stimme nicht passte.",
        )

    def test_speaker_area_is_skipped_without_runtime_settings(self):
        findings = diagnose({"speaker_profile": None, "rejected_speaker": 5}, now=NOW)
        self.assertIsNone(finding_for(findings, "sprecher"))

    def test_qwen_without_key(self):
        status = base_status(conversation={"backend": "qwen", "key_configured": False})
        qwen = finding_for(diagnose(status, now=NOW), "qwen")
        self.assertFalse(qwen["ok"])
        self.assertEqual(qwen["text"], "Für den Qwen-Modus fehlt der Schlüssel.")

    def test_qwen_auth_error(self):
        status = base_status(
            conversation={"backend": "qwen", "key_configured": True, "last_error": "auth"}
        )
        qwen = finding_for(diagnose(status, now=NOW), "qwen")
        self.assertFalse(qwen["ok"])
        self.assertEqual(qwen["text"], "Der Qwen-Schlüssel wurde abgelehnt.")

    def test_qwen_other_error_is_reported_without_raw_text(self):
        status = base_status(
            conversation={"backend": "qwen", "key_configured": True, "last_error": "timeout"}
        )
        qwen = finding_for(diagnose(status, now=NOW), "qwen")
        self.assertFalse(qwen["ok"])
        self.assertEqual(qwen["text"], "Die Verbindung zu Qwen meldet einen Fehler.")
        self.assertNotIn("timeout", qwen["text"])

    def test_local_backend_is_ok(self):
        qwen = finding_for(diagnose(base_status(), now=NOW), "qwen")
        self.assertTrue(qwen["ok"])
        self.assertEqual(qwen["text"], "Lokaler Sprachbetrieb.")

    def test_quiet_state_error_hides_quiet_mode(self):
        def broken():
            raise RuntimeError("dashboard weg")

        findings = diagnose(base_status(), quiet_state=broken, now=NOW)
        dashboard = finding_for(findings, "dashboard")
        self.assertFalse(dashboard["ok"])
        self.assertEqual(
            dashboard["text"],
            "Das Dashboard ist für mich nicht erreichbar. "
            "Aufträge und Ansagen funktionieren dann nicht.",
        )
        self.assertIsNone(finding_for(findings, "ruhemodus"))

    def test_night_mode_shows_the_local_time(self):
        quiet = lambda: {
            "active": True,
            "source": "schedule",
            "until": "2024-05-01T22:30:00+00:00",
        }
        findings = diagnose(base_status(), quiet_state=quiet, now=NOW)
        ruhemodus = finding_for(findings, "ruhemodus")
        self.assertFalse(ruhemodus["ok"])
        self.assertEqual(
            ruhemodus["text"],
            "Nachtruhe aktiv bis 22:30 Uhr. Ansagen kommen erst danach.",
        )
        self.assertTrue(finding_for(findings, "dashboard")["ok"])

    def test_temporary_quiet_mode_is_named_ruhemodus(self):
        quiet = lambda: {"active": True, "source": "temporary", "until": "2024-05-01T22:30:00Z"}
        ruhemodus = finding_for(diagnose(base_status(), quiet_state=quiet, now=NOW), "ruhemodus")
        self.assertEqual(
            ruhemodus["text"],
            "Ruhemodus aktiv bis 22:30 Uhr. Ansagen kommen erst danach.",
        )

    def test_unreadable_quiet_until_is_omitted(self):
        quiet = lambda: {"active": True, "source": "schedule", "until": "morgen"}
        ruhemodus = finding_for(diagnose(base_status(), quiet_state=quiet, now=NOW), "ruhemodus")
        self.assertEqual(ruhemodus["text"], "Nachtruhe aktiv. Ansagen kommen erst danach.")

    def test_quiet_mode_uses_the_timezone_of_now(self):
        tz = datetime.timezone(datetime.timedelta(hours=2))
        now = datetime.datetime(2024, 5, 1, 23, 0, tzinfo=tz)
        quiet = lambda: {
            "active": True,
            "source": "schedule",
            "until": "2024-05-01T21:15:00+00:00",
        }
        ruhemodus = finding_for(diagnose(base_status(), quiet_state=quiet, now=now), "ruhemodus")
        self.assertEqual(
            ruhemodus["text"],
            "Nachtruhe aktiv bis 23:15 Uhr. Ansagen kommen erst danach.",
        )

    def test_system_status_offline_is_not_ok(self):
        answer = "Das Dashboard ist nicht online, ich erreiche es gerade nicht."
        findings = diagnose(base_status(), system_status=lambda: {"answer": answer}, now=NOW)
        system = finding_for(findings, "system")
        self.assertFalse(system["ok"])
        self.assertEqual(system["text"], answer)

    def test_system_status_answer_is_shortened(self):
        answer = "Alles läuft. " + "x" * 400
        findings = diagnose(base_status(), system_status=lambda: {"answer": answer}, now=NOW)
        system = finding_for(findings, "system")
        self.assertTrue(system["ok"])
        self.assertLessEqual(len(system["text"]), 300)

    def test_system_status_error_is_skipped(self):
        def broken():
            raise RuntimeError("keine Antwort")

        findings = diagnose(base_status(), system_status=broken, now=NOW)
        self.assertIsNone(finding_for(findings, "system"))

    def test_memory_capture_error(self):
        findings = diagnose(base_status(memory_capture_error="disk voll"), now=NOW)
        gedaechtnis = finding_for(findings, "gedaechtnis")
        self.assertFalse(gedaechtnis["ok"])
        self.assertEqual(gedaechtnis["text"], "Das Gedächtnis kann gerade nichts speichern.")

    def test_memory_pending_entries(self):
        findings = diagnose(base_status(memory_pending=25), now=NOW)
        gedaechtnis = finding_for(findings, "gedaechtnis")
        self.assertFalse(gedaechtnis["ok"])
        self.assertEqual(
            gedaechtnis["text"],
            "25 Gedächtniseinträge warten auf die Übertragung.",
        )

    def test_memory_pending_below_threshold_is_silent(self):
        findings = diagnose(base_status(memory_pending=19), now=NOW)
        self.assertIsNone(finding_for(findings, "gedaechtnis"))

    def test_empty_status_without_helpers(self):
        findings = diagnose({}, now=NOW)
        self.assertEqual(findings, [])
        self.assertEqual(spoken_summary(findings), "Dazu habe ich gerade keine Messwerte.")


class SpokenSummaryTest(unittest.TestCase):
    def test_areas_are_documented_in_order(self):
        self.assertEqual(
            AREAS,
            (
                "mikrofon",
                "wake_word",
                "sprecher",
                "qwen",
                "dashboard",
                "ruhemodus",
                "system",
                "gedaechtnis",
            ),
        )

    def test_clean_findings_use_the_first_two_ok_texts(self):
        findings = diagnose(base_status(), now=NOW)
        self.assertEqual(
            spoken_summary(findings),
            "Ich finde keinen Fehler. "
            "Mikrofon aktiv: USB-Mikrofon. "
            "Wake Word „F.R.I.D.A.Y.“ ist aktiv.",
        )

    def test_problems_are_limited_and_follow_area_order(self):
        status = {
            "audio_error": "kaputt",
            "runtime_settings": {"wakeWordEnabled": False, "speakerVerificationRequired": True},
            "conversation": {"backend": "qwen", "key_configured": False},
            "memory_pending": 25,
        }
        quiet = lambda: {
            "active": True,
            "source": "schedule",
            "until": "2024-05-01T22:30:00+00:00",
        }
        findings = diagnose(status, quiet_state=quiet, now=NOW)
        self.assertEqual(
            [finding["bereich"] for finding in findings],
            [
                "mikrofon",
                "wake_word",
                "sprecher",
                "qwen",
                "dashboard",
                "ruhemodus",
                "gedaechtnis",
            ],
        )
        summary = spoken_summary(findings)
        self.assertTrue(summary.startswith("Mir fällt auf: Das Mikrofon meldet einen Fehler."))
        self.assertIn("Wake Word ist ausgeschaltet", summary)
        self.assertIn("kein Sprecherprofil", summary)
        self.assertNotIn("Qwen", summary)
        self.assertTrue(
            summary.endswith("Weitere Punkte stehen im Dashboard unter Sprache.")
        )

    def test_limit_controls_the_number_of_problem_texts(self):
        status = {
            "audio_error": "kaputt",
            "runtime_settings": {"wakeWordEnabled": False, "speakerVerificationRequired": True},
            "conversation": {"backend": "qwen", "key_configured": False},
        }
        summary = spoken_summary(diagnose(status, now=NOW), limit=2)
        self.assertTrue(summary.startswith("Mir fällt auf: Das Mikrofon meldet einen Fehler."))
        self.assertNotIn("Sprecherprofil", summary)
        self.assertIn("Weitere Punkte stehen im Dashboard unter Sprache.", summary)

    def test_no_hint_when_every_problem_fits(self):
        status = base_status(audio_error="kaputt", wake_phrase="")
        status["runtime_settings"] = {
            "wakeWordEnabled": False,
            "speakerVerificationRequired": False,
        }
        summary = spoken_summary(diagnose(status, now=NOW), limit=5)
        self.assertTrue(summary.startswith("Mir fällt auf: "))
        self.assertNotIn("Weitere Punkte", summary)


if __name__ == "__main__":
    unittest.main()
