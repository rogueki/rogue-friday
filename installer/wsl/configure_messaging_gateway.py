#!/usr/bin/env python3
"""Configure local Hermes messaging gateways. Secrets arrive only on stdin."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from messaging_runtime import platform_state

HERMES = Path.home() / ".hermes"
ENV = HERMES / ".env"
CLI = Path.home() / ".local" / "bin" / "hermes"
LOCK = HERMES / ".obsidian-vault.lock"
SPECS = {
    "discord": ("DISCORD_BOT_TOKEN", "DISCORD_ALLOWED_USERS", "DISCORD_ALLOWED_CHANNELS"),
    "whatsapp": ("WHATSAPP_MODE", "WHATSAPP_ALLOWED_USERS", "WHATSAPP_ENABLED"),
}
DISCORD_TOKEN = re.compile(r"^[A-Za-z0-9_.-]{30,128}$")
SNOWFLAKE = re.compile(r"^[1-9][0-9]{0,19}$")
PHONE = re.compile(r"^[1-9][0-9]{5,19}$")


def command(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)


def read_lines():
    if ENV.is_symlink() or (ENV.exists() and not ENV.is_file()):
        raise OSError("unsafe environment file")
    return ENV.read_text(encoding="utf-8").splitlines(keepends=True) if ENV.exists() else []


def values(lines, keys):
    return {key: next((line[len(key) + 1:].strip().strip('"') for line in lines if line.startswith(key + "=")), "") for key in keys}


def enabled(platform):
    result = command(str(CLI), "config", "get", f"platforms.{platform}.enabled")
    value = result.stdout.strip().lower() if result.returncode == 0 else ""
    return value == "true" if value in ("true", "false") else None


def running():
    result = command("systemctl", "--user", "is-active", "hermes-gateway.service")
    return result.returncode == 0 and result.stdout.strip() == "active"


def linked():
    legacy = HERMES / "whatsapp" / "session"
    # Hermes prefers a populated legacy directory over the new location.
    try:
        use_legacy = legacy.exists() and (not legacy.is_dir() or any(legacy.iterdir()))
    except OSError:
        use_legacy = True
    directory = legacy if use_legacy else HERMES / "platforms" / "whatsapp" / "session"
    path = directory / "creds.json"
    return path.is_file() and not path.is_symlink()


def linked_phone():
    legacy = HERMES / "whatsapp" / "session"
    try:
        use_legacy = legacy.exists() and (not legacy.is_dir() or any(legacy.iterdir()))
        directory = legacy if use_legacy else HERMES / "platforms" / "whatsapp" / "session"
        creds = directory / "creds.json"
        if creds.is_symlink():
            return None
        data = json.loads(creds.read_text(encoding="utf-8"))
        identifier = data.get("me", {}).get("id")
        candidate = identifier.split("@", 1)[0].split(":", 1)[0] if isinstance(identifier, str) else ""
        return candidate if PHONE.fullmatch(candidate) else None
    except (OSError, ValueError, AttributeError, TypeError):
        return None


def snapshot(platform, lines, applied=None):
    current = values(lines, SPECS[platform])
    flag = enabled(platform)
    ids = [item.strip() for item in current[f"{platform.upper()}_ALLOWED_USERS"].split(",") if item.strip()]
    source = json.dumps([list(current.values()), flag], separators=(",", ":"))
    base = {"allowedUserIds": ids, "enabled": flag, "gatewayRunning": running(),
            "connectionState": platform_state(HERMES, platform), "applied": applied,
            "revision": int(hashlib.sha256(source.encode()).hexdigest()[:12], 16)}
    if platform == "discord":
        base.update(tokenConfigured=bool(current["DISCORD_BOT_TOKEN"]),
                    allowedChannelIds=[item.strip() for item in current["DISCORD_ALLOWED_CHANNELS"].split(",") if item.strip()])
    else:
        base.update(mode=current["WHATSAPP_MODE"] if current["WHATSAPP_MODE"] in ("bot", "self-chat") else None,
                    sessionPresent=linked())
    return base


def write_env(lines, platform, updates):
    keys = SPECS[platform]
    other = [line for line in lines if not any(line.startswith(key + "=") for key in keys)]
    if other and not other[-1].endswith("\n"):
        other[-1] += "\n"
    for key, value in updates.items():
        if value:
            other.append(f'{key}="{value}"\n')
    fd, path = tempfile.mkstemp(prefix=f".env.{platform}.", dir=HERMES)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.writelines(other)
            output.flush()
            os.fsync(output.fileno())
        os.replace(path, ENV)
    finally:
        if os.path.exists(path):
            os.unlink(path)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib would forward the Authorization header to a redirect target; the token may only reach discord.com.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def discord_probe(token):
    """Returns "verified", "rejected" or "unverified" for a bot token without ever echoing it."""
    request = urllib.request.Request("https://discord.com/api/v10/users/@me", headers={
        "Authorization": f"Bot {token}", "User-Agent": "DiscordBot (https://github.com/rogueki/rogue-friday, 1.0)"})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=6) as response:
            data = json.loads(response.read(4096))
        return "verified" if response.status == 200 and isinstance(data, dict) and data.get("bot") is True else "rejected"
    except urllib.error.HTTPError as error:
        return "rejected" if error.code == 401 else "unverified"
    except (urllib.error.URLError, OSError, ValueError):
        return "unverified"


def update(platform, lines):
    data = json.load(sys.stdin)
    expected = {"allowedUserIds", "enabled", "revision"}
    expected |= {"token", "clearToken", "allowedChannelIds"} if platform == "discord" else {"mode"}
    if not isinstance(data, dict) or set(data) != expected:
        return 2
    ids, flag, revision = data["allowedUserIds"], data["enabled"], data["revision"]
    pattern = SNOWFLAKE if platform == "discord" else PHONE
    if not isinstance(ids, list) or len(ids) > 10 or any(not isinstance(x, str) or not pattern.fullmatch(x) for x in ids) or len(set(ids)) != len(ids) or not isinstance(flag, bool) or type(revision) is not int:
        return 2
    before = snapshot(platform, lines)
    if before["revision"] != revision:
        print(json.dumps({"error": "conflict"}))
        return 3
    current = values(lines, SPECS[platform])
    if platform == "discord":
        token, clear, channels = data["token"], data["clearToken"], data["allowedChannelIds"]
        if not isinstance(token, str) or (token and not DISCORD_TOKEN.fullmatch(token)) or not isinstance(clear, bool) or (clear and token) or not isinstance(channels, list) or len(channels) > 20 or any(not isinstance(x, str) or not SNOWFLAKE.fullmatch(x) for x in channels) or len(set(channels)) != len(channels):
            return 2
        token = "" if clear else token or current["DISCORD_BOT_TOKEN"]
        if flag and (not token or not ids):
            print(json.dumps({"error": "token_and_owner_required"}))
            return 4
        if token and token != current["DISCORD_BOT_TOKEN"]:
            # A new token only replaces the stored one after Discord confirmed it; an unreachable API proves nothing.
            verdict = discord_probe(token)
            if verdict != "verified":
                print(json.dumps({"error": "bot_token_rejected" if verdict == "rejected" else "bot_unverified"}))
                return 4
        updates = {"DISCORD_BOT_TOKEN": token, "DISCORD_ALLOWED_USERS": ",".join(ids), "DISCORD_ALLOWED_CHANNELS": ",".join(channels)}
    else:
        mode = data["mode"]
        if mode not in ("bot", "self-chat"):
            return 2
        if flag and (not ids or not linked()):
            print(json.dumps({"error": "pairing_and_owner_required"}))
            return 4
        if flag and mode == "self-chat" and linked_phone() not in ids:
            print(json.dumps({"error": "self_chat_owner_phone_required"}))
            return 4
        updates = {"WHATSAPP_MODE": mode, "WHATSAPP_ALLOWED_USERS": ",".join(ids), "WHATSAPP_ENABLED": "true" if flag else "false"}
    changed_env = any(updates[key] != current[key] for key in updates)
    changed_flag = flag != before["enabled"]
    # Switch the flag first: if Hermes refuses it, nothing has been written yet.
    if changed_flag:
        result = command(str(CLI), "config", "set", f"platforms.{platform}.enabled", "true" if flag else "false")
        if result.returncode != 0:
            print(json.dumps({"error": "config_unavailable"}))
            return 5
    if changed_env:
        try:
            write_env(lines, platform, updates)
        except OSError:
            if changed_flag:
                command(str(CLI), "config", "set", f"platforms.{platform}.enabled", "true" if before["enabled"] else "false")
            print(json.dumps({"error": "env_write_failed"}))
            return 5
    applied = None
    if changed_env or changed_flag:
        applied = command("systemctl", "--user", "restart", "hermes-gateway.service").returncode == 0
    print(json.dumps(snapshot(platform, read_lines(), applied)))
    return 0


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in SPECS or sys.argv[2] not in ("status", "update"):
        return 2
    platform, action = sys.argv[1:]
    HERMES.mkdir(mode=0o700, parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        lines = read_lines()
        if action == "status":
            print(json.dumps(snapshot(platform, lines)))
            return 0
        return update(platform, lines)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired):
        print(json.dumps({"error": "unavailable"}))
        raise SystemExit(5)
