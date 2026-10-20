#!/usr/bin/env python3
"""Pinned native Hermes cron mutations with profile, timezone and store CAS."""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from patch_hermes_cron_lock import apply as check_patch


PIN = "d923a5eb487a17c0a68801bba9ef0f56c81040a8"
MAX_STORE_BYTES = 4 * 1024 * 1024
JOB_ID = re.compile(r"^[a-f0-9]{12}$")
ACTIONS = {
    "create": frozenset(("action", "expectedStoreRevision", "profile", "profileTimezone", "name", "schedule", "prompt")),
    "update": frozenset(("action", "expectedStoreRevision", "profile", "profileTimezone", "jobId", "name", "schedule", "prompt")),
    "pause": frozenset(("action", "expectedStoreRevision", "profile", "profileTimezone", "jobId")),
    "resume": frozenset(("action", "expectedStoreRevision", "profile", "profileTimezone", "jobId")),
    "run": frozenset(("action", "expectedStoreRevision", "profile", "profileTimezone", "jobId")),
    "remove": frozenset(("action", "expectedStoreRevision", "profile", "profileTimezone", "jobId")),
}


def source_ready(source: Path) -> bool:
    if not source.is_dir():
        return False
    result = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"],
                            capture_output=True, text=True, timeout=3)
    if result.returncode or result.stdout.strip() != PIN:
        return False
    check_patch(source, require_patched=True)
    return True


def read_store(path: Path) -> tuple[str, list[dict]]:
    if path.exists():
        with path.open("rb") as file:
            raw = file.read(MAX_STORE_BYTES + 1)
    else:
        raw = b'{"jobs":[]}'
    if len(raw) > MAX_STORE_BYTES:
        raise ValueError("invalid_native_store")
    data = json.loads(raw.decode("utf-8-sig"))
    jobs = data.get("jobs") if isinstance(data, dict) else None
    if not isinstance(jobs, list) or not all(isinstance(row, dict) for row in jobs):
        raise ValueError("invalid_native_store")
    return hashlib.sha256(raw).hexdigest(), jobs


def validate(request: object) -> dict:
    if not isinstance(request, dict) or request.get("action") not in ACTIONS:
        raise ValueError("invalid_request")
    action = request["action"]
    if set(request) != ACTIONS[action]:
        raise ValueError("invalid_request")
    if not isinstance(request["expectedStoreRevision"], str) or not re.fullmatch(r"[a-f0-9]{64}", request["expectedStoreRevision"]):
        raise ValueError("invalid_request")
    if not isinstance(request["profile"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", request["profile"]):
        raise ValueError("invalid_request")
    if request["profile"] == "custom":
        raise ValueError("unsupported_profile")
    if request["profileTimezone"] is not None and (not isinstance(request["profileTimezone"], str)
                                                   or len(request["profileTimezone"]) > 100):
        raise ValueError("invalid_request")
    if "jobId" in request and (not isinstance(request["jobId"], str) or not JOB_ID.fullmatch(request["jobId"])):
        raise ValueError("invalid_request")
    for field, limit in (("name", 160), ("schedule", 200), ("prompt", 4000)):
        if field in request and (not isinstance(request[field], str) or not request[field].strip()
                                 or len(request[field]) > limit or "\x00" in request[field]):
            raise ValueError("invalid_request")
    return request


def mutate(source: Path, request: object) -> dict:
    request = validate(request)
    if not source_ready(source):
        raise ValueError("unsupported_source_revision")
    sys.path.insert(0, str(source))
    from hermes_constants import get_hermes_home
    from hermes_time import get_timezone, get_timezone_name
    from cron import jobs as native

    home = get_hermes_home()
    base = Path.home() / ".hermes"
    profile = "default" if home == base else home.name if home.parent == base / "profiles" else "custom"
    if profile == "custom" or profile != request["profile"]:
        raise ValueError("profile_conflict")
    timezone = get_timezone_name() if get_timezone() is not None else None
    if timezone != request["profileTimezone"]:
        raise ValueError("timezone_conflict")
    store = home / "cron" / "jobs.json"
    with native.friday_strict_jobs_lock():
        before, rows = read_store(store)
        if before != request["expectedStoreRevision"]:
            raise ValueError("store_revision_conflict")
        action = request["action"]
        job_id = request.get("jobId")
        if job_id is not None and not any(row.get("id") == job_id for row in rows):
            raise ValueError("job_not_found")
        if action == "create":
            result = native.create_job(request["prompt"], request["schedule"], name=request["name"],
                                       deliver="local", origin=None, paused=True)
            job_id = result["id"]
        elif action == "update":
            result = native.update_job(job_id, {key: request[key] for key in ("name", "schedule", "prompt")})
        elif action == "pause":
            result = native.pause_job(job_id, reason="Paused by Friday owner")
        elif action == "resume":
            result = native.resume_job(job_id)
        elif action == "run":
            result = native.trigger_job(job_id)
        else:
            result = native.remove_job(job_id)
        if not result:
            raise ValueError("native_mutation_failed")
        after, updated_rows = read_store(store)
        current = next((row for row in updated_rows if row.get("id") == job_id), None)
        if action == "remove" and current is not None:
            raise ValueError("native_postcondition_failed")
        if action != "remove" and current is None:
            raise ValueError("native_postcondition_failed")
        if action == "pause" and (current.get("enabled") is not False or current.get("state") != "paused"):
            raise ValueError("native_postcondition_failed")
        if action == "resume" and current.get("enabled") is not True:
            raise ValueError("native_postcondition_failed")
        if action == "create" and (current.get("enabled") is not False or current.get("state") != "paused"):
            raise ValueError("native_postcondition_failed")
        if action == "run" and (current.get("enabled") is not True or current.get("manual_run_at") is None):
            raise ValueError("native_postcondition_failed")
        if action == "update" and any(current.get(key) != request[key] for key in ("name", "prompt")):
            raise ValueError("native_postcondition_failed")
        return {"action": action, "jobId": job_id, "profile": profile,
                "profileTimezone": timezone, "storeRevision": after,
                "state": current.get("state") if current is not None else "removed",
                "accepted": True, "executionVerified": False}


def main() -> int:
    if sys.argv[1:] != ["mutate"]:
        return 2
    source = Path.home() / ".hermes" / "hermes-agent"
    try:
        request = json.load(sys.stdin)
        print(json.dumps(mutate(source, request)))
        return 0
    except ValueError as exc:
        known = {"invalid_request", "unsupported_profile", "unsupported_source_revision", "profile_conflict",
                 "timezone_conflict", "store_revision_conflict", "job_not_found", "invalid_native_store"}
        print(json.dumps({"error": str(exc) if str(exc) in known else "cron_mutation_not_confirmed"}))
        return 5
    except (OSError, ImportError, RuntimeError, subprocess.TimeoutExpired):
        print(json.dumps({"error": "cron_mutation_not_confirmed"}))
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
