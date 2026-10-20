#!/usr/bin/env python3
"""Resolve one managed Hermes MCP Bearer token without exposing it to Friday."""

import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hermes_cli.config import get_env_value
from hermes_cli.mcp_config import _bearer_auth_headers, _env_key_for_server, _get_mcp_servers
from hermes_config_bridge import revision
from hermes_mcp_protocol_probe import ProbeFailure, probe


def main():
    request = json.load(sys.stdin)
    if (not isinstance(request, dict) or set(request) !=
            {"name", "url", "revision", "configPath"} or
            not isinstance(request["name"], str) or
            re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", request["name"]) is None or
            type(request["revision"]) is not int):
        raise ValueError("invalid_request")
    config_path = Path(request["configPath"])
    if revision(config_path) != request["revision"]:
        raise ValueError("revision_conflict")
    entry = _get_mcp_servers().get(request["name"])
    if (not isinstance(entry, dict) or set(entry) - {"url", "enabled", "headers"} or
            entry.get("url") != request["url"] or entry.get("enabled", True) is not True or
            entry.get("headers") != _bearer_auth_headers(request["name"])):
        raise ValueError("managed_entry_conflict")
    token = get_env_value(_env_key_for_server(request["name"]))
    if not token:
        result = {"connected": False, "toolCount": None, "toolCountComplete": False,
                  "failureClass": "auth_required"}
    else:
        try:
            result = probe(request["url"], token)
        except ProbeFailure as exc:
            result = {"connected": False, "toolCount": None, "toolCountComplete": False,
                      "failureClass": exc.failure_class}
    if revision(config_path) != request["revision"]:
        raise ValueError("revision_conflict")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
