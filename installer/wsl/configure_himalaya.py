#!/usr/bin/env python3
"""Manage one Friday-owned Himalaya account without exposing mailbox passwords."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

CONFIG = Path.home() / ".config" / "himalaya" / "config.toml"
SECRETS = Path.home() / ".config" / "friday" / "mail"
HEADER = "# Managed by Friday: account friday\n"
HOST = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$")
EMAIL = re.compile(r"^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+$")


def safe_file(path):
    if path.is_symlink():
        raise ValueError("symlink")
    return path.read_text(encoding="utf-8") if path.exists() else ""


def atomic(path, value):
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.is_symlink():
        raise ValueError("symlink")
    fd, name = tempfile.mkstemp(prefix=".friday-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(value)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def valid(request):
    fields = {"email", "displayName", "imapHost", "imapPort", "imapLogin", "imapPassword",
              "smtpHost", "smtpPort", "smtpLogin", "smtpPassword", "smtpEncryption",
              "sentFolder", "draftsFolder", "trashFolder", "revision"}
    if not isinstance(request, dict) or set(request) != fields or not isinstance(request["revision"], int) or isinstance(request["revision"], bool) or request["revision"] < 0:
        return False
    for key in fields - {"revision", "imapPort", "smtpPort"}:
        if not isinstance(request[key], str) or len(request[key]) > 1024 or any(ord(c) < 32 for c in request[key]):
            return False
    return (bool(EMAIL.fullmatch(request["email"])) and
            all(HOST.fullmatch(request[key]) for key in ("imapHost", "smtpHost")) and
            all(isinstance(request[key], int) and not isinstance(request[key], bool) and 1 <= request[key] <= 65535
                for key in ("imapPort", "smtpPort")) and
            request["smtpEncryption"] in ("tls", "start-tls") and
            all(request[key].strip() for key in ("displayName", "imapLogin", "smtpLogin", "imapPassword", "smtpPassword", "sentFolder", "draftsFolder", "trashFolder")))


def read_status():
    content = safe_file(CONFIG)
    managed = content.startswith(HEADER)
    revision = int(hashlib.sha256(content.encode()).hexdigest()[:12], 16)
    cli = shutil.which("himalaya")
    try:
        installed = bool(cli and not cli.startswith("/mnt/") and
                         subprocess.run([cli, "--version"], stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, timeout=3, check=False).returncode == 0)
    except (OSError, subprocess.TimeoutExpired):
        installed = False
    credentials = all((SECRETS / name).is_file() and not (SECRETS / name).is_symlink() and
                      ((SECRETS / name).stat().st_mode & 0o777) == 0o600
                      for name in ("imap-secret", "smtp-secret"))
    return {"managed": managed, "configPresent": bool(content), "credentialsPresent": managed and credentials,
            "cliInstalled": installed, "readyForLocalUse": managed and credentials and installed,
            "connectionChecked": False, "revision": revision}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("status", "update"):
        return 2
    if CONFIG.parent.is_symlink() or SECRETS.is_symlink() or SECRETS.parent.is_symlink():
        raise ValueError("symlink directory")
    CONFIG.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    SECRETS.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (SECRETS / ".lock").open("a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = safe_file(CONFIG)
        state = read_status()
        if sys.argv[1] == "status":
            print(json.dumps(state))
            return 0
        request = json.load(sys.stdin)
        if not valid(request):
            print(json.dumps({"error": "invalid_profile"}))
            return 4
        if request["revision"] != state["revision"]:
            print(json.dumps({"error": "conflict"}))
            return 3
        if old and not old.startswith(HEADER):
            print(json.dumps({"error": "existing_config"}))
            return 6
        # A single owned account avoids rewriting someone else's Himalaya configuration.
        imap_secret = SECRETS / "imap-secret"
        smtp_secret = SECRETS / "smtp-secret"
        atomic(imap_secret, request["imapPassword"] + "\n")
        atomic(smtp_secret, request["smtpPassword"] + "\n")
        quote = lambda value: json.dumps(value, ensure_ascii=False)
        lines = [HEADER, "[accounts.friday]\n", f'email = {quote(request["email"])}\n',
                 f'display-name = {quote(request["displayName"])}\n', "default = true\n",
                 'backend.type = "imap"\n', f'backend.host = {quote(request["imapHost"])}\n',
                 f'backend.port = {request["imapPort"]}\n', 'backend.encryption.type = "tls"\n',
                 f'backend.login = {quote(request["imapLogin"])}\n', 'backend.auth.type = "password"\n',
                 f'backend.auth.cmd = {quote("cat -- " + shlex.quote(str(imap_secret)))}\n',
                 'message.send.backend.type = "smtp"\n', f'message.send.backend.host = {quote(request["smtpHost"])}\n',
                 f'message.send.backend.port = {request["smtpPort"]}\n',
                 f'message.send.backend.encryption.type = {quote(request["smtpEncryption"])}\n',
                 f'message.send.backend.login = {quote(request["smtpLogin"])}\n',
                 'message.send.backend.auth.type = "password"\n',
                 f'message.send.backend.auth.cmd = {quote("cat -- " + shlex.quote(str(smtp_secret)))}\n',
                 'folder.aliases.inbox = "INBOX"\n',
                 f'folder.aliases.sent = {quote(request["sentFolder"])}\n',
                 f'folder.aliases.drafts = {quote(request["draftsFolder"])}\n',
                 f'folder.aliases.trash = {quote(request["trashFolder"])}\n']
        atomic(CONFIG, "".join(lines))
        print(json.dumps(read_status()))
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        print(json.dumps({"error": "unavailable"}))
        raise SystemExit(5)
