#!/usr/bin/env python3
"""Anbieter-Anmeldung ueber Hermes' eigenen Device-Code-Flow (DASH-07.04).

Bridge-Seite: start/status/cancel, an den Dashboard-Besitzer gebunden. Worker-Seite: laeuft in der Hermes-Laufzeit,
startet den Device-Code-Flow, meldet Code und Adresse und wartet, bis Hermes' eigener Poller die Anmeldung gespeichert
hat. Friday sieht und speichert dabei nie ein Token.
"""

import asyncio
import hmac
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_config_bridge import lock_config, process_start

PINNED_SOURCE = "d923a5eb487a17c0a68801bba9ef0f56c81040a8"
PROVIDERS = ("nous", "openai-codex", "xai-oauth", "minimax-oauth")
# Hermes verwirft eine Device-Code-Sitzung nach 15 Minuten; laenger wartet der Worker nie.
FLOW_SECONDS = 900
HARD_DEADLINE_SECONDS = 960
START_WAIT_SECONDS = 20
ACTIVE = ("starting", "awaiting_approval", "cancelling")
FLOW_ID = re.compile(r"[0-9a-f]{32}")
FLOW_FILES = ("owner.json", "worker.json", "state.json", "state.tmp", "cancel")


def write_state(flow_dir, status, **fields):
    state = {"status": status, "updatedAt": int(time.time()), **fields}
    temporary = flow_dir / "state.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(state, output, separators=(",", ":"))
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, flow_dir / "state.json")


def create_private(path, payload):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(payload, output)


def read_json(path, limit):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError("unsafe_oauth_state")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("unsafe_oauth_state")
    if not isinstance(value, dict):
        raise ValueError("unsafe_oauth_state")
    return value


def valid_owner(owner):
    return (type(owner) is str and 1 <= len(owner) <= 128 and
            not any(ord(char) < 32 or ord(char) == 127 for char in owner))


def public_state(flow_id, provider, state):
    shown = {key: state[key] for key in ("userCode", "verificationUrl", "expiresAt", "failureClass") if key in state}
    return {"flowId": flow_id, "provider": provider, "status": state.get("status"), **shown}


def start(home, source, request):
    if (not isinstance(request, dict) or set(request) != {"provider", "ownerId"} or
            request["provider"] not in PROVIDERS or not valid_owner(request["ownerId"])):
        raise ValueError("invalid_request")
    root = home / ".friday-provider-oauth"
    if root.is_symlink():
        raise ValueError("unsafe_oauth_state")
    root.mkdir(mode=0o700, exist_ok=True)
    os.chmod(root, 0o700)
    for old_flow in root.iterdir():
        if (FLOW_ID.fullmatch(old_flow.name) is None or old_flow.is_symlink() or not old_flow.is_dir() or
                time.time() - old_flow.stat().st_mtime < 86400):
            continue
        try:
            for filename in FLOW_FILES:
                path = old_flow / filename
                if path.exists() or path.is_symlink():
                    path.unlink()
            old_flow.rmdir()
        except OSError:
            pass
    if len(list(root.iterdir())) >= 256:
        raise ValueError("oauth_flow_limit")
    timeout_binary = shutil.which("timeout")
    if not timeout_binary:
        raise ValueError("oauth_worker_timeout_unavailable")
    flow_id = secrets.token_hex(16)
    flow_dir = root / flow_id
    flow_dir.mkdir(mode=0o700)
    create_private(flow_dir / "owner.json", {"ownerId": request["ownerId"], "provider": request["provider"]})
    write_state(flow_dir, "starting")
    sys.path.insert(0, str(source))
    from hermes_cli._launchers import runtime_command
    helper = Path(__file__).resolve()
    command = runtime_command(source, code=f"import runpy; runpy.run_path({str(helper)!r}, run_name='__main__')")
    # GNU timeout beendet die ganze Prozessgruppe, auch wenn ein Hermes-Poller im Netz haengt.
    child = subprocess.Popen([timeout_binary, "--signal=KILL", f"{HARD_DEADLINE_SECONDS + 10}s", *command],
                             stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True, text=True)
    child.stdin.write(json.dumps({"flowDir": str(flow_dir), "provider": request["provider"],
                                  "source": str(source), "home": str(home)}))
    child.stdin.close()
    create_private(flow_dir / "worker.json", {"pid": child.pid, "start": process_start(child.pid)})
    deadline = time.monotonic() + START_WAIT_SECONDS
    state = {"status": "starting"}
    while time.monotonic() < deadline:
        state = read_json(flow_dir / "state.json", 16384)
        if state.get("status") != "starting" or child.poll() is not None:
            break
        time.sleep(0.1)
    return public_state(flow_id, request["provider"], state)


def status(home, request, cancel=False):
    if (not isinstance(request, dict) or set(request) != {"flowId", "ownerId"} or type(request["flowId"]) is not str or
            FLOW_ID.fullmatch(request["flowId"]) is None or not valid_owner(request["ownerId"])):
        raise ValueError("invalid_request")
    root = home / ".friday-provider-oauth"
    flow_dir = root / request["flowId"]
    if root.is_symlink() or flow_dir.is_symlink() or not flow_dir.is_dir():
        raise ValueError("unknown_oauth_flow")
    owner = read_json(flow_dir / "owner.json", 512)
    if (owner.get("provider") not in PROVIDERS or
            not hmac.compare_digest(str(owner.get("ownerId", "")).encode("utf-8"), request["ownerId"].encode("utf-8"))):
        raise ValueError("unknown_oauth_flow")
    state_lock = lock_config(home, ".friday-provider-oauth.lock")
    try:
        state = read_json(flow_dir / "state.json", 16384)
        try:
            worker = read_json(flow_dir / "worker.json", 128)
        except ValueError:
            worker = {}
        pid, started = worker.get("pid"), worker.get("start")
        worker_alive = type(pid) is int and isinstance(started, str) and process_start(pid) == started
        if state.get("status") in ACTIVE and not worker_alive:
            write_state(flow_dir, "failed", failureClass="oauth_worker_unconfirmed")
            state = {"status": "failed", "failureClass": "oauth_worker_unconfirmed"}
        elif cancel and state.get("status") in ("starting", "awaiting_approval"):
            try:
                fd = os.open(flow_dir / "cancel", os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            except FileExistsError:
                pass
            else:
                os.close(fd)
            state = {"status": "cancelling"}
    finally:
        import fcntl
        fcntl.flock(state_lock, fcntl.LOCK_UN)
        state_lock.close()
    return public_state(request["flowId"], owner["provider"], state)


def arm_hard_deadline(seconds=HARD_DEADLINE_SECONDS):
    # Der Worker laeuft in einer eigenen Sitzung; das Beenden der Prozessgruppe stoppt auch Hermes' Poller-Threads.
    timer = threading.Timer(seconds, os.killpg, args=(os.getpgrp(), signal.SIGKILL))
    timer.daemon = True
    timer.start()
    return timer


def cancel_session(routes, session_id):
    # Wie Hermes' eigener Abbruch: Sitzung markieren und entfernen, damit der Poller nichts mehr speichert.
    with routes._oauth_sessions_lock:
        session = routes._oauth_sessions.pop(session_id, None)
        if isinstance(session, dict):
            session["cancelled"] = True


def wait_for_approval(flow_dir, routes, session_id, deadline):
    while True:
        with routes._oauth_sessions_lock:
            session = routes._oauth_sessions.get(session_id)
            current = session.get("status") if isinstance(session, dict) else "expired"
        if current == "approved":
            # Hermes setzt "approved" erst, nachdem sein Poller die Zugangsdaten selbst gespeichert hat.
            write_state(flow_dir, "configured")
            return 0
        if current in ("denied", "expired", "error", "cancelled"):
            write_state(flow_dir, "failed", failureClass="oauth_cancelled" if current == "cancelled" else f"oauth_{current}")
            return 1
        if (flow_dir / "cancel").exists():
            cancel_session(routes, session_id)
            write_state(flow_dir, "failed", failureClass="oauth_cancelled")
            return 1
        if time.monotonic() > deadline:
            cancel_session(routes, session_id)
            write_state(flow_dir, "failed", failureClass="oauth_timeout")
            return 1
        time.sleep(1)


def main():
    arm_hard_deadline()
    request = json.load(sys.stdin)
    if (not isinstance(request, dict) or set(request) != {"flowDir", "provider", "source", "home"} or
            request["provider"] not in PROVIDERS):
        return 2
    home, source, flow_dir = Path(request["home"]), Path(request["source"]), Path(request["flowDir"])
    if (source.resolve() != (home / "hermes-agent").resolve() or not flow_dir.is_dir() or flow_dir.is_symlink() or
            flow_dir.parent.resolve() != (home / ".friday-provider-oauth").resolve()):
        return 2
    head = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=3)
    if head.returncode or head.stdout.strip() != PINNED_SOURCE:
        write_state(flow_dir, "failed", failureClass="unsupported_source_revision")
        return 1
    try:
        from hermes_cli.web_routers import oauth as routes
        started = asyncio.run(asyncio.wait_for(routes._start_device_code_flow(request["provider"]), START_WAIT_SECONDS))
    except Exception:
        write_state(flow_dir, "failed", failureClass="oauth_start_failed")
        return 1
    started = started if isinstance(started, dict) else {}
    session_id, user_code = started.get("session_id"), started.get("user_code")
    url, expires_in = started.get("verification_url"), started.get("expires_in")
    if (not isinstance(session_id, str) or not isinstance(user_code, str) or not 1 <= len(user_code) <= 64 or
            not isinstance(url, str) or len(url) > 2048 or not url.startswith("https://") or
            isinstance(expires_in, bool) or not isinstance(expires_in, (int, float)) or expires_in < 1):
        if isinstance(session_id, str):
            cancel_session(routes, session_id)
        write_state(flow_dir, "failed", failureClass="oauth_start_invalid")
        return 1
    seconds = min(int(expires_in), FLOW_SECONDS)
    expires_at = datetime.fromtimestamp(time.time() + seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_state(flow_dir, "awaiting_approval", userCode=user_code, verificationUrl=url, expiresAt=expires_at)
    try:
        return wait_for_approval(flow_dir, routes, session_id, time.monotonic() + seconds)
    except Exception:
        cancel_session(routes, session_id)
        write_state(flow_dir, "failed", failureClass="oauth_error")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
