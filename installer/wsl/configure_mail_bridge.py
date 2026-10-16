#!/usr/bin/env python3
"""Install the reviewed mail-only Hermes plugin and its private loopback key."""

import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import yaml


PLUGIN_NAME = "friday-dashboard-mail"


def decode_stdin_key(line: bytes) -> str:
    """Decode a PowerShell-piped key, allowing its single UTF-8 BOM prefix."""
    value = line.strip()
    if value.startswith(b"\xef\xbb\xbf"):
        value = value[3:]
    return value.decode("ascii", errors="strict")


def private_write(path: Path, value: bytes) -> bool:
    if path.is_symlink():
        raise ValueError("bridge target is a symlink")
    if path.exists() and path.read_bytes() == value and (os.name == "nt" or path.stat().st_mode & 0o077 == 0):
        return False
    fd, name = tempfile.mkstemp(prefix=".mail-", dir=path.parent)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(value)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return True


def _member(node, name):
    if not isinstance(node, yaml.MappingNode):
        raise ValueError("Hermes config section is not a mapping")
    found = [value for key, value in node.value if isinstance(key, yaml.ScalarNode) and key.value == name]
    if len(found) > 1:
        raise ValueError("duplicate Hermes config key")
    return found[0] if found else None


def _insert_line(text: str, line_number: int, addition: str) -> str:
    lines = text.splitlines(keepends=True)
    newline = "\r\n" if "\r\n" in text else "\n"
    if line_number and line_number <= len(lines) and not lines[line_number - 1].endswith(("\n", "\r")):
        lines[line_number - 1] += newline
    lines.insert(line_number, addition.replace("\n", newline))
    return "".join(lines)


def enable_preserving_config(config_path: Path) -> bool:
    if config_path.is_symlink():
        raise ValueError("Hermes config is a symlink")
    original = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    root = yaml.compose(original) if original.strip() else yaml.MappingNode("tag:yaml.org,2002:map", [])
    plugins = _member(root, "plugins")
    if plugins is None:
        updated = _insert_line(original, len(original.splitlines()), f"plugins:\n  enabled:\n    - {PLUGIN_NAME}\n")
    else:
        if not isinstance(plugins, yaml.MappingNode) or plugins.flow_style:
            raise ValueError("unsupported Hermes plugins layout")
        disabled = _member(plugins, "disabled")
        if isinstance(disabled, yaml.SequenceNode) and any(getattr(value, "value", None) == PLUGIN_NAME for value in disabled.value):
            raise ValueError("mail plugin explicitly disabled")
        enabled = _member(plugins, "enabled")
        if enabled is None:
            updated = _insert_line(original, plugins.end_mark.line, f"  enabled:\n    - {PLUGIN_NAME}\n")
        elif isinstance(enabled, yaml.SequenceNode):
            if any(getattr(value, "value", None) == PLUGIN_NAME for value in enabled.value):
                return False
            if enabled.flow_style:
                if enabled.value:
                    raise ValueError("unsupported Hermes enabled list layout")
                updated = original[:enabled.start_mark.index] + f"[{PLUGIN_NAME}]" + original[enabled.end_mark.index:]
            else:
                updated = _insert_line(original, enabled.end_mark.line, f"    - {PLUGIN_NAME}\n")
        else:
            raise ValueError("Hermes enabled plugins must be a list")
    parsed = yaml.safe_load(updated)
    if not isinstance(parsed, dict) or PLUGIN_NAME not in parsed.get("plugins", {}).get("enabled", []):
        raise ValueError("Hermes plugin activation failed validation")
    return private_write(config_path, updated.encode("utf-8"))


def configure(checkout: Path, port: int, key: str, home: Path) -> bool:
    if not isinstance(port, int) or not 1024 <= port <= 65535 or not re.fullmatch(r"[A-Za-z0-9+/]{43}=", key):
        raise ValueError("invalid bridge input")
    raw_key = base64.b64decode(key, validate=True)
    if len(raw_key) != 32 or base64.b64encode(raw_key).decode("ascii") != key:
        raise ValueError("invalid bridge key")
    hermes = home / ".hermes"
    target = hermes / "plugins" / PLUGIN_NAME
    source = checkout / "plugins/friday_dashboard_mail"
    if not (source / "plugin.yaml").is_file() or not (source / "__init__.py").is_file():
        raise ValueError("mail plugin missing")
    if hermes.is_symlink() or (hermes / "plugins").is_symlink() or target.is_symlink():
        raise ValueError("Hermes plugin target is a symlink")
    config_path = hermes / "config.yaml"
    if config_path.is_symlink():
        raise ValueError("Hermes config is a symlink")
    if config_path.exists():
        config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        plugins = config.get("plugins", {}) if isinstance(config, dict) else {}
        if isinstance(plugins, dict) and PLUGIN_NAME in (plugins.get("disabled") or []):
            raise ValueError("mail plugin explicitly disabled")
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    changed = False
    for name in ("plugin.yaml", "__init__.py"):
        value = (source / name).read_bytes()
        if (target / name).is_symlink():
            raise ValueError("Hermes plugin file is a symlink")
        changed |= private_write(target / name, value)
    changed |= private_write(hermes / "friday-mail-bridge.key", (key + "\n").encode("ascii"))
    changed |= private_write(hermes / "friday-mail-bridge.json", (json.dumps({"port": port}) + "\n").encode())
    changed |= enable_preserving_config(config_path)
    return changed


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    checkout = Path(sys.argv[1]).resolve(strict=True)
    port = int(sys.argv[2])
    key = decode_stdin_key(sys.stdin.buffer.readline())
    changed = configure(checkout, port, key, Path.home())
    if changed:
        result = subprocess.run(["systemctl", "--user", "restart", "hermes-gateway.service"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        if result.returncode != 0:
            print("FRIDAY_MAIL_BRIDGE_ERROR gateway restart failed", file=sys.stderr)
            return 1
    print("FRIDAY_MAIL_BRIDGE_READY")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, yaml.YAMLError, subprocess.TimeoutExpired):
        print("FRIDAY_MAIL_BRIDGE_ERROR unavailable", file=sys.stderr)
        raise SystemExit(1)
