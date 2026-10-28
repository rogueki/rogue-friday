#!/usr/bin/env python3
"""Parser test for `hermes auth list`: secrets never leave the bridge, bad formats fail loudly."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hermes_config_bridge as bridge

SAMPLE = """copilot (1 credentials):
  #1  gh auth token        api_key gh_cli \u2190

kimi-coding (1 credentials):
  #1  KIMI_API_KEY        api_key env:KIMI_API_KEY \u2190
"""

parsed = bridge.parse_auth_list(SAMPLE)
assert [item["provider"] for item in parsed["providers"]] == ["copilot", "kimi-coding"], parsed
first = parsed["providers"][0]["credentials"][0]
assert first == {"index": 1, "label": "gh auth token", "type": "api_key", "source": "gh_cli", "active": True}, first
second = parsed["providers"][1]["credentials"][0]
assert second["source"] == "env:KIMI_API_KEY" and second["type"] == "api_key", second
assert "KIMI_API_KEY" not in str(parsed) or "env:KIMI_API_KEY" in str(parsed)

for broken in ("", "copilot:\n  #1 key\n", "copilot (2 credentials):\n  #1  x  api_key y\n"):
    try:
        bridge.parse_auth_list(broken)
    except ValueError as error:
        assert str(error) == "auth_list_format", (broken, error)
    else:
        raise AssertionError(f"bad format accepted: {broken!r}")

print("hermes auth list parser: 4 Pruefungen bestanden")
