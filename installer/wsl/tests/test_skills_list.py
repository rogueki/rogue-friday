#!/usr/bin/env python3
"""Skills inventory: only the documented table layout is trusted, every other shape is rejected."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hermes_config_bridge as bridge

SAMPLE = """\
                               Installed Skills
┌────────────────────────┬──────────────────────┬─────────┬─────────┬──────────┐
│ Name                   │ Category             │ Source  │ Trust   │ Status   │
├────────────────────────┼──────────────────────┼─────────┼─────────┼──────────┤
│ bailian-cli            │                      │ local   │ local   │ enabled  │
│ claude-code            │ autonomous-ai-agents │ builtin │ builtin │ disabled │
│ friday-hub-skill       │ communication        │ hub     │ project │ enabled  │
│ friday-calendar        │ calendar             │ local   │ local   │ enabled  │
└────────────────────────┴──────────────────────┴─────────┴─────────┴──────────┘
"""

parsed = bridge.parse_skills_list(SAMPLE)
assert parsed["count"] == 4, parsed
assert [entry["name"] for entry in parsed["skills"]] == [
    "bailian-cli", "claude-code", "friday-hub-skill", "friday-calendar"], parsed
# An empty category cell stays empty: the parser must not invent a category.
assert parsed["skills"][0]["category"] == "", parsed["skills"][0]
assert parsed["skills"][1] == {"name": "claude-code", "category": "autonomous-ai-agents",
                               "origin": "builtin", "trust": "builtin", "state": "disabled"}
assert parsed["skills"][2]["origin"] == "hub" and parsed["skills"][2]["trust"] == "project"
# The source vocabulary is a bounded token, not a fixed list: v0.22.2 prints "external" for local skills (N-064).
EXTERNAL = SAMPLE.replace("hub     ", "external").replace("project ", "local   ")
assert bridge.parse_skills_list(EXTERNAL)["skills"][2]["origin"] == "external"

EMPTY = """\
   Installed Skills
┌────────┬──────────┬─────────┬─────────┬─────────┐
│ Name   │ Category │ Source  │ Trust   │ Status  │
└────────┴──────────┴─────────┴─────────┴─────────┘
"""
assert bridge.parse_skills_list(EMPTY) == {"count": 0, "skills": []}

BAD = [
    # unknown origin value
    SAMPLE.replace("hub     ", "sk ills "),
    # unknown status value
    SAMPLE.replace("│ enabled  │", "│ pending  │", 1),
    # duplicated name
    SAMPLE.replace("friday-hub-skill", "bailian-cli "),
    # one column missing
    SAMPLE.replace("│ Name                   │ Category             │ Source  │ Trust   │ Status   │",
                   "│ Name                   │ Category             │ Source  │ Status   │"),
    # no header row at all
    SAMPLE.replace("│ Name                   │ Category             │ Source  │ Trust   │ Status   │", ""),
    # a data row where the header belongs
    SAMPLE.replace("│ Name                   │ Category             │ Source  │ Trust   │ Status   │",
                   "│ bailian-cli            │                      │ local   │ local   │ enabled  │"),
]
for index, text in enumerate(BAD):
    try:
        bridge.parse_skills_list(text)
    except ValueError as error:
        assert str(error) == "skills_list_format", (index, error)
    else:
        raise AssertionError(f"accepted malformed table #{index}")

print("skills-list: 9 Pruefungen bestanden")