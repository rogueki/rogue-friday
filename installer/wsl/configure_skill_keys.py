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

ENV = Path.home() / ".hermes" / ".env"
KEYS = ("AIRTABLE_API_KEY", "NOTION_API_KEY", "TENOR_API_KEY", "JINA_API_KEY")
VALUE = re.compile(r'^[\x21-\x7e]{1,2048}$')


def lines_and_status():
    if ENV.is_symlink():
        raise OSError("invalid environment file")
    lines = ENV.read_text(encoding="utf-8").splitlines(keepends=True) if ENV.exists() else []
    return lines, {key: any(line.startswith(key + "=") and line[len(key) + 1:].strip().strip('"') for line in lines) for key in KEYS}


def answer(configured, applied=None):
    print(json.dumps({"configured": {key: bool(configured[key]) for key in KEYS}, "applied": applied}))


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("status", "update"):
        return 2
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
