#!/usr/bin/env python3
"""Manage a small allowlist of Hermes skill credentials via stdin only."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

ENV = Path.home() / ".hermes" / ".env"
KEYS = ("AIRTABLE_API_KEY", "NOTION_API_KEY", "TENOR_API_KEY", "JINA_API_KEY",
        "MSGRAPH_TENANT_ID", "MSGRAPH_CLIENT_ID", "MSGRAPH_CLIENT_SECRET")
VALUE = re.compile(r'^[\x21-\x7e]{1,2048}$')
CHECKS = {
    "AIRTABLE_API_KEY": ("https://api.airtable.com/v0/meta/whoami", {}),
    "NOTION_API_KEY": ("https://api.notion.com/v1/users/me", {"Notion-Version": "2026-03-11"}),
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def check_connection(key, transport=None):
    if key not in CHECKS:
        raise ValueError("unsupported provider")
    lines, configured = lines_and_status()
    if not configured[key]:
        return "missing"
    value = next((line[len(key) + 1:].strip().strip('"') for line in lines if line.startswith(key + "=")), "")
    if not value:
        return "missing"
    url, extra = CHECKS[key]
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + value, **extra}, method="GET")
    opener = transport or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=6) as response:
            code = response.status
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
    except (urllib.error.URLError, TimeoutError, OSError):
        return "unavailable"
    if code == 200:
        return "verified"
    if code == 401:
        return "rejected"
    if code == 403:
        return "permission-limited"
    return "unavailable"


def lines_and_status():
    if ENV.is_symlink():
        raise OSError("invalid environment file")
    lines = ENV.read_text(encoding="utf-8").splitlines(keepends=True) if ENV.exists() else []
    return lines, {key: any(line.startswith(key + "=") and line[len(key) + 1:].strip().strip('"') for line in lines) for key in KEYS}


def answer(configured, applied=None):
    print(json.dumps({"configured": {key: bool(configured[key]) for key in KEYS}, "applied": applied}))


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("status", "update", "check"):
        return 2
    if sys.argv[1] == "check":
        request = json.load(sys.stdin)
        if not isinstance(request, dict) or set(request) != {"key"} or request["key"] not in CHECKS:
            return 2
        from datetime import datetime, timezone
        state = check_connection(request["key"])
        print(json.dumps({"key": request["key"], "state": state,
                          "checkedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}))
        return 0
    ENV.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Share Obsidian's lock because both helpers rewrite the same Hermes .env.
    with (ENV.parent / ".obsidian-vault.lock").open("a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        lines, configured = lines_and_status()
        if sys.argv[1] == "status":
            answer(configured)
            return 0
        request = json.load(sys.stdin)
        if not isinstance(request, dict) or set(request) != {"key", "value"}:
            return 2
        key, value = request["key"], request["value"]
        if key not in KEYS or not isinstance(value, str) or (value and (not VALUE.fullmatch(value) or any(char in value for char in ('"', "'", "\\", "$", "`")))):
            return 2
        new_lines = [line for line in lines if not line.startswith(key + "=")]
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines[-1] += "\n"
        if value:
            new_lines.append(f'{key}="{value}"\n')
        fd, name = tempfile.mkstemp(prefix=".env.", dir=ENV.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                out.writelines(new_lines)
                out.flush()
                os.fsync(out.fileno())
            os.replace(name, ENV)
        finally:
            if os.path.exists(name):
                os.unlink(name)
        restarted = subprocess.run(["systemctl", "--user", "restart", "hermes-gateway.service"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20).returncode == 0
        answer({**configured, key: bool(value)}, restarted)
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired):
        print(json.dumps({"error": "unavailable"}))
        raise SystemExit(5)
