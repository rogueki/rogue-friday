#!/usr/bin/env python3
"""Configure only OBSIDIAN_VAULT_PATH in Hermes' private environment."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ENV = Path.home() / ".hermes" / ".env"
KEY = "OBSIDIAN_VAULT_PATH"


def current(lines):
    for line in lines:
        if line.startswith(KEY + "="):
            return line[len(KEY) + 1 :].strip().strip('"').strip("'")
    return ""


def revision(value):
    return int(hashlib.sha256(value.encode()).hexdigest()[:12], 16)


def result(path, applied=None):
    vault = Path(path) if path else None
    readable = bool(vault and vault.is_dir() and (vault / ".obsidian").is_dir() and os.access(vault, os.R_OK | os.W_OK))
    if readable:
        try:
            with tempfile.NamedTemporaryFile(prefix=".friday-probe-", dir=vault, delete=True) as probe:
                probe.write("Frïday".encode("utf-8"))
                probe.flush()
                os.fsync(probe.fileno())
                probe.seek(0)
                readable = probe.read() == "Frïday".encode("utf-8")
        except OSError:
            readable = False
    return {"path": path, "revision": revision(path), "configured": bool(path), "readable": readable,
            "applied": readable if applied is None else applied}


def configure():
    lines = ENV.read_text(encoding="utf-8").splitlines(keepends=True) if ENV.exists() else []
    old = current(lines)
    try:
        expected = int(sys.argv[2])
    except ValueError:
        return 2
    if expected != revision(old):
        print(json.dumps({"error": "conflict"}))
        return 3
    path = sys.argv[3]
    vault = Path(path)
    if not path.startswith("/mnt/") or "\n" in path or "\r" in path or '"' in path or "'" in path or not result(path)["readable"]:
        print(json.dumps({"error": "invalid_vault"}))
        return 4
    ENV.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    new_lines = [line for line in lines if not line.startswith(KEY + "=")]
    if new_lines and not new_lines[-1].endswith("\n"):
        new_lines[-1] += "\n"
    new_lines.append(f'{KEY}="{path}"\n')
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
    print(json.dumps(result(path, applied=restarted)))
    return 0


def main():
    if sys.argv[1] == "status":
        lines = ENV.read_text(encoding="utf-8").splitlines(keepends=True) if ENV.exists() else []
        print(json.dumps(result(current(lines), applied=False)))
        return 0
    if sys.argv[1] != "set" or len(sys.argv) != 4:
        return 2
    ENV.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (ENV.parent / ".obsidian-vault.lock").open("a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        return configure()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, subprocess.TimeoutExpired):
        print(json.dumps({"error": "unavailable"}))
        raise SystemExit(5)
