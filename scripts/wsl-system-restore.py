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
import tempfile


ROOTS = {"hermes", "friday-mail", "friday-calendar", "himalaya"}
EXCLUDED = ["cache", "hermes-agent", "installs", "tools"]
REAPPLY_MARKER = "hermes/friday-messenger-bridge-applied.sha256"
RECEIPT_NAME = ".friday-recovery-receipt.json"
PRIOR_PREFIX = ".friday-recovery-prior-"
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


def private_copy(source: Path, target: Path) -> None:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(descriptor, "wb") as writer, source.open("rb") as reader:
            shutil.copyfileobj(reader, writer, length=1024 * 1024)
            writer.flush()
            os.fsync(writer.fileno())
    except Exception:
        target.unlink(missing_ok=True)
        raise
    if digest(target) != digest(source):
        target.unlink()
        raise ValueError("WSL restore copy changed")


def sync_directory(path: Path) -> None:
    if os.name != "posix":
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_receipt(receipt: Path, payload: dict[str, object], exclusive: bool = False) -> None:
    if exclusive:
        descriptor = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        sync_directory(receipt.parent)
    else:
        temporary = receipt.with_name(receipt.name + ".tmp")
        with temporary.open("x", encoding="utf-8") as output:
            os.chmod(temporary, 0o600)
            json.dump(payload, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, receipt)
        sync_directory(receipt.parent)


def import_snapshot(source: Path, home: Path, allow_existing: bool = False) -> dict[str, object]:
    files, databases, revision = inventory(source)
    no_linked_ancestor(home)
    if not home.is_dir():
        raise ValueError("target WSL home is unavailable")
    pinned_checkout(home, revision)
    receipt = home / RECEIPT_NAME
    if receipt.exists() or receipt.is_symlink():
        raise ValueError("target WSL profile already has a recovery receipt")
    applied_marker = destination(home, REAPPLY_MARKER)
    if applied_marker.exists() or applied_marker.is_symlink():
        ordinary(applied_marker)
    # This digest only says a former gateway process observed a bridge config.
    # A recovered gateway must apply and acknowledge the restored config again.
    targets = [(name, source / name, destination(home, name)) for name in sorted(files) if name != REAPPLY_MARKER]
    created_dirs: list[Path] = []
    previous: dict[str, str | None] = {}
    sidecars: dict[str, str] = {}
    for name, _, target in targets:
        if target.exists() or target.is_symlink():
            if not allow_existing:
                raise ValueError("target WSL state already exists; fresh-install proof required")
            ordinary(target)
            previous[name] = digest(target)
            with target.open("rb") as stream:
                sqlite_file = stream.read(16) == SQLITE_HEADER
            if sqlite_file:
                for suffix in ("-wal", "-shm"):
                    sidecar = Path(f"{target}{suffix}")
                    if sidecar.exists() or sidecar.is_symlink():
                        ordinary(sidecar)
                        if suffix == "-wal" and sidecar.stat().st_size:
                            raise ValueError("target WSL SQLite must be stopped and checkpointed")
                        sidecars[name + suffix] = digest(sidecar)
        else:
            previous[name] = None
        parent = target.parent
        while parent != home:
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise ValueError("target WSL state has an unsafe parent")
            if not parent.exists() and parent not in created_dirs:
                created_dirs.append(parent)
            parent = parent.parent
    prior_dir = Path(tempfile.mkdtemp(prefix=PRIOR_PREFIX, dir=home))
    prior_dir.chmod(0o700)
    try:
        for name, _, target in targets:
            if previous[name] is not None:
                prior = prior_dir / hashlib.sha256(name.encode("utf-8")).hexdigest()
                private_copy(target, prior)
                if digest(prior) != previous[name]:
                    raise ValueError("target WSL state changed during baseline snapshot")
        for name, expected in sidecars.items():
            sidecar = Path(f"{destination(home, name[:-4])}{name[-4:]}")
            prior = prior_dir / hashlib.sha256(name.encode("utf-8")).hexdigest()
            private_copy(sidecar, prior)
            if digest(prior) != expected:
                raise ValueError("target WSL SQLite sidecar changed during baseline snapshot")
        sync_directory(prior_dir)
        payload = {"version": 2, "state": "applying", "manifestSha256": digest(source / "manifest.json"),
                   "files": {name: files[name] for name, _, _ in targets}, "previous": previous,
                   "sidecars": sidecars, "priorDir": prior_dir.name,
                   "createdDirs": [folder.relative_to(home).as_posix() for folder in created_dirs]}
        write_receipt(receipt, payload, exclusive=True)
        applied_marker.unlink(missing_ok=True)
        for name in sidecars:
            Path(f"{destination(home, name[:-4])}{name[-4:]}").unlink()
        for folder in sorted(created_dirs, key=lambda item: len(item.parts)):
            folder.mkdir(mode=0o700)
        for name, origin, target in targets:
            temporary = target.with_name(target.name + ".friday-recovery-new")
            if temporary.exists() or temporary.is_symlink():
                raise ValueError("target WSL recovery temporary path already exists")
            private_copy(origin, temporary)
            os.replace(temporary, target)
            target.chmod(0o600)
            if digest(target) != files[name]:
                raise ValueError("WSL restore copy changed")
            sync_directory(target.parent)
        payload["state"] = "imported"
        write_receipt(receipt, payload)
        return {"fileCount": len(targets), "databaseCount": len(databases), "hermesRevision": revision,
                "state": "imported; services must be reprovisioned and health-checked"}
    except Exception:
        if receipt.exists():
            rollback_snapshot(source, home)
        else:
            for item in prior_dir.iterdir():
                item.unlink()
            prior_dir.rmdir()
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
    previous = payload.get("previous")
    sidecars = payload.get("sidecars")
    prior_name = payload.get("priorDir")
    if (payload.get("version") != 2 or payload.get("state") not in ("applying", "imported") or
            payload.get("manifestSha256") != digest(source / "manifest.json") or
            payload.get("files") != expected or not isinstance(previous, dict) or not isinstance(sidecars, dict) or
            set(previous) != set(expected) or not isinstance(prior_name, str) or
            not prior_name.startswith(PRIOR_PREFIX) or "/" in prior_name or "\\" in prior_name or
            not isinstance(created_dirs, list) or
            len(created_dirs) != len(set(created_dirs)) or any(name not in allowed_dirs for name in created_dirs)):
        raise ValueError("WSL recovery receipt does not match the source")
    prior_dir = home / prior_name
    if prior_dir.is_symlink() or not prior_dir.is_dir():
        raise ValueError("WSL recovery baseline is unavailable")
    prior_names = {hashlib.sha256(name.encode("utf-8")).hexdigest()
                   for name, value in previous.items() if value is not None}
    for name, checksum in sidecars.items():
        if (not isinstance(name, str) or name[:-4] not in expected or name[-4:] not in ("-wal", "-shm") or
                not isinstance(checksum, str) or len(checksum) != 64):
            raise ValueError("WSL recovery sidecar receipt is invalid")
        prior_names.add(hashlib.sha256(name.encode("utf-8")).hexdigest())
    if {item.name for item in prior_dir.iterdir()} != prior_names:
        raise ValueError("WSL recovery baseline inventory changed")
    targets = [(name, destination(home, name)) for name in sorted(expected)]
    for name, target in targets:
        temporary_new = target.with_name(target.name + ".friday-recovery-new")
        if temporary_new.exists() or temporary_new.is_symlink():
            ordinary(temporary_new)
            if payload["state"] != "applying":
                raise ValueError("WSL recovery temporary file appeared after import")
        if target.exists() or target.is_symlink():
            ordinary(target)
            if digest(target) not in (expected[name], previous[name]):
                raise ValueError("imported WSL state changed; rollback refused")
        elif payload["state"] == "imported":
            raise ValueError("imported WSL state changed; rollback refused")
        if previous[name] is not None:
            prior = prior_dir / hashlib.sha256(name.encode("utf-8")).hexdigest()
            ordinary(prior)
            if digest(prior) != previous[name]:
                raise ValueError("WSL recovery baseline changed")
        parent = target.parent
        while parent != home:
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise ValueError("imported WSL state has an unsafe parent")
            parent = parent.parent
    for name, checksum in sidecars.items():
        prior = prior_dir / hashlib.sha256(name.encode("utf-8")).hexdigest()
        ordinary(prior)
        if digest(prior) != checksum:
            raise ValueError("WSL recovery SQLite sidecar baseline changed")
        sidecar = Path(f"{destination(home, name[:-4])}{name[-4:]}")
        if sidecar.exists() or sidecar.is_symlink():
            ordinary(sidecar)
            if digest(sidecar) != checksum:
                raise ValueError("recovered WSL SQLite sidecar changed; rollback refused")
    for name, target in targets:
        target.with_name(target.name + ".friday-recovery-new").unlink(missing_ok=True)
        if previous[name] is None:
            target.unlink(missing_ok=True)
        else:
            prior = prior_dir / hashlib.sha256(name.encode("utf-8")).hexdigest()
            if not target.exists() or digest(target) != previous[name]:
                temporary = target.with_name(target.name + ".friday-recovery-rollback")
                if temporary.exists() or temporary.is_symlink():
                    raise ValueError("WSL recovery rollback temporary path already exists")
                private_copy(prior, temporary)
                os.replace(temporary, target)
                target.chmod(0o600)
    for name, checksum in sidecars.items():
        sidecar = Path(f"{destination(home, name[:-4])}{name[-4:]}")
        if not sidecar.exists():
            prior = prior_dir / hashlib.sha256(name.encode("utf-8")).hexdigest()
            private_copy(prior, sidecar)
            if digest(sidecar) != checksum:
                raise ValueError("WSL recovery SQLite sidecar restore changed")
    receipt.unlink()
    sync_directory(home)
    for item in prior_dir.iterdir():
        item.unlink()
    prior_dir.rmdir()
    for parent in sorted((home / name for name in created_dirs), key=lambda path: len(path.parts), reverse=True):
        try:
            parent.rmdir()
        except OSError:
            pass  # A pre-existing directory or the pinned checkout remains.
    return {"restoredFileCount": len(targets), "state": "rolled back"}


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
        print(json.dumps(import_snapshot(source, home, request.get("allowExisting") is True)))
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
