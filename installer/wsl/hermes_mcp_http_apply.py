#!/usr/bin/env python3
"""Apply one constrained HTTP MCP entry through pinned Hermes config functions."""

import json
import ipaddress
import re
import sys
from urllib.parse import urlsplit


def valid_url(value):
    if not isinstance(value, str) or len(value) > 2048 or any(ord(ch) < 33 or ord(ch) == 127 for ch in value):
        return False
    try:
        parsed = urlsplit(value)
        try:
            ipaddress.ip_address(parsed.hostname or "")
            return False
        except ValueError:
            pass
        return (parsed.scheme == "https" and bool(parsed.hostname) and
                parsed.username is None and parsed.password is None and
                parsed.query == "" and parsed.fragment == "" and
                parsed.port in (None, 443) and
                re.fullmatch(r"[A-Za-z0-9.-]+", parsed.hostname or "") is not None and
                "." in (parsed.hostname or "") and
                not (parsed.hostname or "").endswith(".local"))
    except ValueError:
        return False


def main():
    request = json.load(sys.stdin)
    if (not isinstance(request, dict) or set(request) != {"name", "url", "enabled"} or
            not isinstance(request["name"], str) or
            re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", request["name"]) is None or
            type(request["enabled"]) is not bool or
            not (request["url"] is None and request["enabled"] is False or valid_url(request["url"]))):
        raise ValueError("invalid_request")
    from hermes_cli.mcp_config import _get_mcp_servers, _save_mcp_server, _remove_mcp_server
    from hermes_cli.mcp_security import validate_mcp_server_entry

    name, url = request["name"], request["url"]
    existing = _get_mcp_servers().get(name)
    # Preserve non-Friday auth, tool filters and local process definitions exactly.
    if existing is not None and (not isinstance(existing, dict) or
                                 set(existing) - {"url", "enabled"} or
                                 not valid_url(existing.get("url")) or
                                 url is not None and existing["url"] != url):
        raise ValueError("managed_entry_conflict")
    if url is None:
        if existing is None or not _remove_mcp_server(name):
            raise ValueError("unknown_server")
        saved = name not in _get_mcp_servers()
    else:
        entry = {"url": url, "enabled": request["enabled"]}
        if validate_mcp_server_entry(name, entry) or not _save_mcp_server(name, entry):
            raise ValueError("config_rejected")
        saved = _get_mcp_servers().get(name) == entry
    print(json.dumps({"saved": saved}))


if __name__ == "__main__":
    main()
