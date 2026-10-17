#!/usr/bin/env python3
"""Configure Hermes' loopback API without changing its model/provider account."""

import argparse
import os
from pathlib import Path
import pwd
import re
import secrets
import stat
import tempfile


API_NAMES = {"API_SERVER_ENABLED", "API_SERVER_HOST", "API_SERVER_PORT", "API_SERVER_KEY", "API_SERVER_MODEL_NAME"}
KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{24,256}$")


def read_regular(path: Path, *, private: bool = False) -> str | None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or (private and info.st_mode & 0o077):
        raise ValueError(f"Unsafe file or permissions: {path}")
    return path.read_text(encoding="utf-8")


def write_private(path: Path, content: str, uid: int, gid: int) -> None:
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        if os.geteuid() == 0:
            os.fchown(descriptor, uid, gid)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def configure(env_path: Path, key_path: Path, port: int, user: str = "friday") -> None:
    if not 1024 <= port <= 65535:
        raise ValueError("Hermes API port must be 1024..65535")
    account = pwd.getpwnam(user)
    if not env_path.parent.is_dir() or not key_path.parent.is_dir():
        raise ValueError("Hermes home and private secret directory must exist")
    if env_path.parent.is_symlink() or key_path.parent.is_symlink():
        raise ValueError("Hermes home and secret directory must not be symlinks")
    previous = read_regular(env_path) or ""
    stored = read_regular(key_path, private=True)
    old_env_key = next((line.partition("=")[2] for line in previous.splitlines()
                        if line.startswith("API_SERVER_KEY=")), None)
    key = stored.strip() if stored is not None else old_env_key or secrets.token_urlsafe(48)
    if not KEY_PATTERN.fullmatch(key):
        raise ValueError("Existing Hermes API key has an unsupported format")
    kept = [line for line in previous.splitlines()
            if line.partition("=")[0] not in API_NAMES]
    values = ["API_SERVER_ENABLED=true", "API_SERVER_HOST=127.0.0.1",
              f"API_SERVER_PORT={port}", f"API_SERVER_KEY={key}",
              "API_SERVER_MODEL_NAME=friday"]
    # Both files are private; the service identity can read them without root.
    write_private(key_path, key + "\n", account.pw_uid, account.pw_gid)
    write_private(env_path, "\n".join(kept + values) + "\n", account.pw_uid, account.pw_gid)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=Path("/var/lib/friday/.hermes/.env"))
    parser.add_argument("--key-file", type=Path, default=Path("/etc/friday/secrets/hermes-api.key"))
    parser.add_argument("--port", type=int, default=43693)
    parser.add_argument("--user", default="friday")
    args = parser.parse_args()
    try:
        configure(args.env, args.key_file, args.port, args.user)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Hermes API configuration failed: {error}\n")
    print("HERMES_API_CONFIGURED (loopback; provider account unchanged)")
