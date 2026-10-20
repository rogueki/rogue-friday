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

    def test_container_values_cannot_be_projected_into_visible_metadata(self):
        with self.assertRaisesRegex(ValueError, "invalid_native_result"):
            reader.project({"id": "job-1", "name": {"prompt": "PRIVATE"}})

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

    @unittest.skipUnless(os.environ.get("FRIDAY_HERMES_SOURCE_FIXTURE"), "opt-in pinned source checkout")
    def test_growing_store_is_bounded_at_read_time(self):
        source = Path(os.environ["FRIDAY_HERMES_SOURCE_FIXTURE"])
        with tempfile.TemporaryDirectory(prefix="friday-cron-large-") as directory, \
                patch.dict(os.environ, {"HERMES_HOME": directory}):
            cron_dir = Path(directory) / "cron"
            cron_dir.mkdir()
            store = cron_dir / "jobs.json"
            store.write_bytes(b'{"jobs":[]}')
            original_open = Path.open

            def grow_before_open(path, *args, **kwargs):
                if path == store:
                    with original_open(path, "ab") as output:
                        output.write(b"x" * (reader.MAX_STORE_BYTES + 1))
                return original_open(path, *args, **kwargs)

            with patch.object(Path, "open", grow_before_open), \
                    self.assertRaisesRegex(ValueError, "invalid_native_result"):
                reader.read_jobs(source)
            self.assertGreater(store.stat().st_size, reader.MAX_STORE_BYTES)


if __name__ == "__main__":
    unittest.main()
