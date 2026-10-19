#!/usr/bin/env python3
"""Check recovered Hermes bridge credentials without emitting an event or account request."""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
from pathlib import Path
import stat
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import yaml


BRIDGES = ("memory", "calendar", "mail", "messenger")


def ordinary_private(path: Path) -> bytes:
    if any(parent.is_symlink() for parent in path.parents):
        raise ValueError("bridge file has a linked ancestor")
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or mode & 0o077:
        raise ValueError("bridge file is missing, linked, or accessible to other users")
    return path.read_bytes()


def check(request: dict, home: Path) -> dict:
    port = request.get("port")
    memory_db = request.get("memoryDbPath")
    expected = request.get("keyDigests")
    if (not isinstance(port, int) or not 1024 <= port <= 65535 or not isinstance(memory_db, str) or
            not memory_db.startswith("/") or not isinstance(expected, dict) or set(expected) != set(BRIDGES)):
        raise ValueError("invalid recovery health request")
    hermes = home / ".hermes"
    if hermes.is_symlink() or not hermes.is_dir():
        raise ValueError("Hermes profile is unavailable")
    keys: dict[str, str] = {}
    for bridge in BRIDGES:
        file = hermes / f"friday-{bridge}-bridge.key"
        raw = ordinary_private(file)
        key = raw.decode("ascii").strip()
        decoded = base64.b64decode(key, validate=True)
        digest = expected[bridge]
        if len(decoded) != 32 or not isinstance(digest, str) or len(digest) != 64 or hashlib.sha256(decoded).hexdigest() != digest:
            raise ValueError(f"{bridge} bridge credential does not match the restored API")
        keys[bridge] = key
        config_file = hermes / f"friday-{bridge}-bridge.json"
        config = json.loads(ordinary_private(config_file))
        if not isinstance(config, dict) or config.get("port") != port:
            raise ValueError(f"{bridge} bridge targets a different API port")
        if bridge == "messenger" and config.get("hermesHome") != str(hermes.resolve()):
            raise ValueError("messenger bridge points to another Hermes profile")
        if bridge in ("memory", "messenger") and config.get("settingsDb") != memory_db:
            raise ValueError(f"{bridge} bridge points to another memory policy database")
        if bridge == "memory" and config.get("ownerCli") is not True:
            raise ValueError("Hermes memory bridge is not owner CLI scoped")
        if bridge == "messenger" and config.get("accountId") != "default":
            raise ValueError("messenger bridge account scope changed")
    hermes_config = yaml.safe_load(ordinary_private(hermes / "config.yaml"))
    enabled = hermes_config.get("plugins", {}).get("enabled", []) if isinstance(hermes_config, dict) else []
    if not isinstance(enabled, list) or not {"friday-memory", "friday-dashboard-calendar", "friday-dashboard-mail"}.issubset(set(enabled)):
        raise ValueError("Hermes bridge plugins are not enabled")
    plugin = hermes / "plugins/friday-memory/__init__.py"
    contents = ordinary_private(plugin).decode("utf-8")
    if "_pre" not in contents or "_messenger_admitted" not in contents:
        raise ValueError("Hermes memory and messenger admission hooks are unavailable")
    marker = ordinary_private(hermes / "friday-messenger-bridge-applied.sha256").decode("ascii").strip()
    applied = hashlib.sha256((hermes / "friday-messenger-bridge.key").read_bytes() +
                             (hermes / "friday-messenger-bridge.json").read_bytes()).hexdigest()
    if marker != applied:
        raise ValueError("messenger bridge has not been applied to the gateway")

    # This endpoint is scoped to the memory bridge and does not write or contact a provider.
    query = urlencode({"identityId": "owner", "query": "Friday recovery health", "limit": 1})
    url = f"http://127.0.0.1:{port}/api/v1/integrations/memory/search?{query}"
    with urlopen(Request(url, headers={"Authorization": f"Bearer {keys['memory']}"}), timeout=5) as response:
        if response.status != 200:
            raise ValueError("memory bridge read was rejected")
        payload = json.load(response)
    if (not isinstance(payload, dict) or payload.get("contractVersion") != "1.0.0" or
            not isinstance(payload.get("data"), dict) or not isinstance(payload["data"].get("items"), list)):
        raise ValueError("memory bridge read returned an invalid contract")
    return {"state": "ready", "keyMatches": list(BRIDGES), "readOnlyProbes": ["memory-search"]}


if __name__ == "__main__":
    try:
        print(json.dumps(check(json.load(sys.stdin), Path.home()), separators=(",", ":")))
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, binascii.Error, yaml.YAMLError) as exc:
        print(f"FRIDAY_RECOVERY_BRIDGE_HEALTH_ERROR {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1)
