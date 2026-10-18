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
                       "wecom", "photon", "buzz", "ntfy"})
RECIPIENT = re.compile(r"^[A-Za-z0-9_@.!+#:;=-]{1,128}$")
EXACT_TARGETS = {
    "telegram": r"-?[0-9]{5,20}(?::[0-9]+)?",
    "discord": r"[0-9]{10,20}(?::[0-9]{10,20})?",
    "slack": r"[CGD][A-Z0-9]{8,}",
    "signal": r"\+[1-9][0-9]{6,14}",
    "sms": r"\+[1-9][0-9]{6,14}",
    "matrix": r"[@!][A-Za-z0-9_.=-]+:[A-Za-z0-9.-]+(?::[0-9]{1,5})?",
    "mattermost": r"[a-z0-9]{26}",
    "irc": r"#[A-Za-z0-9_-]{1,64}",
    "line": r"[UCR][0-9a-f]{32}",
    "feishu": r"(?:oc|ou|on|chat|open)_[A-Za-z0-9-]+",
    "wecom": r"[A-Za-z0-9_-]{1,128}",
    "photon": r"any;-;\+[0-9]{6,15}",
    "buzz": r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}",
    "ntfy": r"[A-Za-z0-9_-]{1,128}",
}


def exact_target(platform, recipient):
    if platform == "whatsapp":
        return bool(re.fullmatch(r"\+[1-9][0-9]{6,14}|[A-Za-z0-9_-]+@(?:g\.us|s\.whatsapp\.net|lid|broadcast|newsletter)", recipient))
    return bool(re.fullmatch(EXACT_TARGETS[platform], recipient))


def configured_revision(platform):
    # The install's published runtime provides its isolated dependencies. Plain
    # WSL python3 cannot import gateway.config on this installation.
    sys.path.insert(0, str(ROOT))
    from hermes_cli._launchers import runtime_command
    path = Path(__file__).with_name("messaging_config_probe.py")
    command = runtime_command(ROOT, [platform], code=f"import runpy; runpy.run_path({str(path)!r}, run_name='__main__')")
    result = subprocess.run(command, capture_output=True, text=True, timeout=8, check=False)
    if result.returncode != 0:
        raise RuntimeError("Hermes config probe unavailable")
    try:
        payload = json.loads(result.stdout)
    except ValueError as exc:
        raise RuntimeError("Hermes config probe invalid") from exc
    if payload.get("state") == "unconfigured":
        return None
    if payload.get("state") != "configured" or not re.fullmatch(r"[a-f0-9]{64}", str(payload.get("revision", ""))):
        raise RuntimeError("Hermes config probe unavailable")
    return payload["revision"]


def send(request, runner=subprocess.run):
    if not isinstance(request, dict) or request.get("action") not in ("check", "send"):
        return {"state": "rejected", "reason": "invalid_request"}
    expected_keys = {"action", "platform", "recipient", "text"}
    if request["action"] == "send":
        expected_keys.add("expectedConfigRevision")
    if set(request) != expected_keys:
        return {"state": "rejected", "reason": "invalid_request"}
    platform, recipient, message = (request[key] for key in ("platform", "recipient", "text"))
    if not isinstance(platform, str) or platform not in PLATFORMS or not isinstance(recipient, str) or not RECIPIENT.fullmatch(recipient) or not exact_target(platform, recipient) or \
            not isinstance(message, str) or not message.strip() or len(message.encode("utf-8")) > 8192 or \
            "MEDIA:" in message or "[[as_document]]" in message:
        return {"state": "rejected", "reason": "invalid_target_or_text"}
    if not CLI.is_file() or not (ROOT / "hermes_cli" / "send_cmd.py").is_file():
        return {"state": "rejected", "reason": "hermes_unavailable"}
    try:
        pin = runner(["git", "-C", str(ROOT), "rev-parse", "--short=8", "HEAD"],
                     capture_output=True, text=True, timeout=3, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return {"state": "rejected", "reason": "hermes_pin_unavailable"}
    if pin.returncode != 0 or pin.stdout.strip() != PINNED:
        return {"state": "rejected", "reason": "hermes_version_changed"}
    try:
        revision = configured_revision(platform)
    except Exception:
        return {"state": "rejected", "reason": "config_probe_unavailable"}
    if not revision:
        return {"state": "rejected", "reason": "platform_not_configured"}
    if request["action"] == "check":
        # Configuration is a prerequisite, not a live auth or delivery probe.
        return {"state": "configured", "revision": revision}
    expected_revision = request["expectedConfigRevision"]
    if not isinstance(expected_revision, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_revision) or expected_revision != revision:
        return {"state": "rejected", "reason": "configuration_changed"}
    # No message or secret in argv, stderr, or Friday logs. Once invoked, any
    # timeout/parse failure may follow delivery and must never be retried blindly.
    try:
        result = runner([str(CLI), "send", "--to", f"{platform}:{recipient}", "--file", "-", "--json"],
                        input=message, capture_output=True, text=True, timeout=20, check=False)
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
