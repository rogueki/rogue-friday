#!/usr/bin/env python3
"""Safely enable local JSON search while retaining an operator's other settings."""

import os
import secrets
import shutil
import sys
import tempfile
import time
from pathlib import Path

import yaml


def ensure(path: Path) -> bool:
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError("settings_path_untrusted")
    if path.exists() and path.stat().st_size > 128_000:
        raise ValueError("settings_too_large")
    existing = path.read_text(encoding="utf-8") if path.exists() else None
    settings = yaml.safe_load(existing) if existing is not None else {}
    if settings is None:
        settings = {}
    if not isinstance(settings, dict):
        raise ValueError("settings_not_mapping")
    if existing is None:
        settings["use_default_settings"] = True
        settings["general"] = {"debug": False, "instance_name": "Friday Research"}
        settings["server"] = {
            "secret_key": secrets.token_hex(32),
            "base_url": "http://127.0.0.1:43696/",
            "limiter": False,
            "public_instance": False,
            "image_proxy": False,
        }
    search = settings.setdefault("search", {})
    if not isinstance(search, dict):
        raise ValueError("search_not_mapping")
    formats = search.setdefault("formats", ["html"])
    if not isinstance(formats, list) or any(not isinstance(item, str) for item in formats):
        raise ValueError("formats_not_list")
    if "json" in formats:
        return False
    formats.append("json")
    path.parent.mkdir(parents=True, exist_ok=True)
    if existing is not None:
        backup = path.with_name(f"{path.name}.bak-{time.time_ns()}")
        shutil.copy2(path, backup)
        os.chmod(backup, 0o600)
    fd, temporary = tempfile.mkstemp(prefix=".settings-", suffix=".yml", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            yaml.safe_dump(settings, stream, allow_unicode=True, sort_keys=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


if __name__ == "__main__":
    try:
        changed = ensure(Path(sys.argv[1]))
    except (IndexError, OSError, ValueError, yaml.YAMLError) as error:
        print(f"settings_repair_failed:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
    print("settings_updated" if changed else "settings_ready")
