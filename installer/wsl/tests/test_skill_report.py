#!/usr/bin/env python3
"""Inspect/audit/diff pass raw CLI text through unchanged: no table parsing, capped, never empty."""
import io
import json
import stat
import sys
import tempfile
from contextlib import redirect_stdout
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

# The limits come from a measured run: inspect and audit resolve names against the registries (37 s there),
# diff answers from the local stock copy.
assert bridge.SKILL_REPORT_TIMEOUTS == {"inspect": 150, "audit": 150, "diff": 60}, bridge.SKILL_REPORT_TIMEOUTS

print("skill-report: 10 checks passed")

# 8. A refusal by the CLI keeps its reason: the operator needs the text, not just "failed".
ROOT = Path(tempfile.mkdtemp(prefix="friday-report-reason-"))
HOME = ROOT / "home"
(HOME).mkdir()
(ROOT / "bin").mkdir()
FAILING = ROOT / "bin" / "fail"
FAILING.write_text("#!/bin/sh\necho \"Error: skill 'arxiv' is not tracked\" >&2\nexit 1\n", encoding="utf-8")
FAILING.chmod(FAILING.stat().st_mode | stat.S_IEXEC)
sys.argv = ["hermes_config_bridge.py", "skill-report"]
sys.stdin = io.TextIOWrapper(io.BytesIO(json.dumps({"action": "diff", "name": "arxiv"}).encode("utf-8")), encoding="utf-8")
buffer = io.StringIO()
with redirect_stdout(buffer):
    code = bridge.locked_main(HOME, HOME / "hermes-agent", FAILING)
payload = json.loads(buffer.getvalue().strip().splitlines()[-1])
assert code == 6 and payload["error"] == "skill_diff_failed", payload
assert "not tracked" in payload["detail"], payload

print("skill-report-reason: 3 checks passed")

# 9. inspect/audit accept a full identifier; a bare name may collide (N-053). Malformed references never pass.
for good in ("arxiv", "official/devops/hermes-s6-container-supervision", "skills-sh/owner/repo"):
    assert bridge.SKILL_REFERENCE.fullmatch(good), good
for bad in ("a/b/c/d", "/leading", "trailing/", "with space/name", "../etc", ""):
    assert bridge.SKILL_REFERENCE.fullmatch(bad) is None, bad
print("skill-report-reference: 9 checks passed")

