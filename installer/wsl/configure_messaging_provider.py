#!/usr/bin/env python3
"""Owner-scoped, pinned Hermes provider fields; credentials only on stdin."""
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from urllib.parse import urlparse

from messaging_runtime import platform_state

ROOT = Path.home() / ".hermes" / "hermes-agent"
HOME = ROOT.parent
LOCK = HOME / ".friday-config.lock"
KEY = HOME / "friday-messenger-revision.key"
PINNED = "d923a5eb"
SPECS = Path(__file__).with_name("messaging_provider_fields.json")


def source_ok(runner=subprocess.run):
    result = runner(["git", "-C", str(ROOT), "rev-parse", "--short=8", "HEAD"],
                    capture_output=True, text=True, timeout=3, check=False)
    return result.returncode == 0 and result.stdout.strip() == PINNED


def specs():
    data = json.loads(SPECS.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or len(data) != 21:
        raise ValueError("invalid source inventory")
    return data


def lock_profile():
    HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    os.fchmod(fd, 0o600)
    deadline = time.monotonic() + 5
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(fd)
                raise TimeoutError("profile config busy")
            time.sleep(0.025)


def revision(platform):
    try:
        fd = os.open(KEY, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, "wb") as output:
            output.write(secrets.token_bytes(32))
    if KEY.is_symlink() or KEY.stat().st_mode & 0o077:
        raise OSError("unsafe revision key")
    key = KEY.read_bytes()
    if len(key) != 32:
        raise OSError("invalid revision key")
    digest = hmac.new(key, platform.encode(), hashlib.sha256)
    for name in (".env", "config.yaml", "gateway.json"):
        path = HOME / name
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise OSError("unsafe Hermes config path")
        digest.update(name.encode())
        if path.is_file():
            digest.update(path.read_bytes())
    return digest.hexdigest()


def validate_values(platform, values, registry):
    if not isinstance(values, dict) or not 1 <= len(values) <= 10 or not set(values) <= set(registry[platform]):
        raise ValueError("unknown provider field")
    clean = {}
    for field, value in values.items():
        if value is None:
            clean[field] = None
            continue
        limit = 32768 if field == "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON" else 4096
        if not isinstance(value, str) or not value or len(value) > limit:
            raise ValueError("invalid provider field value")
        if field == "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON":
            data = json.loads(value)
            if not isinstance(data, dict) or data.get("type") != "service_account":
                raise ValueError("invalid service account")
            value = json.dumps(data, separators=(",", ":"))
        if any(ord(char) < 32 for char in value):
            raise ValueError("invalid provider field value")
        if field.endswith("_URL") or field in {"MATRIX_HOMESERVER", "MATTERMOST_URL"}:
            parsed = urlparse(value)
            if parsed.scheme not in ("https", "http", "wss", "ws") or not parsed.netloc or parsed.username or parsed.password:
                raise ValueError("invalid provider URL")
        elif field.endswith("_PORT"):
            if not value.isdecimal() or not 1 <= int(value) <= 65535:
                raise ValueError("invalid port")
        elif field.endswith(("_ENABLED", "_USE_TLS", "_AUTO_ACCEPT", "_GROUP_ALLOWED", "_MARKDOWN", "_REQUIRE_MENTION")):
            if value.lower() not in ("true", "false"):
                raise ValueError("invalid boolean")
            value = value.lower()
        elif not re.fullmatch(r"[\x20-\x7e]+", value):
            raise ValueError("invalid provider text")
        clean[field] = value
    return clean


def operation(platform, action, request=None, runner=subprocess.run):
    registry = specs()
    if platform not in registry or action not in ("status", "update", "apply"):
        return {"state": "rejected", "reason": "invalid_request"}
    if not source_ok(runner):
        return {"state": "unavailable", "reason": "hermes_version_changed"}
    fd = lock_profile()
    try:
        current = revision(platform)
        if action == "status":
            return {"state": "available", "platform": platform, "revision": current}
        expected = {"revision"} if action == "apply" else {"revision", "values"}
        if not isinstance(request, dict) or set(request) != expected or request["revision"] != current:
            return {"state": "conflict", "platform": platform, "revision": current}
        if action == "apply":
            try:
                restart = runner(["systemctl", "--user", "restart", "hermes-gateway.service"],
                                 capture_output=True, text=True, timeout=12, check=False)
                if restart.returncode != 0:
                    return {"state": "uncertain", "platform": platform, "revision": revision(platform),
                            "gatewayRestarted": False, "connectionState": "unknown"}
                active = runner(["systemctl", "--user", "is-active", "hermes-gateway.service"],
                                capture_output=True, text=True, timeout=3, check=False)
            except (OSError, subprocess.TimeoutExpired):
                return {"state": "uncertain", "platform": platform, "revision": revision(platform),
                        "gatewayRestarted": False, "connectionState": "unknown"}
            running = active.returncode == 0 and active.stdout.strip() == "active"
            return {"state": "applied" if running else "uncertain", "platform": platform,
                    "revision": revision(platform), "gatewayRestarted": running,
                    "connectionState": platform_state(HOME, platform) if running else "unknown"}
        values = validate_values(platform, request["values"], registry)
        sys.path.insert(0, str(ROOT))
        from hermes_cli._launchers import runtime_command
        path = Path(__file__).with_name("messaging_provider_apply_probe.py")
        command = runtime_command(ROOT, code=f"import runpy; runpy.run_path({str(path)!r}, run_name='__main__')")
        try:
            result = runner(command, input=json.dumps({"values": values}), capture_output=True,
                            text=True, timeout=20, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return {"state": "uncertain", "platform": platform, "revision": revision(platform)}
        try:
            applied = json.loads(result.stdout)
        except ValueError:
            applied = {}
        state = applied.get("state") if result.returncode == 0 else "uncertain"
        if state != "saved":
            return {"state": state if state in ("partial", "uncertain") else "uncertain",
                    "platform": platform, "revision": revision(platform)}
        return {"state": "saved", "platform": platform, "revision": revision(platform), "gatewayRestarted": False}
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        body = json.load(sys.stdin) if len(sys.argv) == 3 and sys.argv[2] in ("update", "apply") else None
        print(json.dumps(operation(sys.argv[1], sys.argv[2], body)))
    except (OSError, ValueError, TypeError, IndexError, subprocess.TimeoutExpired, TimeoutError):
        print(json.dumps({"state": "unavailable", "reason": "provider_config_unavailable"}))
