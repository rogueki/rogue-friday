import tempfile
import unittest
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from research_searxng_settings import ensure


class ResearchSearxngSettingsTest(unittest.TestCase):
    def test_new_settings_have_random_secret_and_json_search(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.yml"
            self.assertTrue(ensure(path))
            settings = yaml.safe_load(path.read_text(encoding="utf-8"))
            self.assertEqual(settings["search"]["formats"], ["html", "json"])
            self.assertEqual(len(settings["server"]["secret_key"]), 64)
            self.assertFalse(ensure(path))
            self.assertEqual(list(path.parent.glob("settings.yml.bak-*")), [])

    def test_repair_retains_other_values_and_backs_up_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.yml"
            original = "use_default_settings: true\nsearch:\n  formats: [html, rss]\n  safe_search: 2\nserver:\n  limiter: true\n"
            path.write_text(original, encoding="utf-8")
            self.assertTrue(ensure(path))
            settings = yaml.safe_load(path.read_text(encoding="utf-8"))
            self.assertEqual(settings["search"], {"formats": ["html", "rss", "json"], "safe_search": 2})
            self.assertEqual(settings["server"], {"limiter": True})
            backups = list(path.parent.glob("settings.yml.bak-*"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(encoding="utf-8"), original)

    def test_invalid_config_does_not_overwrite_or_create_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.yml"
            path.write_text('search:\n  formats: [html, !!python/object/apply:os.system ["false"]]\n', encoding="utf-8")
            with self.assertRaises(yaml.YAMLError):
                ensure(path)
            self.assertEqual(list(path.parent.glob("settings.yml.bak-*")), [])


if __name__ == "__main__":
    unittest.main()
