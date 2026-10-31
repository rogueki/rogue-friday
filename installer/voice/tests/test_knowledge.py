import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from knowledge import KnowledgeBase, normalize_tokens


SECTIONS = [
    {
        "id": "kalender-verbinden",
        "file": "seite-kalender.md",
        "title": "Kalender verbinden",
        "area": "seite:/calendar",
        "keywords": ["Kalender", "verbinden", "Termine", "Google"],
        "text": (
            "Öffne im Dashboard den Bereich Kalender und wähle Kalender verbinden. "
            "Danach erscheinen die Termine in der Tagesübersicht."
        ),
    },
    {
        "id": "wake-word-aendern",
        "file": "einstellungen-sprache.md",
        "title": "Wake Word ändern",
        "area": "einstellungen:voice",
        "keywords": ["Wake Word", "ändern", "Sprache", "einstellen", "Aktivierung"],
        "text": (
            "Das Wake Word stellst du im Bereich Sprache ein. "
            "Sprich das neue Wort dreimal deutlich aus."
        ),
    },
    {
        "id": "ruhemodus",
        "file": "ablauf-ruhemodus.md",
        "title": "Ruhemodus einschalten",
        "area": "ablauf",
        "keywords": ["Ruhemodus", "Stumm", "Benachrichtigungen"],
        "text": (
            "Den Ruhemodus kannst du über die Statusleiste einstellen. "
            "Benachrichtigungen werden dann gesammelt."
        ),
    },
    {
        "id": "datenschutz",
        "file": "datenschutz.md",
        "title": "Datenschutz und Daten",
        "area": "datenschutz",
        "keywords": ["Datenschutz", "Daten", "löschen", "lokal"],
        "text": "Alle Daten bleiben lokal auf deinem Gerät. Du kannst sie im Dashboard löschen.",
    },
]


class KnowledgeBaseTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tempdir.name, "friday-knowledge.json")
        with open(self.path, "w", encoding="utf-8") as target:
            json.dump({"version": 1, "sections": SECTIONS}, target, ensure_ascii=False)
        self.knowledge = KnowledgeBase(self.path)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_normalize_tokens_handles_umlauts_stopwords_and_short_tokens(self):
        tokens = normalize_tokens("Wie ändere ich die Einstellungen für den Kalender?")
        self.assertIn("aendere", tokens)
        self.assertIn("einstellungen", tokens)
        self.assertIn("kalender", tokens)
        self.assertNotIn("wie", tokens)
        self.assertNotIn("ich", tokens)
        self.assertNotIn("die", tokens)
        self.assertNotIn("fuer", tokens)
        self.assertNotIn("den", tokens)
        self.assertEqual(normalize_tokens("Straße"), ["strasse"])
        self.assertEqual(normalize_tokens("Am 5. zu im"), [])

    def test_get_returns_a_section_by_id(self):
        section = KnowledgeBase().get("seiten#kalender")
        self.assertIsNotNone(section)
        self.assertEqual(section["id"], "seiten#kalender")
        self.assertTrue(section["text"])
        self.assertIsNone(KnowledgeBase().get("seiten#gibt-es-nicht"))

    def test_search_finds_the_calendar_section(self):
        results = self.knowledge.search("Wie verbinde ich meinen Kalender?")
        self.assertTrue(results)
        self.assertEqual(results[0]["titel"], "Kalender verbinden")
        self.assertIn("seite-kalender.md", results[0]["quelle"])
        self.assertIn("Kalender verbinden", results[0]["quelle"])

    def test_search_accepts_prefix_matches(self):
        results = self.knowledge.search("Einstellungen")
        self.assertTrue(results)
        self.assertEqual(results[0]["titel"], "Wake Word ändern")

    def test_search_ignores_unrelated_questions(self):
        self.assertEqual(self.knowledge.search("Erzähl einen Witz über Pinguine"), [])

    def test_search_respects_limit_and_drops_weak_matches(self):
        self.assertEqual(len(self.knowledge.search("Ruhemodus einstellen", limit=1)), 1)
        results = self.knowledge.search("Ruhemodus einstellen")
        self.assertEqual([item["titel"] for item in results], ["Ruhemodus einschalten"])

    def test_missing_and_broken_files_are_empty(self):
        missing = KnowledgeBase(os.path.join(self.tempdir.name, "missing.json"))
        self.assertEqual(missing.search("Kalender"), [])
        self.assertEqual(missing.overview(), "")

        broken_path = os.path.join(self.tempdir.name, "broken.json")
        with open(broken_path, "w", encoding="utf-8") as target:
            target.write("{ kaputt")
        broken = KnowledgeBase(broken_path)
        self.assertEqual(broken.search("Kalender"), [])
        self.assertEqual(broken.overview(), "")

    def test_overview_lists_only_dashboard_sections(self):
        self.assertEqual(self.knowledge.overview(), "Kalender verbinden")

if __name__ == "__main__":
    unittest.main()
