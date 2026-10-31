#!/usr/bin/env python3
"""Switch the installed dashboard voice adapter to the healthy loopback service."""

import argparse
import os
from pathlib import Path
import stat
import tempfile

import yaml


def configure(config_path: Path, voice_port: int, wake_phrase: str, disable: bool = False) -> None:
    if config_path.is_symlink():
        raise ValueError("adapters.yaml must not be a symlink")
    info = config_path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022:
        raise ValueError("adapters.yaml has unsafe permissions")
    data = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("adapters"), dict):
        raise ValueError("adapters.yaml is not an adapter registry")
    allowlist = data.setdefault("allowlist", {})
    if not isinstance(allowlist, dict):
        raise ValueError("adapter allowlist is invalid")
    existing = allowlist.get("friday-voice-http")
    if existing not in (None, "@friday/adapter-voice-http"):
        raise ValueError("existing voice adapter allowlist entry conflicts")
    allowlist["friday-voice-http"] = "@friday/adapter-voice-http"
    voice = data["adapters"].get("voice", {})
    if not isinstance(voice, dict):
        raise ValueError("voice adapter configuration is invalid")
    if disable:
        voice.update({"provider": "friday-voice-http", "enabled": False})
        voice.pop("config", None)
    else:
        voice.update({"provider": "friday-voice-http", "enabled": True,
                      "config": {"baseUrl": f"http://127.0.0.1:{voice_port}",
                                 "wakePhrase": wake_phrase}})
    data["adapters"]["voice"] = voice
    fd, temporary = tempfile.mkstemp(prefix=".adapters-", dir=config_path.parent)
    try:
        os.fchown(fd, info.st_uid, info.st_gid)
        os.fchmod(fd, stat.S_IMODE(info.st_mode))
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            yaml.safe_dump(data, target, allow_unicode=True, sort_keys=False)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, config_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("/etc/friday/adapters.yaml"))
    parser.add_argument("--voice-port", type=int, required=True)
    parser.add_argument("--wake-phrase", required=True)
    parser.add_argument("--disable", action="store_true")
    options = parser.parse_args()
    if not 1024 <= options.voice_port <= 65534:
        parser.error("voice port out of range")
    configure(options.config, options.voice_port, options.wake_phrase, options.disable)
