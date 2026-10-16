#!/usr/bin/env python3
"""Configure Hermes' local Markdown wiki path without changing Obsidian vault settings."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ENV = Path.home() / ".hermes" / ".env"
KEY = "WIKI_PATH"


def current(lines):
    return next((line[len(KEY) + 1:].strip().strip('"').strip("'")
                 for line in lines if line.startswith(KEY + "=")), "")


def status(value, applied=None):
    path = value or str(Path.home() / "wiki")
    directory = Path(path)
    return {"path": path, "revision": int(hashlib.sha256(value.encode()).hexdigest()[:12], 16),
            "configured": directory.is_dir() and os.access(directory, os.R_OK | os.X_OK),
            "customized": bool(value), "readable": directory.is_dir() and os.access(directory, os.R_OK | os.X_OK),
            "applied": applied}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("status", "update"):
        return 2
    ENV.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Shared lock with other Hermes helpers writing the same .env file.
    with (ENV.parent / ".obsidian-vault.lock").open("a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if ENV.is_symlink():
            raise OSError("invalid environment file")
        lines = ENV.read_text(encoding="utf-8").splitlines(keepends=True) if ENV.exists() else []
        old = current(lines)
        if sys.argv[1] == "status":
            print(json.dumps(status(old)))
            return 0
        request = json.load(sys.stdin)
        if not isinstance(request, dict) or set(request) != {"path", "revision"} or not isinstance(request["path"], str) or not isinstance(request["revision"], int):
            return 2
        value = request["path"].strip()
        if request["revision"] != status(old)["revision"]:
            print(json.dumps({"error": "conflict"}))
            return 3
        if (len(value) > 1024 or (value and not value.startswith("/")) or
                any(char in value for char in ('\r', '\n', '"', "'", '\\', '$', '`')) or
                (value and not status(value)["readable"])):
            print(json.dumps({"error": "invalid_path"}))
            return 4
        new_lines = [line for line in lines if not line.startswith(KEY + "=")]
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines[-1] += "\n"
        if value:
            new_lines.append(f'{KEY}="{value}"\n')
        fd, name = tempfile.mkstemp(prefix=".env.", dir=ENV.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                output.writelines(new_lines)
                output.flush()
                os.fsync(output.fileno())
            os.replace(name, ENV)
        finally:
            if os.path.exists(name):
                os.unlink(name)
        restarted = subprocess.run(["systemctl", "--user", "restart", "hermes-gateway.service"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20).returncode == 0
        print(json.dumps(status(value, restarted)))
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired):
        print(json.dumps({"error": "unavailable"}))
        raise SystemExit(5)
