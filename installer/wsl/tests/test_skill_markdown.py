#!/usr/bin/env python3
"""SKILL.md reader: bounded, path-contained, text only."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hermes_config_bridge as bridge

with tempfile.TemporaryDirectory() as tmp:
    home = Path(tmp) / "home"
    source = Path(tmp) / "agent"
    (home / "skills" / "produktivitaet" / "demo").mkdir(parents=True)
    (home / "skills" / "produktivitaet" / "demo" / "SKILL.md").write_text(
        "# Demo\n\nNutze **Markdown**.\n\n<script>alert(1)</script>\n", encoding="utf-8")
    result = bridge.read_skill_markdown(home, source, "demo")
    assert result["id"] == "demo" and result["bytes"] > 0, result
    assert result["content"].startswith("# Demo"), result["content"][:20]
    # The bridge returns raw text; escaping is the renderer's job, so markup must arrive unchanged.
    assert "<script>alert(1)</script>" in result["content"]

    for bad in ("../etc", "Demo", "ä", "", "a" * 65):
        try:
            bridge.read_skill_markdown(home, source, bad)
        except ValueError as error:
            assert str(error) == "invalid_skill_id", (bad, error)
        else:
            raise AssertionError(f"accepted invalid id: {bad!r}")

    try:
        bridge.read_skill_markdown(home, source, "fehlt")
    except ValueError as error:
        assert str(error) == "skill_md_missing", error
    else:
        raise AssertionError("missing skill accepted")

    (home / "skills" / "produktivitaet" / "gross").mkdir()
    (home / "skills" / "produktivitaet" / "gross" / "SKILL.md").write_text("x" * 70000, encoding="utf-8")
    try:
        bridge.read_skill_markdown(home, source, "gross")
    except ValueError as error:
        assert str(error) == "skill_md_too_large", error
    else:
        raise AssertionError("oversized skill accepted")

print("skill-md: 6 Pruefungen bestanden")
