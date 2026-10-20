import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import hermes_cron_read as reader


class CronReadTest(unittest.TestCase):
    def test_projection_excludes_prompt_and_delivery_data(self):
        row = reader.project({"id": "job-1", "name": "Morning", "schedule_display": "09:00",
                              "enabled": True, "state": "scheduled", "prompt": "PRIVATE-PROMPT",
                              "origin": {"chat_id": "PRIVATE-RECIPIENT"}, "deliver": "PRIVATE-ROUTE"})
        self.assertEqual(row["id"], "job-1")
        self.assertTrue(row["enabled"])
        self.assertNotIn("PRIVATE", str(row))

    def test_unknown_source_fails_before_native_import(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "unsupported_source_revision"):
                reader.read_jobs(Path(directory))

    @unittest.skipUnless(os.environ.get("FRIDAY_HERMES_SOURCE_FIXTURE"), "opt-in pinned source checkout")
    def test_pinned_native_store_lists_synthetic_job(self):
        source = Path(os.environ["FRIDAY_HERMES_SOURCE_FIXTURE"])
        with tempfile.TemporaryDirectory(prefix="friday-cron-read-") as directory, \
                patch.dict(os.environ, {"HERMES_HOME": directory, "HERMES_TIMEZONE": "Europe/Berlin"}):
            cron_dir = Path(directory) / "cron"
            cron_dir.mkdir()
            store = cron_dir / "jobs.json"
            store.write_text('{"jobs":[{"id":"job-1","name":"Fixture",'
                                                '"schedule_display":"09:00 UTC",'
                                                '"enabled":true,"state":"scheduled",'
                                                '"prompt":"PRIVATE-PROMPT",'
                                                '"origin":{"chat_id":"PRIVATE-RECIPIENT"}}]}', encoding="utf-8")
            before = store.read_bytes()
            result = reader.read_jobs(source)
            self.assertEqual(result["count"], 1)
            self.assertEqual(result["jobs"][0]["name"], "Fixture")
            self.assertEqual(result["profile"], "custom")
            self.assertEqual(result["profileTimezone"], "Europe/Berlin")
            self.assertNotIn("PRIVATE", str(result))
            self.assertIsNone(result["schedulerRunning"])
            self.assertEqual(store.read_bytes(), before)

    @unittest.skipUnless(os.environ.get("FRIDAY_HERMES_SOURCE_FIXTURE"), "opt-in pinned source checkout")
    def test_corrupt_native_store_fails_without_repair_or_write(self):
        source = Path(os.environ["FRIDAY_HERMES_SOURCE_FIXTURE"])
        with tempfile.TemporaryDirectory(prefix="friday-cron-corrupt-") as directory, \
                patch.dict(os.environ, {"HERMES_HOME": directory}):
            cron_dir = Path(directory) / "cron"
            cron_dir.mkdir()
            store = cron_dir / "jobs.json"
            store.write_bytes(b'[bad private content]')
            with self.assertRaises(ValueError):
                reader.read_jobs(source)
            self.assertEqual(store.read_bytes(), b'[bad private content]')


if __name__ == "__main__":
    unittest.main()
