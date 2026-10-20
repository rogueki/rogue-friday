#!/usr/bin/env python3
"""Read bounded native Hermes cron metadata from the pinned profile store."""

import json
import hashlib
import subprocess
import sys
from pathlib import Path


PIN = "d923a5eb487a17c0a68801bba9ef0f56c81040a8"
LIMIT = 200


def pinned(source: Path) -> bool:
    if not source.is_dir():
        return False
    result = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"],
                            capture_output=True, text=True, timeout=3)
    return result.returncode == 0 and result.stdout.strip() == PIN


def project(job: dict) -> dict:
    # Prompts, output, origins, delivery routes and tool arguments stay inside Hermes.
    return {
        "id": str(job.get("id", ""))[:100],
        "name": str(job.get("name", ""))[:160],
        "schedule": str(job.get("schedule_display", ""))[:200],
        "timezone": (job.get("schedule") or {}).get("tz") if isinstance(job.get("schedule"), dict)
                    and isinstance((job.get("schedule") or {}).get("tz"), str) else None,
        "enabled": job.get("enabled") is True,
        "state": str(job.get("state", "unknown"))[:40],
        "nextRunAt": job.get("next_run_at") if isinstance(job.get("next_run_at"), str) else None,
        "lastRunAt": job.get("last_run_at") if isinstance(job.get("last_run_at"), str) else None,
    }


def read_jobs(source: Path) -> dict:
    if not pinned(source):
        raise ValueError("unsupported_source_revision")
    # Hermes load_jobs() can repair and rewrite malformed jobs.json during a read.
    # A status endpoint must not mutate the profile, so parse its canonical store directly.
    sys.path.insert(0, str(source))
    from hermes_constants import get_hermes_home  # Native profile resolution; stdlib-only import.
    from hermes_time import get_timezone, get_timezone_name
    home = get_hermes_home()
    base = Path.home() / ".hermes"
    if home == base:
        profile = "default"
    elif home.parent == base / "profiles" and home.name.isidentifier():
        profile = home.name
    else:
        profile = "custom"
    timezone = get_timezone_name() if get_timezone() is not None else None
    store = home / "cron" / "jobs.json"
    if store.exists() and store.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("invalid_native_result")
    raw = store.read_bytes() if store.exists() else b'{"jobs":[]}'
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("invalid_native_result")
    data = json.loads(raw.decode("utf-8-sig"))
    jobs = data.get("jobs") if isinstance(data, dict) else None
    if not isinstance(jobs, list):
        raise ValueError("invalid_native_result")
    if not all(isinstance(job, dict) for job in jobs):
        raise ValueError("invalid_native_result")
    return {"sourceRevision": PIN, "profile": profile, "profileTimezone": timezone,
            "jobs": [project(job) for job in jobs[:LIMIT]],
            "count": len(jobs), "truncated": len(jobs) > LIMIT,
            "storeRevision": hashlib.sha256(raw).hexdigest(), "schedulerRunning": None}


def main() -> int:
    if sys.argv[1:] != ["list"]:
        return 2
    source = Path.home() / ".hermes" / "hermes-agent"
    try:
        print(json.dumps(read_jobs(source)))
        return 0
    except (OSError, ValueError, ImportError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error) if str(error) in
                          {"unsupported_source_revision", "invalid_native_result"} else "hermes_unavailable"}))
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
