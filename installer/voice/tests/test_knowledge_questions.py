"""P0-12: the shipped help bundle answers the 20 typical help questions with the right section."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from knowledge import KnowledgeBase

# (question, expected source, must be the first hit)
QUESTIONS = [
    ("Wie stelle ich das Wake Word um?", "ablaeufe.md › Wake Word im Dashboard einlernen", True),
    ("Wie verbinde ich meinen Kalender?", "ablaeufe.md › Kalender verbinden", True),
    ("Wo stelle ich den Wetterort ein?", "ablaeufe.md › Wetterort festlegen", True),
    ("Wie wechsle ich auf Qwen?", "ablaeufe.md › Sprachbetrieb wechseln", True),
    ("Warum hört Friday mich nicht?", "fehlerbilder.md › F.R.I.D.A.Y. hört nicht", True),
    ("Wie lerne ich meine Stimme an?", "ablaeufe.md › Stimme anlernen", True),
    ("Wie richte ich Telegram ein?", "ablaeufe.md › Telegram einrichten", True),
    ("Wo sind die offenen Freigaben?", "seiten.md › Freigaben", False),
    ("Wie schalte ich die Nachtruhe ein?", "ablaeufe.md › Ruhemodus und Nachtruhe einstellen", True),
    ("Wie installiere ich ein Update?", "ablaeufe.md › Dashboard-Update installieren", True),
    ("Wie mache ich ein Backup?", "ablaeufe.md › Backup erstellen", True),
    ("Was passiert mit meinen Daten?", "datenschutz.md › Was auf diesem PC bleibt", False),
    ("Wo finde ich das Audit-Protokoll?", "datenschutz.md › Audit-Protokoll", True),
    ("Wie verbinde ich ein E-Mail-Konto?", "ablaeufe.md › E-Mail-Konto verbinden", True),
    ("Warum kommen keine Ansagen?", "fehlerbilder.md › Ansagen kommen nicht (Ruhemodus aktiv)", True),
    ("Der Kalender ist leer, was tun?", "fehlerbilder.md › Kalender zeigt keine Termine", True),
    ("Wie lange wird der Sprachverlauf gespeichert?", "einstellungen.md › Sprache", False),
    ("Wo ändere ich das Theme?", "einstellungen.md › Theme", True),
    ("Was macht der Content Studio Bereich?", "seiten.md › Content Studio", False),
    ("Agenten sind nicht erreichbar", "fehlerbilder.md › Hermes oder Agenten nicht erreichbar", True),
]


class ShippedKnowledgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.knowledge = KnowledgeBase()

    def test_twenty_help_questions_find_their_section(self):
        self.assertEqual(len(QUESTIONS), 20)
        for question, expected, first in QUESTIONS:
            with self.subTest(question=question):
                sources = [hit["quelle"].rsplit("/", 1)[-1] for hit in self.knowledge.search(question)]
                if first:
                    self.assertEqual(sources[:1], [expected])
                else:
                    self.assertIn(expected, sources)

    def test_small_talk_finds_no_help(self):
        self.assertEqual(self.knowledge.search("Erzähl mir einen Witz über Pinguine"), [])

    def test_overview_names_the_dashboard_pages(self):
        overview = self.knowledge.overview()
        for page in ("Übersicht", "Kalender", "Einstellungen"):
            self.assertIn(page, overview)


if __name__ == "__main__":
    unittest.main()
