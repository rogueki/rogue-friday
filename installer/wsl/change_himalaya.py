#!/usr/bin/env python3
"""Apply one previously confirmed flag or same-account mailbox move."""
import json
from pathlib import Path
import subprocess
import sys

from configure_himalaya import CONFIG, read_status
from read_himalaya import UID, run


def main():
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or request.get("action") not in ("flag", "move"):
        raise ValueError("invalid_request")
    if not read_status()["readyForLocalUse"] or CONFIG.is_symlink():
        raise RuntimeError("mail_unavailable")
    cli = Path.home() / ".local" / "bin" / "himalaya"
    if not cli.is_file() or cli.is_symlink():
        raise RuntimeError("mail_unavailable")
    folders = run(cli, ["mailbox", "list"])
    names = {row.get("id") for row in folders.get("mailboxes", []) if isinstance(row, dict)}
    mailbox, uid = request.get("mailbox"), request.get("id")
    if mailbox not in names or not isinstance(uid, str) or not UID.fullmatch(uid):
        raise ValueError("invalid_request")
    if request["action"] == "move":
        destination = request.get("destination")
        if destination not in names or destination == mailbox:
            raise ValueError("invalid_request")
        args = ["message", "move", "--from", mailbox, "--to", destination, uid]
    else:
        if "destination" in request:
            raise ValueError("invalid_request")
        args = ["flag", "add", "--mailbox", mailbox, "--flag", "flagged", uid]
    try:
        result = subprocess.run([str(cli), "--config", str(CONFIG), "--account", "friday", "--backend", "imap",
                                 "--log-level", "off", *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=15, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("mail_outcome_unknown") from None
    if result.returncode:
        raise RuntimeError("mail_outcome_unknown")
    print(json.dumps({"state": "changed"}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        print(json.dumps({"error": "invalid_request"}))
        sys.exit(4)
    except RuntimeError as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(6)
