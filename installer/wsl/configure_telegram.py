#!/usr/bin/env python3
"""Owner Telegram gateway settings. The bot token is accepted only on stdin."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

HERMES = Path.home() / ".hermes"
HERMES_CLI = Path.home() / ".local" / "bin" / "hermes"
ENV = HERMES / ".env"
LOCK = HERMES / ".obsidian-vault.lock"
TOKEN = re.compile(r"^[0-9]{5,20}:[A-Za-z0-9_-]{30,100}$")
USER = re.compile(r"^[1-9][0-9]{0,19}$")
KEYS = ("TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS")


def command(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)


def read_lines():
    if ENV.is_symlink() or (ENV.exists() and not ENV.is_file()):
        raise OSError("unsafe environment file")
    return ENV.read_text(encoding="utf-8").splitlines(keepends=True) if ENV.exists() else []


def values(lines):
    result = {}
    for key in KEYS:
        raw = next((line[len(key) + 1:].strip() for line in lines if line.startswith(key + "=")), "")
        result[key] = raw.strip('"')
    return result


def enabled():
    result = command(str(HERMES_CLI), "config", "get", "platforms.telegram.enabled")
    if result.returncode != 0:
        return None
    value = result.stdout.strip().lower()
    if value in ("true", "false"):
        return value == "true"
    return None


def gateway_running():
    result = command("systemctl", "--user", "is-active", "hermes-gateway.service")
    return result.returncode == 0 and result.stdout.strip() == "active"


def snapshot(lines=None, applied=None):
    current = values(read_lines() if lines is None else lines)
    ids = [part.strip() for part in current["TELEGRAM_ALLOWED_USERS"].split(",") if part.strip()]
    flag = enabled()
    revision_source = json.dumps([current["TELEGRAM_BOT_TOKEN"], ids, flag], separators=(",", ":"))
    return {"tokenConfigured": bool(current["TELEGRAM_BOT_TOKEN"]), "allowedUserIds": ids,
            "enabled": flag, "gatewayRunning": gateway_running(), "connectionState": "unknown",
            "applied": applied, "revision": int(hashlib.sha256(revision_source.encode()).hexdigest()[:12], 16)}


def write_env(lines, token, ids):
    other = [line for line in lines if not any(line.startswith(key + "=") for key in KEYS)]
    if other and not other[-1].endswith("\n"):
        other[-1] += "\n"
    if token:
        other.append(f'TELEGRAM_BOT_TOKEN="{token}"\n')
    if ids:
        other.append(f'TELEGRAM_ALLOWED_USERS="{",".join(ids)}"\n')
    fd, path = tempfile.mkstemp(prefix=".env.telegram.", dir=HERMES)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.writelines(other)
            output.flush()
            os.fsync(output.fileno())
        os.replace(path, ENV)
    finally:
        if os.path.exists(path):
            os.unlink(path)


def update(lines):
    data = json.load(sys.stdin)
    if not isinstance(data, dict) or set(data) != {"token", "clearToken", "allowedUserIds", "enabled", "revision"}:
        return 2
    token, clear, ids, flag, expected = (data[key] for key in ("token", "clearToken", "allowedUserIds", "enabled", "revision"))
    if not isinstance(token, str) or not isinstance(clear, bool) or not isinstance(flag, bool) or not isinstance(ids, list) or not isinstance(expected, int):
        return 2
    if token and (clear or not TOKEN.fullmatch(token)):
        return 2
    if len(ids) > 10 or any(not isinstance(item, str) or not USER.fullmatch(item) for item in ids) or len(set(ids)) != len(ids):
        return 2
    before = snapshot(lines)
    if expected != before["revision"]:
        print(json.dumps({"error": "conflict"}))
        return 3
    current = values(lines)
    new_token = "" if clear else token or current["TELEGRAM_BOT_TOKEN"]
    if flag and (not new_token or not ids):
        print(json.dumps({"error": "token_and_owner_required"}))
        return 4
    changed_env = new_token != current["TELEGRAM_BOT_TOKEN"] or ",".join(ids) != current["TELEGRAM_ALLOWED_USERS"]
    changed_flag = flag != before["enabled"]
    if changed_env:
        write_env(lines, new_token, ids)
    if changed_flag:
        configured = command(str(HERMES_CLI), "config", "set", "platforms.telegram.enabled", "true" if flag else "false")
        if configured.returncode != 0:
            print(json.dumps({"error": "config_unavailable"}))
            return 5
    applied = None
    if changed_env or changed_flag:
        applied = command("systemctl", "--user", "restart", "hermes-gateway.service").returncode == 0
    print(json.dumps(snapshot(applied=applied)))
    return 0


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("status", "update"):
        return 2
    HERMES.mkdir(mode=0o700, parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        lines = read_lines()
        if sys.argv[1] == "status":
            print(json.dumps(snapshot(lines)))
            return 0
        return update(lines)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired):
        print(json.dumps({"error": "unavailable"}))
        raise SystemExit(5)
