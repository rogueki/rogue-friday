#!/usr/bin/env python3
"""Import a verified WSL snapshot into a separately provisioned Friday profile."""
from __future__ import annotations

import hashlib
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import sys


ROOTS = {"hermes", "friday-mail", "friday-calendar", "himalaya"}
EXCLUDED = ["cache", "hermes-agent", "installs", "tools"]
REAPPLY_MARKER = "hermes/friday-messenger-bridge-applied.sha256"
RECEIPT_NAME = ".friday-recovery-receipt.json"
SQLITE_HEADER = b"SQLite format 3\x00"


def ordinary(path: Path) -> None:
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("restore source is not an ordinary file")


def no_linked_ancestor(path: Path) -> None:
    if any(parent.is_symlink() for parent in (path, *path.parents)):
        raise ValueError("WSL recovery path has a linked ancestor")


def safe_relative(name: str) -> Path:
    if not isinstance(name, str) or "\\" in name or "\x00" in name:
        raise ValueError("invalid WSL restore path")
    path = Path(name)
    if path.is_absolute() or not path.parts or any(part in (".", "..") for part in path.parts):
        raise ValueError("invalid WSL restore path")
    if path.parts[0] not in ROOTS or (path.parts[0] == "hermes" and len(path.parts) > 1 and
                                     path.parts[1] in EXCLUDED):
        raise ValueError("WSL restore path is outside user state")
    return path


def destination(home: Path, name: str) -> Path:
    parts = safe_relative(name).parts
    if parts[0] == "hermes":
        return home / ".hermes" / Path(*parts[1:])
    if parts[0] == "friday-mail":
        return home / ".config/friday/mail" / Path(*parts[1:])
    if parts[0] == "friday-calendar":
        return home / ".config/friday/calendar" / Path(*parts[1:])
    if parts[0] == "himalaya":
        if parts != ("himalaya", "config.toml"):
            raise ValueError("invalid Himalaya restore path")
        return home / ".config/himalaya/config.toml"
    raise ValueError("invalid WSL restore path")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def inventory(source: Path) -> tuple[dict[str, str], list[str], str]:
    no_linked_ancestor(source)
    if source.is_symlink() or not source.is_dir():
        raise ValueError("WSL restore source is not a directory")
    manifest_file = source / "manifest.json"
    ordinary(manifest_file)
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if (manifest.get("version") != 1 or not isinstance(manifest.get("files"), dict) or
            not isinstance(manifest.get("sqlite"), list) or
            manifest.get("excludedRebuildable") != EXCLUDED or
            not isinstance(manifest.get("hermesRevision"), str) or
            len(manifest["hermesRevision"]) != 40 or
            any(c not in "0123456789abcdef" for c in manifest["hermesRevision"])):
        raise ValueError("WSL restore manifest is invalid")
    files = manifest["files"]
    found = []
    for folder, dirs, names in os.walk(source, followlinks=False):
        for entry in dirs:
            if (Path(folder) / entry).is_symlink():
                raise ValueError("WSL restore contains a link")
        for entry in names:
            item = Path(folder) / entry
            ordinary(item)
            found.append(item.relative_to(source).as_posix())
    if sorted(found) != sorted([*files, "manifest.json"]):
        raise ValueError("WSL restore inventory mismatch")
    databases = []
    for name, expected in files.items():
        safe_relative(name)
        if not isinstance(expected, str) or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
            raise ValueError("WSL restore checksum is invalid")
        item = source / name
        if digest(item) != expected:
            raise ValueError("WSL restore checksum mismatch")
        with item.open("rb") as stream:
            if stream.read(16) == SQLITE_HEADER:
                databases.append(name)
                with closing(sqlite3.connect(f"file:{item}?mode=ro", uri=True)) as database:
                    if database.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                        raise ValueError("WSL restore database is corrupt")
    if sorted(databases) != sorted(manifest["sqlite"]) or len(databases) != len(manifest["sqlite"]):
        raise ValueError("WSL restore database inventory mismatch")
    return files, databases, manifest["hermesRevision"]


def pinned_checkout(home: Path, revision: str) -> None:
    checkout = home / ".hermes/hermes-agent"
    if checkout.is_symlink() or not checkout.is_dir():
        raise ValueError("pinned Hermes checkout is unavailable")
    head = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"],
                          capture_output=True, text=True, timeout=30, check=False)
    dirty = subprocess.run(["git", "-C", str(checkout), "status", "--porcelain"],
                           capture_output=True, text=True, timeout=30, check=False)
    if head.returncode or head.stdout.strip() != revision or dirty.returncode or dirty.stdout:
        raise ValueError("Hermes checkout does not match the clean pinned revision")


def import_snapshot(source: Path, home: Path) -> dict[str, object]:
    files, databases, revision = inventory(source)
    no_linked_ancestor(home)
    if not home.is_dir():
        raise ValueError("target WSL home is unavailable")
    pinned_checkout(home, revision)
    receipt = home / RECEIPT_NAME
    if receipt.exists() or receipt.is_symlink():
        raise ValueError("target WSL profile already has a recovery receipt")
    # This digest only says a former gateway process observed a bridge config.
    # A recovered gateway must apply and acknowledge the restored config again.
    targets = [(source / name, destination(home, name)) for name in sorted(files) if name != REAPPLY_MARKER]
    for _, target in targets:
        if target.exists() or target.is_symlink():
            raise ValueError("target WSL state already exists")
        parent = target.parent
        while parent != home:
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise ValueError("target WSL state has an unsafe parent")
            parent = parent.parent
    created_files: list[Path] = []
    created_dirs: list[Path] = []
    try:
        for origin, target in targets:
            missing = []
            parent = target.parent
            while parent != home and not parent.exists():
                missing.append(parent)
                parent = parent.parent
            for folder in reversed(missing):
                folder.mkdir(mode=0o700)
                created_dirs.append(folder)
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            created_files.append(target)
            with os.fdopen(descriptor, "wb") as writer, origin.open("rb") as reader:
                shutil.copyfileobj(reader, writer, length=1024 * 1024)
                writer.flush()
                os.fsync(writer.fileno())
            target.chmod(0o600)
            if digest(target) != files[target_to_name(home, target)]:
                raise ValueError("WSL restore copy changed")
        payload = {"version": 1, "manifestSha256": digest(source / "manifest.json"),
                   "files": {target_to_name(home, target): files[target_to_name(home, target)] for _, target in targets},
                   "createdDirs": [folder.relative_to(home).as_posix() for folder in created_dirs]}
        descriptor = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        created_files.append(receipt)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        receipt.chmod(0o600)
        return {"fileCount": len(targets), "databaseCount": len(databases), "hermesRevision": revision,
                "state": "imported; services must be reprovisioned and health-checked"}
    except Exception:
        for item in reversed(created_files):
            item.unlink(missing_ok=True)
        for folder in reversed(created_dirs):
            folder.rmdir()
        raise


def rollback_snapshot(source: Path, home: Path) -> dict[str, object]:
    no_linked_ancestor(home)
    files, _, _ = inventory(source)
    receipt = home / RECEIPT_NAME
    ordinary(receipt)
    payload = json.loads(receipt.read_text(encoding="utf-8"))
    expected = {name: value for name, value in files.items() if name != REAPPLY_MARKER}
    allowed_dirs = {parent.relative_to(home).as_posix() for name in expected
                    for parent in destination(home, name).parents if parent != home and home in parent.parents}
    created_dirs = payload.get("createdDirs")
    if (payload.get("version") != 1 or payload.get("manifestSha256") != digest(source / "manifest.json") or
            payload.get("files") != expected or not isinstance(created_dirs, list) or
            len(created_dirs) != len(set(created_dirs)) or any(name not in allowed_dirs for name in created_dirs)):
        raise ValueError("WSL recovery receipt does not match the source")
    targets = [destination(home, name) for name in sorted(expected)]
    for name, target in zip(sorted(expected), targets):
        ordinary(target)
        if digest(target) != expected[name]:
            raise ValueError("imported WSL state changed; rollback refused")
        parent = target.parent
        while parent != home:
            if parent.is_symlink() or not parent.is_dir():
                raise ValueError("imported WSL state has an unsafe parent")
            parent = parent.parent
    for target in targets:
        target.unlink()
    receipt.unlink()
    for parent in sorted((home / name for name in created_dirs), key=lambda path: len(path.parts), reverse=True):
        try:
            parent.rmdir()
        except OSError:
            pass  # A pre-existing directory or the pinned checkout remains.
    return {"removedFileCount": len(targets), "state": "rolled back"}


def target_to_name(home: Path, target: Path) -> str:
    relative = target.relative_to(home).as_posix()
    for prefix, label in ((".hermes/", "hermes/"), (".config/friday/mail/", "friday-mail/"),
                          (".config/friday/calendar/", "friday-calendar/")):
        if relative.startswith(prefix):
            return label + relative[len(prefix):]
    if relative == ".config/himalaya/config.toml":
        return "himalaya/config.toml"
    raise ValueError("invalid WSL restore target")


def main() -> None:
    request = json.load(sys.stdin)
    source = Path(request["source"])
    home = Path(request["home"])
    if not source.is_absolute() or not home.is_absolute() or source == home or source in home.parents or home in source.parents:
        raise ValueError("WSL restore paths must be separate absolute directories")
    if request.get("action") == "plan":
        files, databases, revision = inventory(source)
        print(json.dumps({"fileCount": len(files), "databaseCount": len(databases), "hermesRevision": revision}))
    elif request.get("action") == "import":
        print(json.dumps(import_snapshot(source, home)))
    elif request.get("action") == "rollback":
        print(json.dumps(rollback_snapshot(source, home)))
    else:
        raise ValueError("invalid WSL restore action")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, sqlite3.Error, json.JSONDecodeError, subprocess.TimeoutExpired):
        print(json.dumps({"error": "WSL restore failed"}))
        sys.exit(1)
