#!/usr/bin/env python3
"""Write one managed MCP Bearer credential through Hermes' native config API."""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hermes_cli.config import get_env_value, remove_env_value
from hermes_cli.mcp_config import (
    _bearer_auth_headers, _env_key_for_server, _get_mcp_servers,
    _save_bearer_auth_token, _save_mcp_server,
)
from hermes_cli.mcp_security import validate_mcp_server_entry


def main():
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or set(request) != {"name", "token", "expectedUrl", "expectedRevision", "configPath"}:
        raise ValueError("invalid_request")
    name, token = request["name"], request["token"]
    if (not isinstance(name, str) or re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name) is None or
            not (token is None or isinstance(token, str) and 1 <= len(token) <= 4096 and
                 all(33 <= ord(char) <= 126 for char in token))):
        raise ValueError("invalid_request")
    from hermes_config_bridge import revision
    from hermes_mcp_http_apply import valid_url
    config_path = Path(request["configPath"])
    if type(request["expectedRevision"]) is not int or revision(config_path) != request["expectedRevision"]:
        raise ValueError("revision_conflict")
    servers = _get_mcp_servers()
    existing = servers.get(name)
    template = _bearer_auth_headers(name)
    if (not isinstance(existing, dict) or not valid_url(existing.get("url")) or
            existing["url"] != request["expectedUrl"] or
            set(existing) - {"url", "enabled", "headers"} or
            existing.get("headers", template) != template):
        raise ValueError("managed_entry_conflict")
    if any(other != name and _env_key_for_server(other) == _env_key_for_server(name) for other in servers):
        raise ValueError("credential_name_conflict")
    if "headers" not in existing and get_env_value(_env_key_for_server(name)):
        raise ValueError("credential_name_conflict")
    if token is None and "headers" not in existing:
        raise ValueError("credential_not_managed")
    entry = {"url": existing["url"], "enabled": existing.get("enabled", True)}
    if token is not None:
        entry["headers"] = template
    if validate_mcp_server_entry(name, entry):
        raise ValueError("config_rejected")
    env_key = _env_key_for_server(name)
    if token is None:
        # Removing the secret first leaves a harmless unresolved template if
        # the following config write fails. The operation is safe to retry.
        if revision(config_path) != request["expectedRevision"] or _get_mcp_servers().get(name) != existing:
            raise ValueError("revision_conflict")
        remove_env_value(env_key)
        if get_env_value(env_key):
            raise ValueError("credential_remove_unconfirmed")
        if _get_mcp_servers().get(name) != existing or not _save_mcp_server(name, entry):
            raise ValueError("config_rejected")
    else:
        # Persist the template before the token. A failed secret write cannot
        # leave a newly available token attached to an unrelated endpoint.
        if revision(config_path) != request["expectedRevision"] or _get_mcp_servers().get(name) != existing:
            raise ValueError("revision_conflict")
        if not _save_mcp_server(name, entry):
            raise ValueError("config_rejected")
        # Native Hermes writes the profile .env, never the config. If a foreign
        # config writer changed this entry, do not publish a credential to it.
        if _get_mcp_servers().get(name) != entry:
            raise ValueError("concurrent_config_change")
        try:
            if _save_bearer_auth_token(name, token) != template:
                raise ValueError("config_rejected")
        finally:
            if _get_mcp_servers().get(name) != entry:
                from hermes_cli.mcp_config import _strip_bearer_prefix
                if get_env_value(env_key) == _strip_bearer_prefix(token):
                    remove_env_value(env_key)
        if _get_mcp_servers().get(name) != entry:
            raise ValueError("concurrent_config_change")
    saved = _get_mcp_servers().get(name) == entry and bool(get_env_value(env_key)) == (token is not None)
    print(json.dumps({"saved": saved}))


if __name__ == "__main__":
    main()
