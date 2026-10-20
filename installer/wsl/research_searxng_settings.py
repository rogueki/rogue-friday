#!/usr/bin/env python3
"""Safely enable local JSON search while retaining an operator's other settings."""

import os
import secrets
import shutil
import sys
import tempfile
import time
from pathlib import Path
from stat import S_IMODE
from typing import Callable

import yaml


def ensure(path: Path, before_replace: Callable[[], None] | None = None) -> bool:
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError("settings_path_untrusted")
    if path.exists() and path.stat().st_size > 128_000:
        raise ValueError("settings_too_large")
    original_stat = path.stat() if path.exists() else None
    original_bytes = path.read_bytes() if original_stat else None
    existing = original_bytes.decode("utf-8") if original_bytes is not None else None
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
        if original_stat:
            os.chmod(temporary, S_IMODE(original_stat.st_mode))
            if hasattr(os, "chown"):
                os.chown(temporary, original_stat.st_uid, original_stat.st_gid)
        else:
            os.chmod(temporary, 0o644)
        if before_replace:
            before_replace()
        if path.is_symlink():
            raise ValueError("settings_changed_during_repair")
        if original_stat:
            current = path.stat()
            if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) != (
                original_stat.st_dev, original_stat.st_ino, original_stat.st_size, original_stat.st_mtime_ns
            ) or path.read_bytes() != original_bytes:
                raise ValueError("settings_changed_during_repair")
        elif path.exists():
            raise ValueError("settings_created_during_repair")
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
