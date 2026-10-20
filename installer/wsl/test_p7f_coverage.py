"""Keep the P7-F coverage denominator pinned to the audited Hermes source."""

import json
import unittest
from pathlib import Path

import hermes_config_bridge as bridge


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "agent-work" / "hermes-full-integration"
PREFIXES = ("cron.", "gateway.", "logging.", "monitoring.", "updates.", "hooks_auto_accept")


class P7FCoverageTest(unittest.TestCase):
    def test_every_pinned_leaf_has_an_explicit_decision(self):
        inventory = json.loads((DOCS / "hermes-feature-inventory.json").read_text(encoding="utf-8"))
        coverage = json.loads((DOCS / "p7f-config-coverage.json").read_text(encoding="utf-8"))
        self.assertEqual(coverage["revision"], inventory["hermes_revision"])
        source = {item["id"][len("hermes.config."):]: item["source"] for item in inventory["items"]
                  if item["kind"] == "config" and item["id"].startswith("hermes.config.")
                  and item["id"][len("hermes.config."):].startswith(PREFIXES)}
        rows = coverage["items"]
        self.assertEqual(len(rows), len(source))
        self.assertEqual(len(rows), len({row["key"] for row in rows}))
        self.assertEqual(set(source), {row["key"] for row in rows})
        typed = {key for key in bridge.FIELDS if key.startswith(PREFIXES)}
        self.assertEqual(typed, {row["key"] for row in rows if row["status"] == "typed_persisted"})
        for row in rows:
            self.assertEqual(row["source"], source[row["key"]])
            self.assertIn(row["status"], ("typed_persisted", "unavailable"))
            self.assertTrue(row["reason"])
            self.assertTrue(row["owner"])
            self.assertTrue(row["apply"])
            if row["status"] == "typed_persisted":
                self.assertTrue(row["consumer"], row["key"])


if __name__ == "__main__":
    unittest.main()
