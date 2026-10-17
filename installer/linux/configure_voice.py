#!/usr/bin/env python3
"""Write native Linux voice settings without starting a headless voice service."""

import argparse
import getpass
import json
import os
from pathlib import Path
import pwd
import re
import stat
import sys
import tempfile


SECRET_PATH = Path("/etc/friday/secrets/elevenlabs.key")
CONFIG_PATH = Path("/etc/friday/voice.json")
VOICE_ID = re.compile(r"[A-Za-z0-9]{10,128}\Z")


def valid_key(raw: bytes) -> bytes:
    key = raw.strip()
    if (len(raw) > 4096 or not key or len(key) > 4096
            or not re.fullmatch(rb"[A-Za-z0-9_-]+", key)):
        raise ValueError("Invalid ElevenLabs API key input")
    return key


def read_key(source: str, file_path: str | None) -> bytes:
    if source == "file":
        if not file_path or not Path(file_path).is_absolute():
            raise ValueError("--key-file requires an absolute path")
        descriptor = os.open(file_path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
        try:
            info = os.fstat(descriptor)
            permitted_owner = {0, int(os.environ.get("SUDO_UID", "0"))}
            if not stat.S_ISREG(info.st_mode) or info.st_uid not in permitted_owner or info.st_mode & 0o077 or info.st_size > 4096:
                raise ValueError("Key file must be a private regular file owned by root or the sudo user")
            raw = os.read(descriptor, 4097)
        finally:
            os.close(descriptor)
    elif source == "stdin":
        raw = sys.stdin.buffer.read(4097)
    else:
        raw = getpass.getpass("ElevenLabs API key: ", stream=sys.stderr).encode("ascii")
    return valid_key(raw)


def atomic_private_write(path: Path, data: bytes, owner: int, group: int, mode: int) -> None:
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError(f"Unsafe destination: {path}")
    descriptor, temporary = tempfile.mkstemp(prefix=".friday-", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, owner, group)
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def ensure_secret_directory() -> tuple[int, int]:
    account = pwd.getpwnam("friday")
    secret_dir = SECRET_PATH.parent
    info = secret_dir.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != account.pw_uid or info.st_gid != account.pw_gid or info.st_mode & 0o077:
        raise ValueError("/etc/friday/secrets must be a private friday-owned directory")
    return account.pw_uid, account.pw_gid


def existing_config(service_gid: int) -> dict:
    if CONFIG_PATH.is_symlink():
        raise ValueError("voice.json must not be a symlink")
    if not CONFIG_PATH.exists():
        return {}
    info = CONFIG_PATH.stat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != service_gid
            or info.st_mode & 0o137 or info.st_size > 65536):
        raise ValueError("Existing voice.json has unsafe ownership or permissions")
    with CONFIG_PATH.open(encoding="utf-8") as source:
        config = json.load(source)
    if not isinstance(config, dict):
        raise ValueError("Existing voice.json must be an object")
    return config


def existing_key(service_uid: int, service_gid: int) -> bytes:
    descriptor = os.open(SECRET_PATH, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != service_uid
                or info.st_gid != service_gid or info.st_mode & 0o177 or info.st_size > 4096):
            raise ValueError("Existing ElevenLabs key has unsafe ownership or permissions")
        return valid_key(os.read(descriptor, 4097))
    finally:
        os.close(descriptor)


def reusable_cloud_config(config: dict, service_uid: int, service_gid: int) -> bool:
    if config.get("voice_mode") != "elevenlabs":
        return False
    if (not isinstance(config.get("elevenlabs_voice_id"), str)
            or not VOICE_ID.fullmatch(config["elevenlabs_voice_id"])
            or config.get("elevenlabs_key_file") != str(SECRET_PATH)):
        raise ValueError("Existing ElevenLabs voice configuration is invalid")
    existing_key(service_uid, service_gid)
    return True


def configure(mode: str, voice_id: str | None, key_source: str | None, key_file: str | None) -> None:
    if os.geteuid() != 0:
        raise ValueError("Voice configuration requires root")
    service_uid, service_gid = ensure_secret_directory()
    existing = existing_config(service_gid)
    reusable = reusable_cloud_config(existing, service_uid, service_gid) if mode == "elevenlabs" else False
    if mode == "elevenlabs":
        voice_id = voice_id or (existing["elevenlabs_voice_id"] if reusable else None)
        if not voice_id or not VOICE_ID.fullmatch(voice_id):
            raise ValueError("Cloud mode requires a valid --elevenlabs-voice-id")
        previous_key = existing_key(service_uid, service_gid) if reusable else None
        if key_source:
            key = read_key(key_source, key_file)
            atomic_private_write(SECRET_PATH, key + b"\n", service_uid, service_gid, 0o600)
        elif not reusable:
            raise ValueError("Cloud mode requires --key-stdin, --key-file or --key-prompt")
    elif voice_id or key_source or key_file:
        raise ValueError("ElevenLabs options require --voice-mode elevenlabs")
    existing.update({
        "voice_mode": "elevenlabs" if mode == "elevenlabs" else "streaming_qwen",
        "elevenlabs_key_file": str(SECRET_PATH) if mode == "elevenlabs" else None,
        "elevenlabs_voice_id": voice_id if mode == "elevenlabs" else None,
    })
    try:
        atomic_private_write(CONFIG_PATH, (json.dumps(existing, indent=2, ensure_ascii=False) + "\n").encode(), 0, service_gid, 0o640)
    except Exception:
        if mode == "elevenlabs" and key_source:
            if previous_key is None:
                SECRET_PATH.unlink(missing_ok=True)
            else:
                atomic_private_write(SECRET_PATH, previous_key + b"\n", service_uid, service_gid, 0o600)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice-mode", choices=("local", "elevenlabs"), required=True)
    parser.add_argument("--inspect-existing", action="store_true")
    parser.add_argument("--elevenlabs-voice-id")
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument("--key-file")
    sources.add_argument("--key-stdin", action="store_true")
    sources.add_argument("--key-prompt", action="store_true")
    options = parser.parse_args()
    source = "file" if options.key_file else "stdin" if options.key_stdin else "prompt" if options.key_prompt else None
    try:
        if options.inspect_existing:
            if os.geteuid() != 0:
                raise ValueError("Inspection requires root")
            uid, gid = ensure_secret_directory()
            config = existing_config(gid)
            print("valid" if reusable_cloud_config(config, uid, gid) else "none")
            return
        configure(options.voice_mode, options.elevenlabs_voice_id, source, options.key_file)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        # Error messages intentionally never contain the key or its contents.
        parser.exit(1, f"Voice setup failed: {error}\n")
    print(f"Voice configuration written ({options.voice_mode}); audio transport/service not installed")


if __name__ == "__main__":
    main()
