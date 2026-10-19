#!/usr/bin/env python3
"""Narrow stdin-only adapter to pinned Hermes plugin admission and activation."""

import json
import re
import sys


def main():
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or set(request) != {"pluginId", "enabled"} or not (
        isinstance(request["pluginId"], str) and
        re.fullmatch(r"[A-Za-z0-9._/-]{1,100}", request["pluginId"]) and
        all(part and part not in (".", "..") for part in request["pluginId"].split("/")) and
        type(request["enabled"]) is bool
    ):
        raise ValueError("invalid_request")
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled
    result = dashboard_set_agent_plugin_enabled(request["pluginId"], enabled=request["enabled"])
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise ValueError("plugin_activation_unconfirmed")
    # Admission and gateway activation are Hermes-owned. The parent bridge still
    # verifies the saved selection by listing the installed plugin again.
    print(json.dumps({"ok": True, "name": result.get("name") if isinstance(result.get("name"), str) else None,
                      "restartRequired": result.get("restart_required") is True}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, ImportError, OSError):
        print(json.dumps({"ok": False}))
        raise SystemExit(5)
