#!/usr/bin/env python3
"""Add a fail-closed cron store lock to the pinned Hermes source."""

import argparse
import hashlib
import os
from pathlib import Path
import tempfile


RELATIVE = "cron/jobs.py"
ORIGINAL_SHA = "76ec76f0c3854c4ab23deb8a883633756dd8e3ca9223013af3edf658d2d41862"
MARKER = "FRIDAY_STRICT_CRON_LOCK_V1"
ANCHOR = "@contextlib.contextmanager\ndef _fire_job_lock(job_id: str):"
TIMEOUT_OLD = '''                if _acquire_flock(lock_fd, _JOBS_LOCK_TIMEOUT_SECONDS) is False:
                    logger.error(
                        "Timed out after %.0fs waiting for the cron "
                        "jobs lock (%s) — another process is holding "
                        "it. Proceeding with in-process locking only "
                        "so the scheduler stays alive (#60703).",
                        _JOBS_LOCK_TIMEOUT_SECONDS, _jobs_lock_file())
                    with contextlib.suppress(OSError):
                        lock_fd.close()
                    lock_fd = None
'''
TIMEOUT_NEW = '''                if _acquire_flock(lock_fd, _JOBS_LOCK_TIMEOUT_SECONDS) is not True:  # FRIDAY_STRICT_CRON_LOCK_V1
                    lock_fd.close()
                    lock_fd = None
                    raise RuntimeError("cron cross-process lock unavailable")
'''
OS_OLD = '''            except OSError as e:
                # A locking failure must never take down cron writes — in-process lock still held.
                logger.warning("jobs.json cross-process lock unavailable (%s); "
                               "proceeding with in-process lock only", e)
'''
OS_NEW = '''            except OSError as e:
                if lock_fd is not None:
                    lock_fd.close()
                    lock_fd = None
                raise RuntimeError("cron cross-process lock unavailable") from e
'''
ADDITION = '''# FRIDAY_STRICT_CRON_LOCK_V1: Friday mutations may never use Hermes' degraded lock.
@contextlib.contextmanager
def friday_strict_jobs_lock():
    """Hold the native store lock across Friday's compare-and-mutate operation.

    Native scheduler writers retain their normal policy. Friday's mutation aborts
    when cross-process locking is absent or not acquired within two seconds.
    """
    if getattr(_jobs_lock_state, "depth", 0):
        raise RuntimeError("friday cron lock cannot be nested")
    with _jobs_file_lock:
        ensure_dirs()
        lock_fd = open(_jobs_lock_file(), "a+", encoding="utf-8-sig")
        try:
            lock_fd.seek(0)
            if _acquire_flock(lock_fd, 2.0) is not True:
                raise RuntimeError("friday cron cross-process lock unavailable")
            _jobs_lock_state.depth = 1
            _jobs_lock_state.load_stamp = None
            try:
                yield
            finally:
                _jobs_lock_state.depth = 0
                _jobs_lock_state.load_stamp = None
        finally:
            _release_flock(lock_fd)


'''


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def patched(source: bytes) -> bytes:
    text = source.decode("utf-8")
    if any(text.count(anchor) != 1 for anchor in (ANCHOR, TIMEOUT_OLD, OS_OLD)) or MARKER in text:
        raise ValueError("pinned cron lock anchor mismatch")
    text = text.replace(ANCHOR, ADDITION + ANCHOR, 1)
    text = text.replace(TIMEOUT_OLD, TIMEOUT_NEW, 1)
    text = text.replace(OS_OLD, OS_NEW, 1)
    return text.encode("utf-8")


def apply(root: Path, *, check: bool = False, require_patched: bool = False,
          rollback: bool = False) -> str:
    target = root / RELATIVE
    backup = target.with_suffix(target.suffix + ".friday-cron-original")
    current = target.read_bytes()
    if digest(current) == ORIGINAL_SHA:
        state = "original"
    elif backup.is_file() and digest(backup.read_bytes()) == ORIGINAL_SHA and current == patched(backup.read_bytes()):
        state = "patched"
    else:
        raise ValueError("unknown Hermes cron source or patch bytes")
    if rollback:
        if state != "patched":
            raise ValueError("cron lock patch is not installed")
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".friday-cron-rollback-", delete=False) as temp:
            staged = Path(temp.name)
            temp.write(backup.read_bytes())
        try:
            os.replace(staged, target)
            backup.unlink()
        finally:
            staged.unlink(missing_ok=True)
        return "rolled_back"
    if state == "patched":
        return "patched"
    if require_patched:
        raise ValueError("cron lock patch is missing")
    if check:
        return "original"
    if backup.exists():
        raise ValueError("cron lock backup already exists")
    modified = patched(current)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".friday-cron-", delete=False) as temp:
        staged = Path(temp.name)
        temp.write(modified)
    try:
        backup.write_bytes(current)
        os.replace(staged, target)
    finally:
        staged.unlink(missing_ok=True)
    return "patched"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    options = parser.add_mutually_exclusive_group()
    options.add_argument("--check", action="store_true")
    options.add_argument("--require-patched", action="store_true")
    options.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    print(apply(args.root, check=args.check, require_patched=args.require_patched, rollback=args.rollback))
