#!/usr/bin/env python3
"""A configured skill root that is not there must be reported, not silently dropped."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hermes_config_bridge as bridge

root = Path(tempfile.mkdtemp(prefix="friday-roots-"))
home = root / "home"
skill = home / "skills" / "demo"
skill.mkdir(parents=True)
(skill / "SKILL.md").write_text("---\nname: demo\n---\n", encoding="utf-8")
missing = root / "unplugged" / "skills"

# 1. The inventory asks for the gap to be visible: the skill is still found, the reason names the missing root.
names, errors = bridge.installed_skills([home / "skills", missing], report_missing=True)
assert names == ["demo"], names
assert errors == ["skill_root_missing"], errors

# 2. The validation callers keep their old behaviour: an absent optional root is not an error.
names, errors = bridge.installed_skills([home / "skills", missing])
assert names == ["demo"] and errors == [], (names, errors)

# 3. A path that exists but is not a directory is a different, harder problem.
as_file = root / "not-a-dir"
as_file.write_text("x", encoding="utf-8")
names, errors = bridge.installed_skills([as_file], report_missing=True)
assert names == [] and errors == ["skill_root_unreadable"], (names, errors)

# 4. An unreadable directory is reported too, and the other roots still deliver their skills.
blocked = root / "blocked"
blocked.mkdir()
(blocked / "SKILL.md").write_text("---\nname: hidden\n---\n", encoding="utf-8")
os.chmod(blocked, 0o000)
try:
    names, errors = bridge.installed_skills([home / "skills", blocked], report_missing=True)
finally:
    os.chmod(blocked, 0o700)
assert names == ["demo"], names
assert errors == ["skill_root_unreadable"], errors

# 5. An unreadable skill manifest is named as well instead of being counted as a healthy skill.
broken = home / "skills" / "broken"
broken.mkdir()
(broken / "SKILL.md").write_text("---\nname: broken\n---\n", encoding="utf-8")
os.chmod(broken / "SKILL.md", 0o000)
try:
    names, errors = bridge.installed_skills([home / "skills"], report_missing=True)
finally:
    os.chmod(broken / "SKILL.md", 0o600)
assert names == ["demo"], names
assert errors == ["skill_manifest_unreadable"], errors

print("skill-roots: 12 checks passed")

# 6. The inventory table of Hermes v0.22.2 uses heavy borders around the header; both layouts parse to the same rows.
V22 = """                                   Installed Skills
\u250f\u2501\u2501\u2501\u2501\u2501\u2501\u2533\u2501\u2501\u2501\u2501\u2533
\u2503 Name    \u2503 Category \u2503 Source  \u2503 Trust   \u2503 Status  \u2503
\u2521\u2501\u2501\u2501\u2501\u2501\u2501\u2547\u2501\u2501\u2501\u2501\u2547
\u2502 demo    \u2502 local    \u2502 local   \u2502 local   \u2502 enabled \u2502
\u2514\u2501\u2501\u2501\u2501\u2501\u2501\u2534\u2501\u2501\u2501\u2501\u2534
"""
parsed = bridge.parse_skills_list(V22)
assert parsed["count"] == 1 and parsed["skills"][0]["name"] == "demo", parsed
assert parsed["skills"][0]["state"] == "enabled", parsed
print("skill-v22: 4 checks passed")

