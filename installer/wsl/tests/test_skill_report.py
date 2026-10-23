#!/usr/bin/env python3
"""Inspect/audit/diff pass raw CLI text through unchanged: no table parsing, capped, never empty."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hermes_config_bridge as bridge

INSPECT = """Skills
  arxiv
    category: research
    source: builtin
    status: enabled
"""

report = bridge.parse_skill_report(INSPECT, "inspect", "arxiv")
assert report["action"] == "inspect" and report["name"] == "arxiv", report
assert report["text"] == INSPECT.strip("\n"), report["text"]
assert report["bytes"] == len(INSPECT.encode("utf-8")), report
assert report["truncated"] is False, report

# Diff keeps its unified-diff layout character for character; only the trailing newline is dropped.
DIFF = """--- a/arxiv/SKILL.md
+++ b/arxiv/SKILL.md
@@ -1,2 +1,2 @@
-old line
+new line
"""
diff = bridge.parse_skill_report(DIFF, "diff", "arxiv")
assert diff["text"].splitlines()[0] == "--- a/arxiv/SKILL.md", diff
assert "\\ No newline" not in diff["text"] and "+new line" in diff["text"], diff

# Very large reports are capped and flagged instead of flooding the API.
huge = bridge.parse_skill_report("x" * (bridge.SKILL_REPORT_LIMIT + 100), "audit", "arxiv")
assert huge["truncated"] is True, huge
assert len(huge["text"]) == bridge.SKILL_REPORT_LIMIT, len(huge["text"])
assert huge["bytes"] == bridge.SKILL_REPORT_LIMIT + 100, huge["bytes"]

BAD_REPORTS = ["", "   \n\t\n"]
for bad in BAD_REPORTS:
    try:
        bridge.parse_skill_report(bad, "inspect", "arxiv")
    except ValueError as error:
        assert str(error) == "skill_report_empty", error
    else:
        raise AssertionError("empty report accepted: %r" % bad)

for bad in (None, 17, b"bytes"):
    try:
        bridge.parse_skill_report(bad, "inspect", "arxiv")
    except ValueError as error:
        assert str(error) == "skill_report_format", error
    else:
        raise AssertionError("non-text report accepted: %r" % (bad,))

print("skill-report: 9 checks passed")