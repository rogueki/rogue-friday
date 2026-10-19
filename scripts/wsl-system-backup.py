#!/usr/bin/env python3
"""Snapshot Friday's WSL-owned state into a private Windows staging directory."""
from __future__ import annotations

import hashlib
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import sys


SOURCES = (
    (".hermes", "hermes"),
    (".config/friday/mail", "friday-mail"),
    (".config/friday/calendar", "friday-calendar"),
    (".config/himalaya/config.toml", "himalaya/config.toml"),
)
EXCLUDE_DIRS = {".git", "__pycache__", "hermes-agent", "cache", "logs"}
MAX_ITEMS = 100_000


def check_file(path: Path) -> None:
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode):
        raise ValueError("unsupported or linked WSL backup source")


def inventory(home: Path) -> list[tuple[Path, str, int]]:
    found: list[tuple[Path, str, int]] = []
    for relative, label in SOURCES:
        source = home / relative
        ancestor = home
        for part in Path(relative).parts[:-1]:
            ancestor /= part
            if ancestor.is_symlink():
                raise ValueError("linked WSL backup parent")
        if not source.exists() and not source.is_symlink():
            continue
        if source.is_symlink():
            raise ValueError("linked WSL backup source")
        if source.is_file():
            check_file(source)
            found.append((source, label, source.stat().st_size))
            continue
        if not source.is_dir():
            raise ValueError("unsupported WSL backup source")
        for current, dirs, files in os.walk(source, followlinks=False):
            folder = Path(current)
            for name in dirs[:]:
                child = folder / name
                if child.is_symlink():
                    raise ValueError("linked WSL backup directory")
                if name in EXCLUDE_DIRS or name.startswith("friday-memory-backup-"):
                    dirs.remove(name)
            for name in files:
                child = folder / name
                check_file(child)
                if name.endswith(("-wal", "-shm")) and (folder / name.rsplit("-", 1)[0]).exists():
                    continue
                dest = (Path(label) / child.relative_to(source)).as_posix()
                found.append((child, dest, child.stat().st_size))
                if len(found) > MAX_ITEMS:
                    raise ValueError("WSL backup has too many files")
    return sorted(found, key=lambda entry: entry[1])


def copy_snapshot(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        raise ValueError("WSL backup destination already exists")
    if source.suffix in {".sqlite", ".db"}:
        with closing(sqlite3.connect(f"file:{source}?mode=ro", uri=True)) as live, closing(sqlite3.connect(destination)) as target:
            live.backup(target)
    else:
        before = source.stat()
        with source.open("rb") as reader, destination.open("xb") as writer:
            shutil.copyfileobj(reader, writer, length=1024 * 1024)
            writer.flush()
            os.fsync(writer.fileno())
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("WSL source changed during snapshot")
    os.chmod(destination, 0o600)
    with destination.open("rb+") as copied:
        os.fsync(copied.fileno())


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def export_snapshot(entries: list[tuple[Path, str, int]], root: Path) -> None:
    root.mkdir(mode=0o700)
    hashes = {}
    for source, relative, _ in entries:
        target = root / relative
        copy_snapshot(source, target)
        hashes[relative] = digest(target)
    manifest = {"version": 1, "files": hashes}
    with (root / "manifest.json").open("x", encoding="utf-8") as output:
        json.dump(manifest, output, sort_keys=True)
        output.flush()
        os.fsync(output.fileno())


def main() -> None:
    request = json.load(sys.stdin)
    home = Path.home()
    if home.is_symlink():
        raise ValueError("linked WSL home")
    entries = inventory(home)
    if request.get("action") == "plan":
        print(json.dumps({"count": len(entries), "bytes": sum(size for _, _, size in entries)}))
        return
    if request.get("action") != "export":
        raise ValueError("invalid WSL backup action")
    root = Path(request.get("target", ""))
    if not root.is_absolute() or not str(root).startswith("/mnt/") or root.exists() or root.is_symlink():
        raise ValueError("WSL backup target must be a new mounted path")
    export_snapshot(entries, root)
    print(json.dumps({"count": len(entries), "bytes": sum(size for _, _, size in entries)}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, sqlite3.Error, json.JSONDecodeError) as error:
        print(json.dumps({"error": type(error).__name__}))
        sys.exit(1)
