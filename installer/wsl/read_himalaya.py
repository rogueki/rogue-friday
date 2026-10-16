#!/usr/bin/env python3
"""Bounded, read-only view of the one Friday-managed Himalaya IMAP account."""
import json
from email import policy
from email.parser import BytesParser
from pathlib import Path
import re
import subprocess
import sys

from configure_himalaya import CONFIG, read_status

MAX_OUTPUT = 1024 * 1024
UID = re.compile(r"^[1-9][0-9]{0,17}$")


def run(cli, arguments):
    try:
        result = subprocess.run(
            [str(cli), "--config", str(CONFIG), "--account", "friday", "--backend", "imap", "--json", *arguments],
            capture_output=True, timeout=15, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("mail_unavailable") from None
    if result.returncode or len(result.stdout) > MAX_OUTPUT:
        raise RuntimeError("mail_unavailable")
    try:
        return json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise RuntimeError("mail_invalid_response") from None


def read_raw(cli, mailbox, uid):
    try:
        result = subprocess.run(
            [str(cli), "--config", str(CONFIG), "--account", "friday", "--backend", "imap",
             "message", "read", "--mailbox", mailbox, "--raw", uid],
            capture_output=True, timeout=15, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("mail_unavailable") from None
    if result.returncode or len(result.stdout) > MAX_OUTPUT:
        raise RuntimeError("mail_unavailable")
    return result.stdout


def main():
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or request.get("action") not in ("mailboxes", "envelopes", "message"):
        raise ValueError("invalid_request")
    status = read_status()
    if not status["readyForLocalUse"]:
        raise RuntimeError("mail_not_configured")
    cli = Path.home() / ".local" / "bin" / "himalaya"
    if not cli.is_file() or cli.is_symlink():
        raise RuntimeError("mail_unavailable")
    folders = run(cli, ["mailbox", "list"])
    if not isinstance(folders, dict) or not isinstance(folders.get("mailboxes"), list):
        raise RuntimeError("mail_invalid_response")
    mailboxes = [
        {"id": row["id"], "name": row["name"], "role": row.get("role")}
        for row in folders["mailboxes"][:100]
        if isinstance(row, dict) and isinstance(row.get("id"), str)
        and isinstance(row.get("name"), str) and len(row["id"]) <= 200
    ]
    if request["action"] == "mailboxes":
        print(json.dumps({"mailboxes": mailboxes}))
        return
    mailbox = request.get("mailbox")
    if not isinstance(mailbox, str) or mailbox not in {row["id"] for row in mailboxes}:
        raise ValueError("invalid_mailbox")
    if request["action"] == "envelopes":
        page = request.get("page", 1)
        if type(page) is not int or not 1 <= page <= 20:
            raise ValueError("invalid_page")
        result = run(cli, ["envelope", "list", "--mailbox", mailbox, "--page", str(page), "--page-size", "25"])
        if not isinstance(result, dict) or not isinstance(result.get("envelopes"), list):
            raise RuntimeError("mail_invalid_response")
        items = []
        for row in result["envelopes"][:25]:
            if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                continue
            items.append({"id": row["id"], "subject": str(row.get("subject") or "")[:500],
                          "from": row.get("from") if isinstance(row.get("from"), list) else [],
                          "date": row.get("date") if isinstance(row.get("date"), str) else None,
                          "flags": row.get("flags") if isinstance(row.get("flags"), list) else []})
        print(json.dumps({"mailbox": mailbox, "page": page, "items": items}))
        return
    uid = request.get("id")
    if not isinstance(uid, str) or not UID.fullmatch(uid):
        raise ValueError("invalid_message")
    message = BytesParser(policy=policy.default).parsebytes(read_raw(cli, mailbox, uid))
    body = message.get_body(preferencelist=("plain",))
    try:
        content = body.get_content() if body else ""
    except (LookupError, UnicodeError, ValueError):
        content = ""
    if not isinstance(content, str):
        content = ""
    print(json.dumps({"mailbox": mailbox, "id": uid, "subject": str(message.get("subject", ""))[:500],
                      "from": str(message.get("from", ""))[:500], "date": str(message.get("date", ""))[:120],
                      "bodyText": content[:100000]}))


if __name__ == "__main__":
    try:
        main()
    except ValueError:
        print(json.dumps({"error": "invalid_request"}))
        sys.exit(4)
    except RuntimeError as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(6)
