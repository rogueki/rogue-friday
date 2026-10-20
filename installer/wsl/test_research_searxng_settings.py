import tempfile
import unittest
import sys
import os
from pathlib import Path
from stat import S_IMODE

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

    def test_concurrent_edit_aborts_repair_without_overwriting_it(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.yml"
            path.write_text("search:\n  formats: [html]\n", encoding="utf-8")
            def external_edit():
                path.write_text("search:\n  formats: [rss]\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "settings_changed_during_repair"):
                ensure(path, before_replace=external_edit)
            self.assertEqual(path.read_text(encoding="utf-8"), "search:\n  formats: [rss]\n")

    @unittest.skipIf(os.name == "nt", "POSIX file modes require Linux")
    def test_repair_preserves_private_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.yml"
            path.write_text("search:\n  formats: [html]\n", encoding="utf-8")
            path.chmod(0o600)
            self.assertTrue(ensure(path))
            self.assertEqual(S_IMODE(path.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
