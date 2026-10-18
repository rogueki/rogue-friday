"""Conservative Hermes gateway-state reader for the Friday-owned default profile."""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess


def platform_state(home: Path, platform: str):
    path = home / "gateway_state.json"
    if path.is_symlink() or not path.is_file():
        return "unknown"
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        updated = datetime.fromisoformat(record["updated_at"].replace("Z", "+00:00"))
        if updated.tzinfo is None or abs((datetime.now(timezone.utc) - updated).total_seconds()) > 120:
            return "unknown"
        pid, start = record["pid"], record["start_time"]
        if type(pid) is not int or type(start) is not int or pid <= 0:
            return "unknown"
        service = subprocess.run(["systemctl", "--user", "show", "hermes-gateway.service",
                                  "--property", "MainPID", "--value"], capture_output=True, text=True,
                                 timeout=3, check=False)
        if service.returncode != 0 or service.stdout.strip() != str(pid):
            return "unknown"
        proc_start = int(Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()[19])
        if proc_start != start or Path(record.get("hermes_home", "")).resolve() != home.resolve():
            return "unknown"
        states = record.get("platforms")
        candidate = states.get(platform) if isinstance(states, dict) else None
        if not isinstance(candidate, dict) or candidate.get("writer_pid") != pid or candidate.get("writer_start_time") != start:
            return "unknown"
        state = candidate.get("state")
        if state == "connected":
            return "connected"
        if state in ("disconnected", "fatal", "disabled", "retrying", "connecting", "error"):
            return "disconnected"
        return "unknown"
    except (OSError, ValueError, KeyError, TypeError, IndexError, subprocess.TimeoutExpired):
        return "unknown"
