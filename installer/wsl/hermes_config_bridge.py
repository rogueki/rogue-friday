#!/usr/bin/env python3
"""Narrow Friday bridge to the installed Hermes config API. No raw config leaves this process."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import yaml


FIELDS = {
    "agent.max_turns": ("integer", 1, 100000),
    "agent.gateway_timeout": ("integer", 60, 86400),
    "agent.api_max_retries": ("integer", 1, 10),
    "session.terminal_continue": ("boolean", None, None),
    "max_live_sessions": ("integer", 0, 10000),
}
PINNED_SOURCE = "d923a5eb"
FAMILIES = (
    ("models", ("model", "models_dev", "providers", "fallback", "fallback_providers", "auxiliary", "agent.service_tier"), "P7-B"),
    ("agent", ("agent", "compression", "context", "session", "sessions"), "P7-C"),
    ("execution", ("terminal", "browser", "computer_use", "code_execution", "toolsets"), "P7-D"),
    ("extensions", ("skills", "plugins", "mcp"), "P7-E"),
    ("operations", ("cron", "gateway", "logging", "monitoring", "hooks", "update"), "P7-F"),
)


def revision(path):
    try:
        content = path.read_bytes()
    except FileNotFoundError:
        content = b""
    # At most 48 bits, exactly representable by JavaScript's number type.
    return int(hashlib.sha256(content).hexdigest()[:12], 16) or 1


def nested(config, key):
    value = config
    for part in key.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def manifests(root, file_names, max_depth=2):
    result = []
    if not root.is_dir() or root.is_symlink():
        return result
    for directory in sorted(root.iterdir(), key=lambda item: item.name):
        if len(result) >= 500:
            break
        if not directory.is_dir() or directory.is_symlink() or directory.name.startswith("."):
            continue
        candidates = [directory]
        if max_depth > 1:
            candidates.extend(child for child in directory.iterdir() if child.is_dir() and not child.is_symlink())
        for candidate in candidates:
            if any((candidate / name).is_file() for name in file_names):
                result.append(candidate.relative_to(root).as_posix())
                if len(result) >= 500:
                    break
    return result


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("status", "update"):
        return 2
    home = Path.home() / ".hermes"
    source = home / "hermes-agent"
    cli = home.parent / ".local" / "bin" / "hermes"
    if not source.is_dir() or not cli.is_file():
        print(json.dumps({"error": "hermes_not_installed"}))
        return 5
    def call(*args):
        result = subprocess.run([str(cli), "config", *args], capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise ValueError("hermes_config_failed")
        return result.stdout.strip()

    config_path = Path(call("path"))
    if config_path.is_symlink():
        raise ValueError("config_symlink")
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8-sig")) if config_path.exists() else {}
    if not isinstance(raw, dict):
        raise ValueError("invalid_config")
    before = revision(config_path)
    commit = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=3)
    source_revision = commit.stdout.strip() if commit.returncode == 0 else None
    if sys.argv[1] == "update":
        if not source_revision or not source_revision.startswith(PINNED_SOURCE):
            raise ValueError("unsupported_source_revision")
        request = json.load(sys.stdin)
        if not isinstance(request, dict) or set(request) != {"key", "value", "revision"}:
            raise ValueError("invalid_request")
        key, value = request["key"], request["value"]
        spec = FIELDS.get(key)
        if not spec or type(request["revision"]) is not int or type(value) is not (int if spec[0] == "integer" else bool):
            raise ValueError("unsupported_field")
        if spec[0] == "integer" and not spec[1] <= value <= spec[2]:
            raise ValueError("invalid_value")
        if request["revision"] != before:
            print(json.dumps({"error": "revision_conflict"}))
            return 4
        if revision(config_path) != before:
            print(json.dumps({"error": "revision_conflict"}))
            return 4
        # Hermes owns validation and preserving the rest of config.yaml. Never --force.
        call("set", key, str(value).lower() if isinstance(value, bool) else str(value))
    current = revision(config_path)
    values = {}
    for key in FIELDS:
        values[key] = json.loads(call("get", key, "--json"))
    try:
        disabled_skills = json.loads(call("get", "skills.disabled", "--json"))
    except (ValueError, json.JSONDecodeError):
        disabled_skills = []
    try:
        plugin_enabled = json.loads(call("get", "plugins.enabled", "--json"))
    except (ValueError, json.JSONDecodeError):
        plugin_enabled = []
    try:
        plugin_disabled = json.loads(call("get", "plugins.disabled", "--json"))
    except (ValueError, json.JSONDecodeError):
        plugin_disabled = []
    explicit = {key: nested(raw, key) is not None for key in FIELDS}
    # Only safe, typed leaves cross the bridge; provider credentials and arbitrary YAML do not.
    for key, spec in FIELDS.items():
        if values[key] is not None and type(values[key]) is not (int if spec[0] == "integer" else bool):
            values[key] = None
    skill_names = set(manifests(source / "skills", ("SKILL.md",))) | set(manifests(home / "skills", ("SKILL.md",)))
    disabled_skills = set(disabled_skills) if isinstance(disabled_skills, list) else set()
    plugin_names = manifests(home / "plugins", ("plugin.yaml", "plugin.yml"))
    enabled_set = set(plugin_enabled) if isinstance(plugin_enabled, list) else set()
    disabled_set = set(plugin_disabled) if isinstance(plugin_disabled, list) else set()
    print(json.dumps({
        "installed": True, "revision": current, "sourceRevision": source_revision,
        "values": values, "explicit": explicit,
        "secrets": {"model.api_key": bool(nested(raw, "model.api_key"))},
        "families": [{"id": name, "roots": roots, "followup": followup,
                      "configFileSet": any(nested(raw, root) is not None for root in roots)} for name, roots, followup in FAMILIES],
        "skills": [{"id": name, "installed": True, "enabled": name.split("/")[-1] not in disabled_skills} for name in sorted(skill_names)],
        "plugins": [{"id": name, "installed": True, "enabled": name in enabled_set and name not in disabled_set,
                     "configured": None} for name in plugin_names],
        "write": {"key": request["key"], "persisted": values[request["key"]] == request["value"]} if sys.argv[1] == "update" else None,
    }))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, ImportError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error) if str(error) in {"config_symlink", "invalid_request", "unsupported_field", "invalid_value"} else "hermes_unavailable"}))
        raise SystemExit(5)
