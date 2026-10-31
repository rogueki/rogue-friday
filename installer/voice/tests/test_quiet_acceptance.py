"""Acceptance cases 19-23 (quiet mode, night quiet, summary) in both conversation modes.

The Qwen mode reaches the quiet mode through the model's tool call, the local mode through the deterministic
pre-stage; both must end up with the same Control API calls and the same spoken summary. Delivery of text messages
(voice_off) and the restart are Control API behaviour, covered in apps/control-api (quiet-mode tests).
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from conversation import QuietGate  # noqa: E402
from test_conversation import Harness  # noqa: E402

INACTIVE = {"active": False, "source": None, "until": None, "temporaryUntil": None, "level": None, "summaryAt": None}


class QuietRig:
    """Orchestrator whose quiet gate reads the fake Control API state directly, so every order is seen at once."""

    def __init__(self):
        holder = {}
        self.gate = QuietGate(lambda: dict(holder["rig"].tasks.quiet), now=lambda: 0.0, ttl_s=0.0)
        self.harness = Harness(quiet_gate=self.gate)
        holder["rig"] = self.harness
        self.tasks = self.harness.tasks
        self.voice = self.harness.voice
        self.tasks.quiet = dict(INACTIVE)
        self.summary_items = []
        self.tasks.quiet_summary = lambda: {"active": False, "periodStart": None, "periodEnd": None,
                                            "items": list(self.summary_items)}

    def quiet_on(self, level="silent", source="temporary", summary_at="end"):
        self.tasks.quiet = {**INACTIVE, "active": True, "source": source, "level": level, "summaryAt": summary_at,
                            "until": "2026-10-31T15:05:00+01:00", "temporaryUntil": "2026-10-31T15:05:00+01:00"}

    def quiet_off(self):
        self.tasks.quiet = dict(INACTIVE)

    def order(self, mode, text, tool_args):
        """Speaks the order in the given mode and returns what Friday answers (local) or the tool result (qwen)."""
        if mode == "local":
            return self.voice.local_command(text)
        return self.voice.call_tool("ruhemodus", tool_args)


MODES = ("local", "qwen")


class Case19TemporaryQuietTest(unittest.TestCase):
    """„Die nächste Stunde will ich nicht gestört werden.“ ⇒ „Ruhemodus bis 15:05.“, ends itself, then the summary."""

    def test_next_hour_sets_the_end_time(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                rig = QuietRig()
                answer = rig.order(mode, "Die nächste Stunde will ich nicht gestört werden.",
                                   {"aktion": "an", "minuten": 60})
                set_calls = [call for call in rig.tasks.quiet_calls if call[0] == "set"]
                self.assertEqual(len(set_calls), 1)
                self.assertTrue(set_calls[0][1].startswith("2026-10-31T15:05"))
                if mode == "local":
                    self.assertTrue(answer.startswith("Ruhemodus bis 15:05 Uhr."), answer)
                else:
                    self.assertEqual(answer["status"], "an")
                    self.assertEqual(answer["bis"], "15:05")

    def test_expiry_speaks_the_held_results(self):
        rig = QuietRig()
        rig.quiet_on()
        rig.harness.finish()
        self.assertIsNone(rig.voice.take_announcement())
        rig.quiet_off()  # the hour is over; nobody said anything
        text = rig.voice.take_announcement()
        self.assertTrue(text.startswith("Während der Ruhezeit ist das fertig geworden: "), text)
        self.assertIn("Drei Anbieter gefunden.", text)
        self.assertIsNone(rig.voice.take_announcement())

    def test_expiry_without_results_still_says_it_is_over(self):
        rig = QuietRig()
        rig.quiet_on()
        rig.voice.observe_quiet()
        self.assertTrue(rig.voice.has_held())
        self.assertIsNone(rig.voice.take_announcement())
        rig.quiet_off()
        self.assertEqual(rig.voice.take_announcement(),
                         "Der Ruhemodus ist vorbei. In der Zwischenzeit ist nichts angekommen.")
        self.assertFalse(rig.voice.has_held())
        self.assertIsNone(rig.voice.take_announcement())

    def test_no_summary_without_a_quiet_period(self):
        rig = QuietRig()
        rig.voice.observe_quiet()
        self.assertFalse(rig.voice.has_held())
        self.assertIsNone(rig.voice.take_announcement())


class Case20NightQuietByVoiceTest(unittest.TestCase):
    """„Nachtruhe ist von 22 bis 7 Uhr.“ sets the schedule in both modes."""

    def test_night_schedule_is_stored(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                rig = QuietRig()
                answer = rig.order(mode, "Nachtruhe ist von 22 bis 7 Uhr.",
                                   {"aktion": "nachtruhe", "von": "22:00", "bis": "07:00"})
                self.assertEqual(rig.tasks.quiet_hours, [(True, "22:00", "07:00")])
                if mode == "local":
                    self.assertEqual(answer, "Nachtruhe von 22:00 bis 07:00 Uhr eingestellt.")
                else:
                    self.assertEqual(answer, {"status": "nachtruhe", "von": "22:00", "bis": "07:00"})

    def test_local_variants(self):
        for text, start, end in (("Stell die Nachtruhe auf 22:30 bis 6.45", "22:30", "06:45"),
                                 ("Nachtruhe von 23 Uhr bis 6 Uhr", "23:00", "06:00")):
            with self.subTest(text=text):
                rig = QuietRig()
                rig.voice.local_command(text)
                self.assertEqual(rig.tasks.quiet_hours, [(True, start, end)])

    def test_questions_and_how_to_do_not_change_the_schedule(self):
        for text in ("Ist die Nachtruhe von 22 bis 7?", "Wie stelle ich die Nachtruhe von 22 bis 7 ein?",
                     "Bis wann ist Nachtruhe?"):
            with self.subTest(text=text):
                rig = QuietRig()
                rig.voice.local_command(text)
                self.assertEqual(rig.tasks.quiet_hours, [])

    def test_impossible_hour_is_refused(self):
        rig = QuietRig()
        self.assertEqual(rig.voice.local_command("Nachtruhe von 25 bis 7"),
                         "Für die Nachtruhe brauche ich Beginn und Ende.")
        self.assertEqual(rig.tasks.quiet_hours, [])

    def test_night_summary_waits_for_the_next_conversation(self):
        rig = QuietRig()
        rig.quiet_on(source="schedule", summary_at="first_interaction")
        rig.harness.finish()
        self.assertIsNone(rig.voice.take_announcement())
        rig.quiet_off()
        rig.harness.now += 120.0
        self.assertIsNone(rig.voice.take_announcement())
        rig.voice.touch()
        self.assertIn("Drei Anbieter gefunden.", rig.voice.take_announcement())


class Case21VoiceOffTest(unittest.TestCase):
    """The voice_off level stays silent but reports every held event once to the Control API, which sends the text."""

    def test_voice_off_level_is_requested_in_both_modes(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                rig = QuietRig()
                rig.order(mode, "Die nächste Stunde nur Stimme aus.",
                          {"aktion": "an", "minuten": 60, "stufe": "stimme_aus"})
                self.assertEqual([call[2] for call in rig.tasks.quiet_calls if call[0] == "set"], ["voice_off"])

    def test_held_question_is_reported_once_and_not_spoken(self):
        rig = QuietRig()
        rig.quiet_on(level="voice_off")
        rig.voice.call_tool("task_create", {"domain": "research", "auftrag": "Recherchiere Stromanbieter"})
        task_id = rig.tasks.pending()[-1]["taskId"]
        rig.voice.task_finished({"taskId": task_id, "domain": "research", "status": "waiting",
                                 "question": "Nur Ökostrom?"})
        self.assertIsNone(rig.voice.take_announcement())
        self.assertIsNone(rig.voice.take_announcement())
        self.assertEqual(len(rig.tasks.notices), 1)
        self.assertEqual(rig.tasks.notices[0][0], "agent_questions")
        rig.quiet_off()
        self.assertIn("Nur Ökostrom?", rig.voice.take_announcement())


class Case22SilentTest(unittest.TestCase):
    """The silent level says nothing during the period; everything comes in the summary afterwards."""

    def test_everything_waits_for_the_summary(self):
        rig = QuietRig()
        rig.quiet_on(level="silent")
        rig.harness.finish()
        rig.harness.finish(auftrag="Prüfe Kündigungsfrist", summary="Drei Monate zum Quartalsende.")
        for _ in range(3):
            self.assertIsNone(rig.voice.take_announcement())
        rig.summary_items = [
            {"class": "approvals", "title": "Mail an Erik Brandt senden", "at": "2026-10-31T14:30:00Z", "delivery": "skipped"},
            {"class": "appointments", "title": "Zahnarzt", "at": "2026-10-31T14:40:00Z", "delivery": "skipped"},
            {"class": "task_results", "title": "Recherchiere Stromanbieter", "at": "2026-10-31T14:20:00Z", "delivery": "skipped"},
        ]
        rig.quiet_off()
        text = rig.voice.take_announcement()
        self.assertIn("Drei Anbieter gefunden.", text)
        self.assertIn("Drei Monate zum Quartalsende.", text)
        self.assertIn("Eine Freigabe wartet: Mail an Erik Brandt senden.", text)
        self.assertIn("Ein Termin in der Ruhezeit: Zahnarzt.", text)
        # task results are already in the spoken part; the dashboard list must not repeat them
        self.assertEqual(text.count("Recherchiere Stromanbieter"), 1)

    def test_dashboard_only_events_are_summarized_alone(self):
        rig = QuietRig()
        rig.quiet_on(level="silent")
        rig.voice.observe_quiet()
        rig.summary_items = [{"class": "approvals", "title": f"Freigabe {n}", "at": "2026-10-31T14:30:00Z",
                              "delivery": "skipped"} for n in range(1, 6)]
        rig.quiet_off()
        self.assertEqual(rig.voice.take_announcement(),
                         "Während der Ruhezeit: 5 Freigaben warten: Freigabe 1, Freigabe 2, Freigabe 3 und weitere.")

    def test_unreachable_dashboard_keeps_the_spoken_results(self):
        rig = QuietRig()
        rig.quiet_on(level="silent")
        rig.harness.finish()
        self.assertIsNone(rig.voice.take_announcement())

        def down():
            raise OSError("control api down")

        rig.tasks.quiet_summary = down
        rig.quiet_off()
        self.assertIn("Drei Anbieter gefunden.", rig.voice.take_announcement())


class Case23QuietOffTest(unittest.TestCase):
    """„Ruhemodus aus“ ends at once and gives the summary in the same answer."""

    def test_off_answers_with_the_summary(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                rig = QuietRig()
                rig.quiet_on()
                rig.harness.finish()
                self.assertIsNone(rig.voice.take_announcement())
                original_clear = rig.tasks.clear_quiet

                def clear():
                    rig.quiet_off()
                    return original_clear()

                rig.tasks.clear_quiet = clear
                answer = rig.order(mode, "Ruhemodus aus.", {"aktion": "aus"})
                if mode == "local":
                    self.assertTrue(answer.startswith("Ruhemodus beendet. Während der Ruhezeit ist das fertig geworden: "),
                                    answer)
                    self.assertIn("Drei Anbieter gefunden.", answer)
                else:
                    self.assertEqual(answer["status"], "aus")
                    self.assertIn("Drei Anbieter gefunden.", answer["zusammenfassung"])
                # spoken once: the announcement loop has nothing left
                self.assertIsNone(rig.voice.take_announcement())
                self.assertFalse(rig.voice.has_held())

    def test_off_without_events_adds_no_second_sentence(self):
        rig = QuietRig()
        rig.quiet_on()
        rig.voice.observe_quiet()
        rig.tasks.clear_quiet = lambda: (rig.quiet_off(), dict(INACTIVE))[1]
        self.assertEqual(rig.voice.local_command("Ruhemodus aus"), "Ruhemodus beendet.")
        self.assertIsNone(rig.voice.take_announcement())

    def test_off_during_night_keeps_the_night_and_holds_the_results(self):
        rig = QuietRig()
        rig.quiet_on(source="schedule", summary_at="first_interaction")
        rig.harness.finish()
        self.assertIsNone(rig.voice.take_announcement())
        answer = rig.voice.local_command("Ruhemodus aus")
        self.assertTrue(answer.startswith("Ruhemodus beendet. Die eingestellte Nachtruhe gilt weiter bis "), answer)
        self.assertNotIn("Drei Anbieter", answer)
        self.assertIsNone(rig.voice.take_announcement())
        self.assertTrue(rig.voice.has_held())


if __name__ == "__main__":
    unittest.main()
