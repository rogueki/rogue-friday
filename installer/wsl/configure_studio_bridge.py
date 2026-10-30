#!/usr/bin/env python3
"""Install the Content Studio plan plugin and its private loopback key for Hermes (I-054)."""

import base64
import json
from pathlib import Path
import re
import subprocess
import sys

import yaml

from configure_calendar_bridge import _insert_line, _member, decode_stdin_key, private_write


PLUGIN_NAME = "friday-studio-plan"


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
            raise ValueError("studio plan plugin explicitly disabled")
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


def configure(installer: Path, port: int, key: str, home: Path) -> bool:
    if not 1024 <= port <= 65535 or not re.fullmatch(r"[A-Za-z0-9+/]{43}=", key):
        raise ValueError("invalid bridge input")
    if len(base64.b64decode(key, validate=True)) != 32:
        raise ValueError("invalid bridge key")
    hermes = home / ".hermes"
    target = hermes / "plugins" / PLUGIN_NAME
    source = installer / "wsl/friday_studio_plan_plugin"
    if not (source / "plugin.yaml").is_file() or not (source / "__init__.py").is_file():
        raise ValueError("studio plan plugin missing")
    if hermes.is_symlink() or (hermes / "plugins").is_symlink() or target.is_symlink():
        raise ValueError("Hermes plugin target is a symlink")
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    changed = False
    for name in ("plugin.yaml", "__init__.py"):
        if (target / name).is_symlink():
            raise ValueError("Hermes plugin file is a symlink")
        changed |= private_write(target / name, (source / name).read_bytes())
    changed |= private_write(hermes / "friday-studio-plan-bridge.key", (key + "\n").encode("ascii"))
    changed |= private_write(hermes / "friday-studio-plan-bridge.json", (json.dumps({"port": port}) + "\n").encode())
    changed |= enable_preserving_config(hermes / "config.yaml")
    return changed


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    installer = Path(sys.argv[1]).resolve(strict=True)
    port = int(sys.argv[2])
    key = decode_stdin_key(sys.stdin.buffer.readline())
    if configure(installer, port, key, Path.home()):
        result = subprocess.run(["systemctl", "--user", "restart", "hermes-gateway.service"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        if result.returncode != 0:
            print("FRIDAY_STUDIO_BRIDGE_ERROR gateway restart failed", file=sys.stderr)
            return 1
    print("FRIDAY_STUDIO_BRIDGE_READY")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, yaml.YAMLError, subprocess.TimeoutExpired):
        print("FRIDAY_STUDIO_BRIDGE_ERROR unavailable", file=sys.stderr)
        raise SystemExit(1)
