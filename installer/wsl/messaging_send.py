#!/usr/bin/env python3
"""Fixed-purpose Friday transport to the pinned Hermes send CLI."""
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path.home() / ".hermes" / "hermes-agent"
CLI = Path.home() / ".local" / "bin" / "hermes"
PINNED = "d923a5eb"
PLATFORMS = frozenset({"telegram", "discord", "whatsapp", "slack", "signal",
                       "matrix", "mattermost", "sms", "irc", "line", "feishu",
                       "teams", "google_chat", "wecom", "dingtalk", "simplex",
                       "photon", "buzz", "ntfy"})
RECIPIENT = re.compile(r"^[A-Za-z0-9_@.!+#-]{1,128}$")
ENV = Path.home() / ".hermes" / ".env"


def admitted_target(platform, recipient):
    if ENV.is_symlink() or not ENV.is_file():
        return False
    key = platform.upper() + "_ALLOWED_USERS="
    values = [line[len(key):].strip().strip('"') for line in ENV.read_text(encoding="utf-8").splitlines()
              if line.startswith(key)]
    return len(values) == 1 and recipient in values[0].split(",")


def send(request, runner=subprocess.run):
    if not isinstance(request, dict) or set(request) != {"action", "platform", "recipient", "text"}:
        return {"state": "rejected", "reason": "invalid_request"}
    if request["action"] not in ("check", "send"):
        return {"state": "rejected", "reason": "invalid_request"}
    platform, recipient, message = (request[key] for key in ("platform", "recipient", "text"))
    if not isinstance(platform, str) or platform not in PLATFORMS or not isinstance(recipient, str) or not RECIPIENT.fullmatch(recipient) or \
            not isinstance(message, str) or not message.strip() or len(message.encode("utf-8")) > 8192 or \
            "MEDIA:" in message or "[[as_document]]" in message:
        return {"state": "rejected", "reason": "invalid_target_or_text"}
    if not admitted_target(platform, recipient):
        return {"state": "rejected", "reason": "recipient_not_admitted"}
    if not CLI.is_file() or not (ROOT / "hermes_cli" / "send_cmd.py").is_file():
        return {"state": "rejected", "reason": "hermes_unavailable"}
    pin = runner(["git", "-C", str(ROOT), "rev-parse", "--short=8", "HEAD"],
                 capture_output=True, text=True, timeout=3, check=False)
    if pin.returncode != 0 or pin.stdout.strip() != PINNED:
        return {"state": "rejected", "reason": "hermes_version_changed"}
    if request["action"] == "check":
        return {"state": "ready"}
    # No message or secret in argv, stderr, or Friday logs. Once invoked, any
    # timeout/parse failure may follow delivery and must never be retried blindly.
    try:
        result = runner([str(CLI), "send", "--to", f"{platform}:{recipient}", "--file", "-", "--json"],
                        input=message, capture_output=True, text=True, timeout=30, check=False)
    except subprocess.TimeoutExpired:
        return {"state": "uncertain"}
    try:
        payload = json.loads(result.stdout)
    except (ValueError, TypeError):
        return {"state": "uncertain"}
    if result.returncode == 0 and payload.get("success") is True:
        external = payload.get("message_id")
        return {"state": "sent", "externalId": external if isinstance(external, str) and len(external) <= 128 else None}
    return {"state": "uncertain"}


if __name__ == "__main__":
    try:
        print(json.dumps(send(json.load(sys.stdin))))
    except (OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired):
        print(json.dumps({"state": "uncertain"}))
