#!/usr/bin/env python3
"""Owner-only Friday bridge to the pinned Hermes Baileys pair-json protocol.

The caller authenticates in Control API. QR state is local, short-lived, and never
passed to a shell or to the Hermes dashboard. This file deliberately sends no messages.
"""
import fcntl
import json
import os
from pathlib import Path
import secrets
import select
import signal
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

HOME = Path.home() / ".hermes"
ROOT = HOME / "hermes-agent"
BRIDGE = ROOT / "scripts" / "whatsapp-bridge" / "bridge.js"
STATE_DIR = HOME / "friday-whatsapp-pairing"
STATE = STATE_DIR / "state.json"
LOCK = STATE_DIR / "lock"
TTL = 600
QR_TTL = 60
PINNED = "d923a5eb"


def atomic_write(value):
    fd, name = tempfile.mkstemp(prefix="state-", dir=STATE_DIR)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, STATE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def load():
    if STATE.is_symlink() or (STATE.exists() and not STATE.is_file()):
        raise OSError("unsafe pairing state")
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else None


def process_start(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def owned_worker(record):
    pid = record.get("pid")
    if type(pid) is not int or process_start(pid) != record.get("startTime"):
        return False
    try:
        args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        return str(Path(__file__).resolve()).encode() in args and record["id"].encode() in args
    except (OSError, KeyError):
        return False


def stop_worker(record):
    if owned_worker(record):
        if os.getpgid(record["pid"]) == record["pid"]:
            os.killpg(record["pid"], signal.SIGTERM)


def session_dir():
    legacy = HOME / "whatsapp" / "session"
    if legacy.exists() and (not legacy.is_dir() or any(legacy.iterdir())):
        return legacy
    return HOME / "platforms" / "whatsapp" / "session"


def linked_identity():
    creds = session_dir() / "creds.json"
    if not creds.is_file() or creds.is_symlink():
        return None
    try:
        data = json.loads(creds.read_text(encoding="utf-8"))
        me = data.get("me") or {}
        identifier = me.get("id") if isinstance(me, dict) else None
        return identifier if isinstance(identifier, str) and len(identifier) < 128 else None
    except (OSError, ValueError):
        return None


def public(record):
    now = time.time()
    if not record:
        return {"state": "idle", "id": None, "qr": None, "expiresAt": None,
                "linkedIdentity": linked_identity(), "connectionState": bridge_connection()}
    result = dict(record)
    result.pop("pid", None)
    result.pop("startTime", None)
    if result["state"] in ("starting", "waiting", "qr_expired") and now >= result["expiresAt"]:
        stop_worker(record)
        record.update(state="expired", qr=None)
    elif result["state"] == "waiting" and now >= result.get("qrAt", 0) + QR_TTL:
        record.update(state="qr_expired", qr=None)
    elif result["state"] in ("starting", "waiting", "qr_expired") and not owned_worker(record):
        record.update(state="error", qr=None)
    if record["state"] != result["state"]:
        atomic_write(record)
    result.update(state=record["state"], qr=record["qr"])
    if result["state"] == "connected" and not linked_identity():
        result["state"] = "unverified"
    result["linkedIdentity"] = linked_identity()
    result["connectionState"] = bridge_connection()
    return result


def bridge_connection():
    # A successful TCP response alone does not prove this profile owns the bridge.
    try:
        with urlopen("http://127.0.0.1:3000/health", timeout=1) as response:
            data = json.load(response)
        if Path(data.get("session", "")).resolve() != session_dir().resolve():
            return "unknown"
        return "connected" if data.get("status") == "connected" else "disconnected"
    except (OSError, ValueError, TypeError):
        return "unknown"


def pinned_bridge():
    if not BRIDGE.is_file():
        return False
    result = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short=8", "HEAD"],
                            capture_output=True, text=True, timeout=3, check=False)
    return result.returncode == 0 and result.stdout.strip() == PINNED


def prepare_bridge():
    sys.path.insert(0, str(ROOT))
    from hermes_constants import find_node_executable, with_hermes_node_path
    node = find_node_executable("node")
    if not node:
        import pm
        pm.ensure("node", explicit=True)
        node = find_node_executable("node")
    npm = find_node_executable("npm")
    if not npm:
        import pm
        pm.ensure("npm", explicit=True)
        npm = find_node_executable("npm")
    if not node or not npm:
        raise OSError("Hermes Node runtime unavailable")
    if not (BRIDGE.parent / "node_modules").is_dir():
        result = subprocess.run([npm, "ci", "--silent"], cwd=BRIDGE.parent,
                                env=with_hermes_node_path(), capture_output=True,
                                timeout=300, check=False)
        if result.returncode != 0:
            raise OSError("Hermes bridge dependencies unavailable")
    return node, with_hermes_node_path()


def logout():
    creds = session_dir() / "creds.json"
    if not creds.is_file() or creds.is_symlink() or not pinned_bridge():
        print(json.dumps({"error": "linked_session_unavailable"}))
        return 4
    stopped = subprocess.run(["systemctl", "--user", "stop", "hermes-gateway.service"],
                             capture_output=True, timeout=10, check=False)
    if stopped.returncode != 0:
        print(json.dumps({"error": "gateway_stop_failed"}))
        return 5
    cli = str(HOME.parent / ".local/bin/hermes")
    previous = None
    logged_out = False
    try:
        for _ in range(20):
            if bridge_connection() != "connected":
                break
            time.sleep(0.2)
        if bridge_connection() == "connected":
            print(json.dumps({"error": "bridge_still_connected"}))
            return 5
        sys.path.insert(0, str(ROOT))
        from hermes_constants import find_node_executable, with_hermes_node_path
        node = find_node_executable("node")
        previous_result = subprocess.run([cli, "config", "get", "platforms.whatsapp.enabled"],
                                         capture_output=True, text=True, timeout=10, check=False)
        if previous_result.returncode == 0 and previous_result.stdout.strip().lower() in ("true", "false"):
            previous = previous_result.stdout.strip().lower()
        config = subprocess.run([cli, "config", "set", "platforms.whatsapp.enabled", "false"],
                                capture_output=True, timeout=10, check=False)
        if config.returncode != 0:
            print(json.dumps({"error": "logout_config_apply_failed"}))
            return 5
        helper = Path(__file__).with_name("whatsapp_logout.mjs")
        result = subprocess.run([node, str(helper), str(BRIDGE), str(session_dir())],
                                capture_output=True, text=True, timeout=25, check=False,
                                env=with_hermes_node_path())
        try:
            confirmed = result.returncode == 0 and json.loads(result.stdout).get("loggedOut") is True
        except ValueError:
            confirmed = False
        if not confirmed:
            print(json.dumps({"error": "remote_logout_unconfirmed"}))
            return 5
        logged_out = True
        directory = session_dir()
        if directory.is_symlink() or directory.resolve().parent not in (
            (HOME / "whatsapp").resolve(), (HOME / "platforms" / "whatsapp").resolve()):
            raise OSError("unsafe session path")
        shutil.rmtree(directory)
        import configure_messaging_gateway as settings
        with settings.LOCK.open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            lines = settings.read_lines()
            current = settings.values(lines, settings.SPECS["whatsapp"])
            settings.write_env(lines, "whatsapp", {**current, "WHATSAPP_ENABLED": "false"})
        return 0
    finally:
        if not logged_out and previous:
            subprocess.run([cli, "config", "set", "platforms.whatsapp.enabled", previous],
                           capture_output=True, timeout=10, check=False)
        subprocess.run(["systemctl", "--user", "start", "hermes-gateway.service"],
                       capture_output=True, timeout=10, check=False)


def worker(pairing_id, mode):
    record = None
    for _ in range(20):
        record = load()
        if record and record["id"] == pairing_id:
            break
        time.sleep(0.05)
    if not record or record["id"] != pairing_id:
        return 2
    node, environment = prepare_bridge()
    proc = subprocess.Popen([node, str(BRIDGE), "--pair-only", "--pair-json", "--session", str(session_dir())],
                            cwd=BRIDGE.parent, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, env={**environment, "WHATSAPP_MODE": mode,
                            "WHATSAPP_DM_POLICY": "pairing"})
    try:
        buffer = b""
        while True:
            if time.time() >= record["expiresAt"]:
                proc.terminate()
                break
            if not select.select([proc.stdout], [], [], 1)[0]:
                if proc.poll() is not None:
                    break
                continue
            chunk = os.read(proc.stdout.fileno(), 4096)
            if not chunk:
                break
            buffer += chunk
            if len(buffer) > 16384:
                buffer = b""
            terminal = False
            while b"\n" in buffer:
                raw, buffer = buffer.split(b"\n", 1)
                try:
                    payload = json.loads(raw)
                except ValueError:
                    continue
                event = payload.get("event")
                with LOCK.open("a+") as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX)
                    record = load()
                    if not record or record["id"] != pairing_id or record["state"] == "cancelled":
                        proc.terminate()
                        return 0
                    if event == "qr" and isinstance(payload.get("qr"), str):
                        record.update(state="waiting", qr=payload["qr"][:4096], qrAt=time.time())
                    elif event == "connected":
                        record.update(state="connected", qr=None)
                    elif event == "error":
                        record.update(state="error", qr=None)
                    atomic_write(record)
                terminal = event in ("connected", "error")
                if terminal:
                    break
            if terminal:
                break
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            proc.terminate()
        with LOCK.open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            record = load()
            if record and record["id"] == pairing_id and record["state"] in ("starting", "waiting", "qr_expired"):
                record.update(state="expired" if time.time() >= record["expiresAt"] else "error", qr=None)
                atomic_write(record)
    finally:
        if proc.poll() is None:
            proc.terminate()
    return 0


def main():
    if len(sys.argv) == 4 and sys.argv[1] == "--worker":
        return worker(sys.argv[2], sys.argv[3])
    if len(sys.argv) < 2 or sys.argv[1] not in ("status", "start", "refresh", "cancel", "logout", "reconnect"):
        return 2
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)
    with LOCK.open("a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        record = load()
        action = sys.argv[1]
        if action in ("start", "refresh"):
            mode = sys.argv[2] if len(sys.argv) == 3 else ""
            if mode not in ("bot", "self-chat"):
                return 2
            if not pinned_bridge():
                print(json.dumps({"error": "pinned_bridge_or_dependencies_unavailable"}))
                return 5
            if bridge_connection() == "connected":
                print(json.dumps({"error": "gateway_already_connected"}))
                return 4
            if record:
                stop_worker(record)
            pairing_id = secrets.token_urlsafe(24)
            record = {"id": pairing_id, "state": "starting", "mode": mode, "qr": None,
                      "qrAt": None, "expiresAt": time.time() + TTL}
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker", pairing_id, mode],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, start_new_session=True)
            record.update(pid=child.pid, startTime=process_start(child.pid))
            atomic_write(record)
        elif action == "cancel" and record:
            stop_worker(record)
            record.update(state="cancelled", qr=None)
            atomic_write(record)
        elif action == "reconnect":
            if not linked_identity():
                print(json.dumps({"error": "linked_session_unavailable"}))
                return 4
            result = subprocess.run(["systemctl", "--user", "restart", "hermes-gateway.service"],
                                    capture_output=True, timeout=15, check=False)
            if result.returncode != 0:
                print(json.dumps({"error": "gateway_restart_failed"}))
                return 5
        elif action == "logout":
            if record:
                stop_worker(record)
                record.update(state="cancelled", qr=None)
                atomic_write(record)
            code = logout()
            if code:
                return code
            record = None
            if STATE.exists():
                STATE.unlink()
        print(json.dumps(public(record)))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, ImportError, subprocess.TimeoutExpired):
        print(json.dumps({"error": "pairing_unavailable"}))
        raise SystemExit(5)
