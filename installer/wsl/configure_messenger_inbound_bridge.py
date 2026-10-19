#!/usr/bin/env python3
"""Provision the separate, local gateway-admission bridge for a pinned Hermes profile."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

from configure_memory_bridge import PINNED_HERMES, private_write


def configure(checkout: Path, port: int, key: str, home: Path, source: Path) -> bool:
    if not 1024 <= port <= 65535 or not re.fullmatch(r"[A-Za-z0-9+/]{43}=", key):
        raise ValueError("invalid messenger bridge input")
    if len(base64.b64decode(key, validate=True)) != 32:
        raise ValueError("invalid messenger bridge key")
    revision = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], check=True,
                              capture_output=True, text=True, timeout=10).stdout.strip()
    if revision != PINNED_HERMES:
        raise ValueError("Hermes version unsupported by Friday messenger bridge")
    changed_source = subprocess.run(["git", "-C", str(source), "status", "--porcelain", "--",
                                     "gateway/run_inbound_consumer.py", "hermes_cli/plugins.py"], check=True,
                                    capture_output=True, text=True, timeout=10).stdout.strip()
    if changed_source:
        raise ValueError("Hermes gateway hook source has local changes")
    hooks = (source / "hermes_cli/plugins.py").read_text(encoding="utf-8")
    consumer = (source / "gateway/run_inbound_consumer.py").read_text(encoding="utf-8")
    plugin = checkout / "wsl/friday_memory_plugin/__init__.py"
    installed = home / ".hermes/plugins/friday-memory/__init__.py"
    if '"post_gateway_admission"' not in hooks or "post_gateway_admission" not in consumer or \
            not plugin.is_file() or not installed.is_file() or \
            "_messenger_admitted" not in installed.read_text(encoding="utf-8"):
        raise ValueError("Friday messenger admission hook is not installed")
    hermes = home / ".hermes"
    if hermes.is_symlink() or installed.is_symlink():
        raise ValueError("Hermes plugin path is a symlink")
    settings_db = checkout.parent / "dashboard/data/memory/outbox.sqlite"
    changed = private_write(hermes / "friday-messenger-bridge.key", (key + "\n").encode("ascii"))
    changed |= private_write(hermes / "friday-messenger-bridge.json", (json.dumps({
        "port": port, "accountId": "default", "hermesHome": str(hermes.resolve()),
        "settingsDb": str(settings_db.resolve())}, separators=(",", ":")) + "\n").encode("utf-8"))
    return changed


def ensure_applied(hermes: Path, changed: bool, runner=subprocess.run) -> None:
    stamp = hermes / "friday-messenger-bridge-applied.sha256"
    if stamp.is_symlink():
        raise ValueError("unsafe messenger apply marker")
    digest = hashlib.sha256((hermes / "friday-messenger-bridge.key").read_bytes() +
                            (hermes / "friday-messenger-bridge.json").read_bytes()).hexdigest()
    if changed or not stamp.is_file() or stamp.read_text(encoding="ascii").strip() != digest:
        result = runner(["systemctl", "--user", "restart", "hermes-gateway.service"],
                        capture_output=True, timeout=20)
        if result.returncode:
            raise OSError("gateway restart failed")
        active = runner(["systemctl", "--user", "is-active", "hermes-gateway.service"],
                        capture_output=True, timeout=5)
        if active.returncode or active.stdout.strip() != b"active":
            raise OSError("gateway not active after restart")
        private_write(stamp, (digest + "\n").encode("ascii"))


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    key = sys.stdin.buffer.readline().strip()
    if key.startswith(b"\xef\xbb\xbf"):
        key = key[3:]
    home = Path.home()
    hermes = home / ".hermes"
    changed = configure(Path(sys.argv[1]).resolve(strict=True), int(sys.argv[2]), key.decode("ascii"),
                        home, hermes / "hermes-agent")
    ensure_applied(hermes, changed)
    print("FRIDAY_MESSENGER_BRIDGE_READY")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        print("FRIDAY_MESSENGER_BRIDGE_ERROR unsupported or unavailable", file=sys.stderr)
        raise SystemExit(1)
