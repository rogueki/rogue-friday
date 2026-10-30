#!/usr/bin/env python3
"""Owner Telegram gateway settings. The bot token is accepted only on stdin."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.error import HTTPError
from urllib.request import urlopen
from messaging_runtime import platform_state

HERMES = Path.home() / ".hermes"
HERMES_CLI = Path.home() / ".local" / "bin" / "hermes"
ENV = HERMES / ".env"
LOCK = HERMES / ".obsidian-vault.lock"
TOKEN = re.compile(r"^[0-9]{5,20}:[A-Za-z0-9_-]{30,100}$")
USER = re.compile(r"^[1-9][0-9]{0,19}$")
CHAT = re.compile(r"^-[1-9][0-9]{0,19}$")
KEYS = ("TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS", "TELEGRAM_GROUP_ALLOWED_CHATS", "TELEGRAM_REQUIRE_MENTION")


def command(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)


def read_lines():
    if ENV.is_symlink() or (ENV.exists() and not ENV.is_file()):
        raise OSError("unsafe environment file")
    return ENV.read_text(encoding="utf-8").splitlines(keepends=True) if ENV.exists() else []


def values(lines):
    result = {}
    for key in KEYS:
        raw = next((line[len(key) + 1:].strip() for line in lines if line.startswith(key + "=")), "")
        result[key] = raw.strip('"')
    return result


def enabled():
    result = command(str(HERMES_CLI), "config", "get", "platforms.telegram.enabled")
    if result.returncode != 0:
        return None
    value = result.stdout.strip().lower()
    if value in ("true", "false"):
        return value == "true"
    return None


def gateway_running():
    result = command("systemctl", "--user", "is-active", "hermes-gateway.service")
    return result.returncode == 0 and result.stdout.strip() == "active"


def bot_probe(token):
    if not token:
        return {"botAuthentication": "missing", "botId": None, "botUsername": None,
                "receiveMode": "unknown"}
    try:
        with urlopen(f"https://api.telegram.org/bot{token}/getMe", timeout=4) as response:
            data = json.loads(response.read(4096))
        bot = data.get("result") if data.get("ok") is True else None
        if not isinstance(bot, dict) or not isinstance(bot.get("id"), int) or bot.get("is_bot") is not True:
            return {"botAuthentication": "invalid", "botId": None, "botUsername": None,
                    "receiveMode": "unknown"}
        mode = "unknown"
        try:
            with urlopen(f"https://api.telegram.org/bot{token}/getWebhookInfo", timeout=4) as response:
                info = json.loads(response.read(4096))
            if info.get("ok") is True and isinstance(info.get("result"), dict):
                mode = "webhook" if info["result"].get("url") else "polling"
        except (OSError, ValueError, TypeError):
            pass
        username = bot.get("username")
        return {"botAuthentication": "verified", "botId": str(bot["id"]),
                "botUsername": username if isinstance(username, str) else None, "receiveMode": mode}
    except HTTPError as error:
        return {"botAuthentication": "invalid" if error.code in (401, 403, 404) else "unknown",
                "botId": None, "botUsername": None, "receiveMode": "unknown"}
    except (OSError, ValueError, TypeError):
        return {"botAuthentication": "unknown", "botId": None, "botUsername": None,
                "receiveMode": "unknown"}


def delete_webhook(token):
    try:
        with urlopen(f"https://api.telegram.org/bot{token}/deleteWebhook", data=b"", timeout=4) as response:
            data = json.loads(response.read(4096))
        return data.get("ok") is True and data.get("result") is True
    except (OSError, ValueError, TypeError):
        return False


def snapshot(lines=None, applied=None):
    current = values(read_lines() if lines is None else lines)
    ids = [part.strip() for part in current["TELEGRAM_ALLOWED_USERS"].split(",") if part.strip()]
    chats = [part.strip() for part in current["TELEGRAM_GROUP_ALLOWED_CHATS"].split(",") if part.strip()]
    flag = enabled()
    mention = current["TELEGRAM_REQUIRE_MENTION"].lower()
    revision_source = json.dumps([current["TELEGRAM_BOT_TOKEN"], ids, chats, flag, mention], separators=(",", ":"))
    return {"tokenConfigured": bool(current["TELEGRAM_BOT_TOKEN"]), "allowedUserIds": ids, "allowedChatIds": chats,
            "requireMention": mention == "true" if mention in ("true", "false") else None,
            "enabled": flag, "gatewayRunning": gateway_running(), "connectionState": platform_state(HERMES, "telegram"),
            "applied": applied, "revision": int(hashlib.sha256(revision_source.encode()).hexdigest()[:12], 16),
            **bot_probe(current["TELEGRAM_BOT_TOKEN"])}


def write_env(lines, token, ids, chats, mention=""):
    other = [line for line in lines if not any(line.startswith(key + "=") for key in KEYS)]
    if other and not other[-1].endswith("\n"):
        other[-1] += "\n"
    if token:
        other.append(f'TELEGRAM_BOT_TOKEN="{token}"\n')
    if ids:
        other.append(f'TELEGRAM_ALLOWED_USERS="{",".join(ids)}"\n')
    if chats:
        other.append(f'TELEGRAM_GROUP_ALLOWED_CHATS="{",".join(chats)}"\n')
    if mention:
        other.append(f'TELEGRAM_REQUIRE_MENTION="{mention}"\n')
    fd, path = tempfile.mkstemp(prefix=".env.telegram.", dir=HERMES)
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


def update(lines):
    data = json.load(sys.stdin)
    base_keys = {"token", "clearToken", "allowedUserIds", "allowedChatIds", "removeWebhook", "enabled", "revision"}
    # requireMention is optional: an older client that does not send it leaves the stored value alone.
    if not isinstance(data, dict) or set(data) not in (base_keys, base_keys | {"requireMention"}):
        return 2
    if "requireMention" in data and not isinstance(data["requireMention"], bool):
        return 2
    token, clear, ids, chats, remove, flag, expected = (data[key] for key in ("token", "clearToken", "allowedUserIds", "allowedChatIds", "removeWebhook", "enabled", "revision"))
    if not isinstance(token, str) or not isinstance(clear, bool) or not isinstance(flag, bool) or not isinstance(ids, list) or not isinstance(chats, list) or not isinstance(remove, bool) or not isinstance(expected, int):
        return 2
    if token and (clear or not TOKEN.fullmatch(token)):
        return 2
    if len(ids) > 10 or any(not isinstance(item, str) or not USER.fullmatch(item) for item in ids) or len(set(ids)) != len(ids):
        return 2
    if len(chats) > 20 or any(not isinstance(item, str) or not CHAT.fullmatch(item) for item in chats) or len(set(chats)) != len(chats):
        return 2
    before = snapshot(lines)
    if expected != before["revision"]:
        print(json.dumps({"error": "conflict"}))
        return 3
    current = values(lines)
    new_token = "" if clear else token or current["TELEGRAM_BOT_TOKEN"]
    mention = ("true" if data["requireMention"] else "false") if "requireMention" in data else current["TELEGRAM_REQUIRE_MENTION"]
    if (flag or remove) and not new_token:
        print(json.dumps({"error": "token_required"}))
        return 4
    token_changed = bool(new_token) and new_token != current["TELEGRAM_BOT_TOKEN"]
    if flag or token_changed or remove:
        probe = bot_probe(new_token)
        # A new token only replaces the stored one after Telegram confirmed it; an unreachable API proves nothing.
        if token_changed and probe["botAuthentication"] == "invalid":
            print(json.dumps({"error": "bot_token_rejected"}))
            return 4
        if probe["botAuthentication"] == "unknown":
            print(json.dumps({"error": "bot_unverified"}))
            return 4
        if remove and probe["botAuthentication"] == "verified" and probe["receiveMode"] == "webhook":
            # Only on the owner's explicit request: another service using this bot's webhook stops receiving updates.
            if not delete_webhook(new_token):
                print(json.dumps({"error": "webhook_remove_failed"}))
                return 4
            probe = bot_probe(new_token)
        if flag and (probe["botAuthentication"] != "verified" or probe["receiveMode"] == "webhook"):
            print(json.dumps({"error": "invalid_bot_or_webhook_conflict"}))
            return 4
    changed_env = (new_token != current["TELEGRAM_BOT_TOKEN"] or ",".join(ids) != current["TELEGRAM_ALLOWED_USERS"]
                   or ",".join(chats) != current["TELEGRAM_GROUP_ALLOWED_CHATS"] or mention != current["TELEGRAM_REQUIRE_MENTION"])
    changed_flag = flag != before["enabled"]
    # Switch the flag first: if Hermes refuses it, nothing has been written yet.
    if changed_flag:
        configured = command(str(HERMES_CLI), "config", "set", "platforms.telegram.enabled", "true" if flag else "false")
        if configured.returncode != 0:
            print(json.dumps({"error": "config_unavailable"}))
            return 5
    if changed_env:
        try:
            write_env(lines, new_token, ids, chats, mention)
        except OSError:
            if changed_flag:
                command(str(HERMES_CLI), "config", "set", "platforms.telegram.enabled", "true" if before["enabled"] else "false")
            print(json.dumps({"error": "env_write_failed"}))
            return 5
    applied = None
    if changed_env or changed_flag:
        applied = command("systemctl", "--user", "restart", "hermes-gateway.service").returncode == 0
    print(json.dumps(snapshot(applied=applied)))
    return 0


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("status", "update"):
        return 2
    HERMES.mkdir(mode=0o700, parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        lines = read_lines()
        if sys.argv[1] == "status":
            print(json.dumps(snapshot(lines)))
            return 0
        return update(lines)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired):
        print(json.dumps({"error": "unavailable"}))
        raise SystemExit(5)
