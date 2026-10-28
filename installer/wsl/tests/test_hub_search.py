#!/usr/bin/env python3
"""Hub search and modified-skill list: only the documented JSON is trusted, everything else is rejected."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hermes_config_bridge as bridge

SEARCH = json.dumps([
    {"name": "hermes-s6-container-supervision",
     "identifier": "official/devops/hermes-s6-container-supervision",
     "source": "official", "trust_level": "builtin",
     "description": "Modify or debug s6 services in the Hermes Docker image."},
    {"name": "hermes-agent", "identifier": "skills-sh/nousresearch/hermes-agent/hermes-agent",
     "source": "skills.sh", "trust_level": "hub", "description": ""},
])

parsed = bridge.parse_hub_search(SEARCH, "hermes", None)
assert parsed["query"] == "hermes" and parsed["source"] is None, parsed
assert [entry["name"] for entry in parsed["results"]] == [
    "hermes-s6-container-supervision", "hermes-agent"], parsed
assert parsed["results"][0] == {
    "identifier": "official/devops/hermes-s6-container-supervision",
    "name": "hermes-s6-container-supervision",
    "source": "official",
    "trustLevel": "builtin",
    "description": "Modify or debug s6 services in the Hermes Docker image.",
}, parsed["results"][0]
# An empty result list is a valid answer and stays empty.
assert bridge.parse_hub_search("[]", "nothing", "official") == {
    "query": "nothing", "source": "official", "results": []}

# An extra key from a newer CLI must not invent a field or break the parse.
extended = json.loads(SEARCH)
extended[0]["popularity"] = 42
assert len(bridge.parse_hub_search(json.dumps(extended), "hermes", None)["results"]) == 2

BAD_SEARCH = [
    "not json",
    json.dumps({"results": []}),
    json.dumps([{"name": "ok", "identifier": "a/b", "source": "official", "trust_level": "builtin"}]),
    json.dumps([{"name": "", "identifier": "a/b", "source": "official", "trust_level": "builtin",
                 "description": ""}]),
    json.dumps([{"name": "ok", "identifier": "", "source": "official", "trust_level": "builtin",
                 "description": ""}]),
    json.dumps([{"name": "ok", "identifier": "a/b", "source": "official", "trust_level": "builtin",
                 "description": "x" * 2001}]),
    json.dumps([{"name": "ok", "identifier": "a/b", "source": "official", "trust_level": "builtin",
                 "description": ""}] * 51),
]
for index, text in enumerate(BAD_SEARCH):
    try:
        bridge.parse_hub_search(text, "hermes", None)
    except ValueError as error:
        assert str(error) == "hub_search_format", (index, error)
    else:
        raise AssertionError(f"accepted malformed search output #{index}")

assert bridge.parse_modified_skills("[]") == {"names": []}
assert bridge.parse_modified_skills('["google-workspace", "arxiv"]') == {
    "names": ["google-workspace", "arxiv"]}

BAD_MODIFIED = [
    "not json",
    json.dumps({"names": ["arxiv"]}),
    json.dumps(["google workspace"]),
    json.dumps(["arxiv", "arxiv"]),
    json.dumps([42]),
]
for index, text in enumerate(BAD_MODIFIED):
    try:
        bridge.parse_modified_skills(text)
    except ValueError as error:
        assert str(error) == "modified_skills_format", (index, error)
    else:
        raise AssertionError(f"accepted malformed modified list #{index}")

print("hub-search/modified-list: 9 Pruefungen bestanden")