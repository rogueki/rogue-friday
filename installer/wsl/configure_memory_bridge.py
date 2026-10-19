#!/usr/bin/env python3
"""Install Friday's pinned Hermes CLI memory plugin without changing other plugins."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

import yaml


PLUGIN = "friday-memory"
PINNED_HERMES = "d923a5eb487a17c0a68801bba9ef0f56c81040a8"


def private_write(path: Path, data: bytes) -> bool:
    if path.is_symlink():
        raise ValueError("memory bridge target is a symlink")
    if path.exists() and path.read_bytes() == data and (os.name == "nt" or path.stat().st_mode & 0o077 == 0):
        return False
    fd, temporary = tempfile.mkstemp(prefix=".memory-", dir=path.parent)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


def _member(node, name):
    if not isinstance(node, yaml.MappingNode):
        raise ValueError("Hermes config section is not a mapping")
    values = [value for key, value in node.value if isinstance(key, yaml.ScalarNode) and key.value == name]
    if len(values) > 1:
        raise ValueError("duplicate Hermes config key")
    return values[0] if values else None


def _insert(original: str, line: int, addition: str) -> str:
    lines = original.splitlines(keepends=True)
    newline = "\r\n" if "\r\n" in original else "\n"
    if line and line <= len(lines) and not lines[line - 1].endswith(("\n", "\r")):
        lines[line - 1] += newline
    lines.insert(line, addition.replace("\n", newline))
    return "".join(lines)


def enable_plugin(path: Path) -> bool:
    if path.is_symlink():
        raise ValueError("Hermes config is a symlink")
    original = path.read_text(encoding="utf-8") if path.exists() else ""
    root = yaml.compose(original) if original.strip() else yaml.MappingNode("tag:yaml.org,2002:map", [])
    plugins = _member(root, "plugins")
    if plugins is None:
        updated = _insert(original, len(original.splitlines()), f"plugins:\n  enabled:\n    - {PLUGIN}\n")
    else:
        if not isinstance(plugins, yaml.MappingNode) or plugins.flow_style:
            raise ValueError("unsupported Hermes plugins layout")
        disabled = _member(plugins, "disabled")
        if isinstance(disabled, yaml.SequenceNode) and any(getattr(item, "value", None) == PLUGIN for item in disabled.value):
            raise ValueError("memory plugin explicitly disabled")
        enabled = _member(plugins, "enabled")
        if enabled is None:
            updated = _insert(original, plugins.end_mark.line, f"  enabled:\n    - {PLUGIN}\n")
        elif isinstance(enabled, yaml.SequenceNode):
            if any(getattr(item, "value", None) == PLUGIN for item in enabled.value):
                return False
            if enabled.flow_style:
                if enabled.value:
                    raise ValueError("unsupported Hermes enabled list layout")
                updated = original[:enabled.start_mark.index] + f"[{PLUGIN}]" + original[enabled.end_mark.index:]
            else:
                updated = _insert(original, enabled.end_mark.line, f"    - {PLUGIN}\n")
        else:
            raise ValueError("Hermes enabled plugins must be a list")
    parsed = yaml.safe_load(updated)
    if PLUGIN not in parsed.get("plugins", {}).get("enabled", []):
        raise ValueError("Hermes plugin activation failed validation")
    return private_write(path, updated.encode("utf-8"))


def configure(checkout: Path, port: int, key: str, home: Path, hermes_source: Path) -> bool:
    if not isinstance(port, int) or not 1024 <= port <= 65535 or not re.fullmatch(r"[A-Za-z0-9+/]{43}=", key):
        raise ValueError("invalid memory bridge input")
    if len(base64.b64decode(key, validate=True)) != 32:
        raise ValueError("invalid memory bridge key")
    revision = subprocess.run(["git", "-C", str(hermes_source), "rev-parse", "HEAD"],
                              check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    if revision != PINNED_HERMES:
        raise ValueError("Hermes version unsupported by Friday memory plugin")
    relevant = subprocess.run(["git", "-C", str(hermes_source), "status", "--porcelain", "--",
                               "hermes_cli/plugins.py", "agent/turn_context.py", "agent/turn_finalizer.py"],
                              check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    if relevant:
        raise ValueError("Hermes memory hook source has local changes")
    hooks = (hermes_source / "hermes_cli/plugins.py").read_text(encoding="utf-8")
    if not all(f'"{name}"' in hooks for name in ("pre_llm_call", "post_llm_call", "on_session_finalize")):
        raise ValueError("Hermes memory hooks unavailable")
    source = checkout / "wsl/friday_memory_plugin"
    if not all((source / name).is_file() for name in ("plugin.yaml", "__init__.py")):
        raise ValueError("Friday memory plugin missing")
    hermes = home / ".hermes"
    target = hermes / "plugins" / PLUGIN
    if any(path.is_symlink() for path in (hermes, hermes / "plugins", target)):
        raise ValueError("Hermes plugin target is a symlink")
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    changed = False
    for name in ("plugin.yaml", "__init__.py"):
        changed |= private_write(target / name, (source / name).read_bytes())
    changed |= private_write(hermes / "friday-memory-bridge.key", (key + "\n").encode("ascii"))
    settings_db = Path(os.environ.get("FRIDAY_MEMORY_SETTINGS_DB") or checkout.parent / "dashboard/data/memory/outbox.sqlite")
    changed |= private_write(hermes / "friday-memory-bridge.json", (json.dumps({
        "port": port, "ownerCli": True, "settingsDb": str(settings_db)}) + "\n").encode())
    changed |= enable_plugin(hermes / "config.yaml")
    return changed


def snapshot(home: Path, run_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", run_id):
        raise ValueError("invalid memory update ID")
    hermes = home / ".hermes"
    backup = hermes / f"friday-memory-backup-{run_id}"
    if backup.exists() or backup.is_symlink():
        raise ValueError("memory update backup already exists")
    backup.mkdir(mode=0o700)
    paths = ["config.yaml", "friday-memory-bridge.key", "friday-memory-bridge.json",
             "plugins/friday-memory/plugin.yaml", "plugins/friday-memory/__init__.py"]
    existing = []
    for name in paths:
        source = hermes / name
        if source.is_symlink():
            raise ValueError("memory update source is a symlink")
        if source.is_file():
            target = backup / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            existing.append(name)
    private_write(backup / "manifest.json", (json.dumps(existing) + "\n").encode())
    return backup


def restore(home: Path, run_id: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{32}", run_id):
        raise ValueError("invalid memory update ID")
    hermes = home / ".hermes"
    backup = hermes / f"friday-memory-backup-{run_id}"
    if backup.is_symlink() or not backup.is_dir():
        raise ValueError("memory update backup missing")
    existing = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
    paths = ["config.yaml", "friday-memory-bridge.key", "friday-memory-bridge.json",
             "plugins/friday-memory/plugin.yaml", "plugins/friday-memory/__init__.py"]
    if not isinstance(existing, list) or any(item not in paths for item in existing):
        raise ValueError("memory update manifest invalid")
    for name in paths:
        target = hermes / name
        if target.is_symlink():
            raise ValueError("memory rollback target is a symlink")
        if name in existing:
            private_write(target, (backup / name).read_bytes())
        elif target.exists():
            target.unlink()


def main() -> int:
    if len(sys.argv) not in (3, 5):
        return 2
    mode = sys.argv[3] if len(sys.argv) == 5 else "apply"
    run_id = sys.argv[4] if len(sys.argv) == 5 else None
    if mode not in ("apply", "rollback") or len(sys.argv) == 5 and not re.fullmatch(r"[0-9a-f]{32}", run_id or ""):
        raise ValueError("invalid memory update mode")
    if mode == "rollback":
        restore(Path.home(), run_id)
        changed = True
    else:
        key = sys.stdin.buffer.readline().strip()
        if key.startswith(b"\xef\xbb\xbf"):
            key = key[3:]
        if run_id:
            snapshot(Path.home(), run_id)
        try:
            changed = configure(Path(sys.argv[1]).resolve(strict=True), int(sys.argv[2]), key.decode("ascii"),
                                Path.home(), Path.home() / ".hermes/hermes-agent")
        except BaseException:
            if run_id:
                restore(Path.home(), run_id)
            raise
    if changed:
        result = subprocess.run(["systemctl", "--user", "restart", "hermes-gateway.service"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        if result.returncode:
            raise OSError("gateway restart failed")
    print("FRIDAY_MEMORY_BRIDGE_ROLLED_BACK" if mode == "rollback" else "FRIDAY_MEMORY_BRIDGE_READY")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, yaml.YAMLError, subprocess.SubprocessError):
        print("FRIDAY_MEMORY_BRIDGE_ERROR unsupported or unavailable", file=sys.stderr)
        raise SystemExit(1)
