#!/usr/bin/env python3
"""Apply the reviewed Friday run-id CAS fix to the pinned Hermes sources.

Usage: patch_hermes_run_stop.py HERMES_PACKAGE_ROOT [--check|--require-patched|--rollback]
The root contains hermes_cli/kanban_db.py and plugins/kanban/dashboard/plugin_api.py.
Unknown source bytes fail closed. No live service is restarted by this tool.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import tempfile

DB_PATH = "hermes_cli/kanban_db.py"
API_PATH = "plugins/kanban/dashboard/plugin_api.py"
SOURCE_SHA = {
    DB_PATH: "5f704a0395290a4c8983f0249c6a275f6560f5ae9623d53c08086a862373bc54",
    API_PATH: "22985675c9402fcefaa84f9cc1ad2530f0d9ec9b68e3a5e6034d8c4e9b8035f5",
}
MARKER = "FRIDAY_RUN_STOP_CAS_V1"

RUN_STOP = '''# FRIDAY_RUN_STOP_CAS_V1: bind termination to the run and claim in one DB transaction.
def friday_lifecycle_matches(conn: sqlite3.Connection, task_id: str, *, expected_event_id: int,
                             expected_status: str, expected_run_id: Optional[int],
                             expected_claim_lock: Optional[str]) -> bool:
    row = conn.execute(
        "SELECT status, current_run_id, claim_lock FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None or (row["status"], row["current_run_id"], row["claim_lock"]) != (
            expected_status, expected_run_id, expected_claim_lock):
        return False
    latest = conn.execute("SELECT COALESCE(MAX(id), 0) FROM task_events WHERE task_id = ?", (task_id,)).fetchone()[0]
    return latest == expected_event_id


def friday_terminate_run(conn: sqlite3.Connection, run_id: int, *, reason: Optional[str] = None,
                         signal_fn=None) -> bool:
    """Stop only the named active run and block redispatch until explicit retry.

    The write lock remains held through termination. A concurrent retry/archive
    cannot release the task while its old worker is still running.
    """
    with write_txn(conn):
        row = conn.execute(
            "SELECT t.id AS task_id, t.claim_lock, t.worker_pid, t.worker_started_at "
            "FROM task_runs r JOIN tasks t ON t.id = r.task_id "
            "WHERE r.id = ? AND r.ended_at IS NULL AND t.current_run_id = r.id "
            "AND t.status = 'running' AND t.claim_lock IS NOT NULL",
            (int(run_id),),
        ).fetchone()
        if row is None:
            return False
        task_id, lock = row["task_id"], row["claim_lock"]
        cur = conn.execute(
            "UPDATE tasks SET status = 'blocked', block_kind = 'friday_stopped', "
            "claim_lock = NULL, claim_expires = NULL, worker_pid = NULL, worker_started_at = NULL "
            "WHERE id = ? AND status = 'running' AND current_run_id = ? AND claim_lock = ?",
            (task_id, int(run_id), lock),
        )
        if cur.rowcount != 1:
            return False
        termination = _terminate_reclaimed_worker(
            row["worker_pid"], lock, signal_fn=signal_fn, started_at=row["worker_started_at"])
        if not termination.get("terminated") and _worker_alive(row["worker_pid"], row["worker_started_at"]):
            raise RuntimeError(f"worker of run {run_id} survived termination; stop rolled back")
        _record_reclaim(
            conn, task_id, termination, error=f"friday_stop: {reason}" if reason else "friday_stop",
            payload={"friday_stop": True, "reason": reason, "prev_lock": lock},
        )
        _append_event(conn, task_id, "friday_stop_termination", termination, run_id=int(run_id))
    return True


'''

API_OLD = "if not kanban_db.reclaim_task(conn, r.task_id, reason=payload.reason):"
API_NEW = "if not kanban_db.friday_terminate_run(conn, run_id, reason=payload.reason):  # FRIDAY_RUN_STOP_CAS_V1"
API_ROUTE_ANCHOR = '@router.post("/runs/{run_id}/terminate")'
API_PROBE = '''@router.get("/friday/run-stop-capability")
def friday_run_stop_capability():
    return {"patch": "FRIDAY_RUN_STOP_CAS_V1", "lifecycle": "FRIDAY_LIFECYCLE_CAS_V1"}


'''
LIFECYCLE_API = '''class FridayLifecycleBody(BaseModel):
    expected_event_id: int
    expected_status: str
    expected_run_id: Optional[int] = None
    expected_claim_lock: Optional[str] = None


@router.post("/friday/tasks/{task_id}/cancel")
def friday_cancel_task(task_id: str, payload: FridayLifecycleBody, board: Optional[str] = Query(None)):
    with _board_conn(board) as (board, conn):
        if payload.expected_status in ("archived", "done") or not kanban_db.archive_task(
                conn, task_id, expected_event_id=payload.expected_event_id,
                expected_status=payload.expected_status, expected_run_id=payload.expected_run_id,
                expected_claim_lock=payload.expected_claim_lock):
            raise _conflict("Friday cancel precondition changed")
        task = _require_task(conn, task_id)
        return {"task": _task_dict(task, current_run_started_at=None)}


@router.post("/friday/tasks/{task_id}/retry")
def friday_retry_task(task_id: str, payload: FridayLifecycleBody, board: Optional[str] = Query(None)):
    with _board_conn(board) as (board, conn):
        if payload.expected_run_id is not None or payload.expected_claim_lock is not None:
            raise _conflict("Friday retry refuses a claimed task")
        if payload.expected_status == "archived":
            ok = _set_status_direct(conn, task_id, "ready", expected_event_id=payload.expected_event_id,
                expected_status=payload.expected_status, expected_run_id=payload.expected_run_id,
                expected_claim_lock=payload.expected_claim_lock)
        elif payload.expected_status == "blocked":
            ok = kanban_db.unblock_task(conn, task_id, expected_event_id=payload.expected_event_id,
                expected_status=payload.expected_status, expected_run_id=payload.expected_run_id,
                expected_claim_lock=payload.expected_claim_lock)
        else:
            ok = False
        if not ok:
            raise _conflict("Friday retry precondition changed or task cannot be resumed")
        task = _require_task(conn, task_id)
        return {"task": _task_dict(task, current_run_started_at=None)}


'''
ARCHIVE_SIGNATURE = 'def archive_task(conn: sqlite3.Connection, task_id: str, *, signal_fn=None) -> bool:'
ARCHIVE_SIGNATURE_PATCHED = '''def archive_task(conn: sqlite3.Connection, task_id: str, *, signal_fn=None,
                 expected_event_id: Optional[int] = None, expected_status: Optional[str] = None,
                 expected_run_id: Optional[int] = None,
                 expected_claim_lock: Optional[str] = None) -> bool:'''
ARCHIVE_CHECK = '''        if not row:
            return False
        was_running = row["status"] == "running"'''
ARCHIVE_CHECK_PATCHED = '''        if not row:
            return False
        if expected_event_id is not None and not friday_lifecycle_matches(
                conn, task_id, expected_event_id=expected_event_id, expected_status=expected_status,
                expected_run_id=expected_run_id, expected_claim_lock=expected_claim_lock):
            return False
        was_running = row["status"] == "running"'''
ARCHIVE_TERMINATION = '''        _append_event(conn, task_id, "archived", None, run_id=run_id)
    if was_running:
        termination = _terminate_reclaimed_worker(prev_pid, prev_lock, signal_fn=signal_fn, started_at=prev_started)
        with write_txn(conn):
            _append_event(conn, task_id, "archive_worker_termination", termination, run_id=run_id)
'''
ARCHIVE_TERMINATION_PATCHED = '''        _append_event(conn, task_id, "archived", None, run_id=run_id)
        if was_running and expected_event_id is not None:  # FRIDAY_LIFECYCLE_CAS_V1
            termination = _terminate_reclaimed_worker(
                prev_pid, prev_lock, signal_fn=signal_fn, started_at=prev_started)
            _append_event(conn, task_id, "archive_worker_termination", termination, run_id=run_id)
            if not termination.get("terminated") and _worker_alive(prev_pid, prev_started):
                raise RuntimeError(f"archived task {task_id} still has a live worker; archive rolled back")
    if was_running and expected_event_id is None:
        termination = _terminate_reclaimed_worker(prev_pid, prev_lock, signal_fn=signal_fn, started_at=prev_started)
        with write_txn(conn):
            _append_event(conn, task_id, "archive_worker_termination", termination, run_id=run_id)
'''
UNBLOCK_SIGNATURE = 'def unblock_task(conn: sqlite3.Connection, task_id: str) -> bool:'
UNBLOCK_SIGNATURE_PATCHED = '''def unblock_task(conn: sqlite3.Connection, task_id: str, *,
                 expected_event_id: Optional[int] = None, expected_status: Optional[str] = None,
                 expected_run_id: Optional[int] = None,
                 expected_claim_lock: Optional[str] = None) -> bool:'''
UNBLOCK_CHECK = '''    now = int(time.time())
    with write_txn(conn):
        resume_status = (
'''
UNBLOCK_CHECK_PATCHED = '''    now = int(time.time())
    with write_txn(conn):
        if expected_event_id is not None:
            if not friday_lifecycle_matches(
                    conn, task_id, expected_event_id=expected_event_id, expected_status=expected_status,
                    expected_run_id=expected_run_id, expected_claim_lock=expected_claim_lock):
                return False
            failure = conn.execute(
                "SELECT last_failure_error, block_kind FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not failure or not (failure["last_failure_error"] or failure["block_kind"] == "friday_stopped"):
                return False
        resume_status = (
'''
DIRECT_SIGNATURE = 'def _set_status_direct(conn: sqlite3.Connection, task_id: str, new_status: str) -> bool:'
DIRECT_SIGNATURE_PATCHED = '''def _set_status_direct(conn: sqlite3.Connection, task_id: str, new_status: str, *,
                       expected_event_id: Optional[int] = None, expected_status: Optional[str] = None,
                       expected_run_id: Optional[int] = None,
                       expected_claim_lock: Optional[str] = None) -> bool:'''
DIRECT_CHECK = '''        if prev is None:
            return False
        if prev["status"] == "running" and new_status == "ready":'''
DIRECT_CHECK_PATCHED = '''        if prev is None:
            return False
        if expected_event_id is not None and not kanban_db.friday_lifecycle_matches(
                conn, task_id, expected_event_id=expected_event_id, expected_status=expected_status,
                expected_run_id=expected_run_id, expected_claim_lock=expected_claim_lock):
            return False
        if prev["status"] == "running" and new_status == "ready":'''
ARCHIVE_ANCHOR = '''    _cleanup_workspace(conn, task_id)
    return True


def _delete_task_relations'''
ARCHIVE_GUARD = '''    _cleanup_workspace(conn, task_id)
    if was_running and not termination.get("terminated") and _worker_alive(prev_pid, prev_started):  # FRIDAY_RUN_STOP_CAS_V1
        raise RuntimeError(f"archived task {task_id} still has a live worker")
    return True


def _delete_task_relations'''


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def patch(path: str, source: bytes) -> bytes:
    text = source.decode("utf-8")
    if path == DB_PATH:
        anchor = "def reclaim_task(\n"
        anchors = [anchor, ARCHIVE_ANCHOR, ARCHIVE_SIGNATURE, ARCHIVE_CHECK, ARCHIVE_TERMINATION,
                   UNBLOCK_SIGNATURE, UNBLOCK_CHECK]
        if any(text.count(item) != 1 for item in anchors):
            raise ValueError("Hermes lifecycle DB anchors are not unique")
        text = text.replace(anchor, RUN_STOP + anchor, 1)
        text = text.replace(ARCHIVE_ANCHOR, ARCHIVE_GUARD, 1)
        text = text.replace(ARCHIVE_SIGNATURE, ARCHIVE_SIGNATURE_PATCHED, 1)
        text = text.replace(ARCHIVE_CHECK, ARCHIVE_CHECK_PATCHED, 1)
        text = text.replace(ARCHIVE_TERMINATION, ARCHIVE_TERMINATION_PATCHED, 1)
        text = text.replace(UNBLOCK_SIGNATURE, UNBLOCK_SIGNATURE_PATCHED, 1)
        text = text.replace(UNBLOCK_CHECK, UNBLOCK_CHECK_PATCHED, 1)
    else:
        anchors = [API_OLD, API_ROUTE_ANCHOR, DIRECT_SIGNATURE, DIRECT_CHECK]
        if any(text.count(item) != 1 for item in anchors):
            raise ValueError("Hermes lifecycle API anchors are not unique")
        text = text.replace(API_ROUTE_ANCHOR, API_PROBE + LIFECYCLE_API + API_ROUTE_ANCHOR, 1)
        text = text.replace(API_OLD, API_NEW, 1)
        text = text.replace(DIRECT_SIGNATURE, DIRECT_SIGNATURE_PATCHED, 1)
        text = text.replace(DIRECT_CHECK, DIRECT_CHECK_PATCHED, 1)
    return text.encode("utf-8")


def apply(root: Path, check: bool, require_patched: bool = False, rollback: bool = False) -> None:
    paths = {name: root / name for name in SOURCE_SHA}
    originals = {name: path.read_bytes() for name, path in paths.items()}
    states = {}
    for name, content in originals.items():
        if sha(content) == SOURCE_SHA[name]:
            states[name] = "original"
        elif MARKER.encode() in content:
            backup = paths[name].with_suffix(paths[name].suffix + ".friday-original")
            if not backup.exists() or sha(backup.read_bytes()) != SOURCE_SHA[name] or content != patch(name, backup.read_bytes()):
                raise ValueError(f"{name}: patched bytes do not match the pinned source and Friday patch")
            states[name] = "patched"
        else:
            raise ValueError(f"{name}: unknown Hermes source SHA-256 {sha(content)}")
    if len(set(states.values())) != 1:
        raise ValueError("Hermes patch is only partly present; restore both .friday-original backups")
    if rollback:
        if states[DB_PATH] != "patched":
            raise ValueError("Hermes run-stop CAS patch is not installed")
        staged: dict[str, Path] = {}
        try:
            for name, path in paths.items():
                backup = path.with_suffix(path.suffix + ".friday-original")
                with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".friday-run-stop-rollback-", delete=False) as temp:
                    temp.write(backup.read_bytes())
                    staged[name] = Path(temp.name)
            for name, path in paths.items():
                os.replace(staged[name], path)
            for path in paths.values():
                path.with_suffix(path.suffix + ".friday-original").unlink()
            print("Hermes run-stop CAS patch rolled back; restart and verify services separately")
        finally:
            for temp in staged.values():
                temp.unlink(missing_ok=True)
        return
    if states[DB_PATH] == "patched":
        print("Hermes run-stop CAS patch already present and verified")
        return
    if require_patched:
        raise ValueError("Hermes run-stop CAS patch is missing")
    if check:
        print("Hermes source check PASS: pinned unpatched source")
        return
    modified = {name: patch(name, original) for name, original in originals.items()}
    staged: dict[str, Path] = {}
    try:
        for name, path in paths.items():
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".friday-run-stop-", delete=False) as temp:
                temp.write(modified[name])
                staged[name] = Path(temp.name)
        # Both files are prepared before either is replaced. Backups preserve rollback bytes.
        for name, path in paths.items():
            backup = path.with_suffix(path.suffix + ".friday-original")
            if backup.exists():
                raise ValueError(f"{backup}: existing backup; refuse overwrite")
            backup.write_bytes(originals[name])
        for name, path in paths.items():
            os.replace(staged[name], path)
        print("Hermes run-stop CAS patch applied; restart and verify services separately")
    finally:
        for temp in staged.values():
            temp.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    option = parser.add_mutually_exclusive_group()
    option.add_argument("--check", action="store_true")
    option.add_argument("--require-patched", action="store_true")
    option.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    apply(args.root, args.check, args.require_patched, args.rollback)
