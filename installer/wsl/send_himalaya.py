#!/usr/bin/env python3
"""Send one explicitly approved message through Friday's managed SMTP account."""
import json
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formataddr
from pathlib import Path
import re
import subprocess
import sys
import tomllib

from configure_himalaya import CONFIG, read_status

ADDRESS = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")


def valid(data):
    return (isinstance(data, dict) and {"to", "subject", "body"} <= set(data)
            and set(data) <= {"to", "subject", "body", "inReplyTo", "references"}
            and isinstance(data["to"], list) and 1 <= len(data["to"]) <= 10
            and len(set(data["to"])) == len(data["to"])
            and all(isinstance(addr, str) and len(addr) <= 254 and ADDRESS.fullmatch(addr) for addr in data["to"])
            and isinstance(data["subject"], str) and 1 <= len(data["subject"]) <= 200
            and not any(ord(ch) < 32 or ord(ch) == 127 for ch in data["subject"])
            and isinstance(data["body"], str) and 1 <= len(data["body"].encode("utf-8")) <= 100000
            and not any((ord(ch) < 32 and ch not in "\n\t") or ord(ch) == 127 for ch in data["body"])
            and all(isinstance(data.get(name, ""), str) and len(data.get(name, "")) <= 2000
                    and not any(ord(ch) < 32 or ord(ch) == 127 for ch in data.get(name, ""))
                    for name in ("inReplyTo", "references")))


def send(data):
    if not valid(data):
        raise ValueError("invalid_request")
    if not read_status()["readyForLocalUse"]:
        raise RuntimeError("mail_not_configured")
    if CONFIG.is_symlink():
        raise RuntimeError("mail_unavailable")
    account = tomllib.loads(CONFIG.read_text(encoding="utf-8"))["accounts"]["friday"]
    sender = account["email"]
    display_name = account.get("display-name", "")
    if not isinstance(sender, str) or not ADDRESS.fullmatch(sender):
        raise RuntimeError("mail_unavailable")
    message = EmailMessage(policy=SMTP)
    message["From"] = formataddr((display_name, sender))
    message["To"] = ", ".join(data["to"])
    message["Subject"] = data["subject"]
    if data.get("inReplyTo"):
        message["In-Reply-To"] = data["inReplyTo"]
    if data.get("references"):
        message["References"] = data["references"]
    message.set_content(data["body"])
    cli = Path.home() / ".local" / "bin" / "himalaya"
    if not cli.is_file() or cli.is_symlink():
        raise RuntimeError("mail_unavailable")
    try:
        result = subprocess.run(
            [str(cli), "--config", str(CONFIG), "--account", "friday", "--backend", "smtp",
             "--log-level", "off", "message", "send", "--no-save"],
            input=message.as_bytes(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=20, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("mail_outcome_unknown") from None
    if result.returncode:
        raise RuntimeError("mail_outcome_unknown")
    return {"state": "sent"}


if __name__ == "__main__":
    try:
        print(json.dumps(send(json.load(sys.stdin))))
    except (ValueError, KeyError, TypeError, UnicodeError, json.JSONDecodeError):
        print(json.dumps({"error": "invalid_request"}))
        sys.exit(4)
    except RuntimeError as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(6)
