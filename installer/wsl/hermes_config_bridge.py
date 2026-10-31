#!/usr/bin/env python3
"""Narrow Friday bridge to the installed Hermes config API. No raw config leaves this process."""

import hashlib
import hmac
import ipaddress
import json
import fcntl
import os
import re
import secrets
import shutil
import signal
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlsplit
import yaml
sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_mcp_http_apply import valid_url


FIELDS = {
    "model.provider": ("provider", None, None),
    "model.default": ("model", None, None),
    "model.base_url": ("base_url", None, None),
    "agent.reasoning_effort": ("reasoning", None, None),
    "fallback.min_switch_reset_seconds": ("integer", 0, 3600),
    "fallback_model": ("fallback", None, None),
    "agent.auto_recovery_cycles": ("integer", 0, 20),
    "agent.run_budget_seconds": ("optional_integer", 1, 86400),
    "agent.budget_warning_ratio": ("optional_number", 0.01, 0.99),
    "agent.agent_cache.max_size": ("integer", 1, 4096),
    "max_concurrent_sessions": ("integer", 0, 10000),
    "context_file_max_chars": ("integer", 0, 1000000),
    "compression.enabled": ("boolean", None, None),
    "compression.threshold": ("number", 0.1, 0.95),
    "compression.target_ratio": ("number", 0.1, 0.8),
    "compression.tail_mode": ("tail_mode", None, None),
    "compression.protect_last_n": ("integer", 0, 100),
    "agent.max_turns": ("integer", 1, 100000),
    "agent.gateway_timeout": ("integer", 60, 86400),
    "agent.api_max_retries": ("integer", 1, 10),
    "session.terminal_continue": ("boolean", None, None),
    "max_live_sessions": ("integer", 0, 10000),
    "terminal.timeout": ("integer", 1, 3600),
    "terminal.container_cpu": ("number", 0.01, 1024),
    "terminal.container_memory": ("integer", 1, 1048576),
    "terminal.container_disk": ("integer", 1, 1048576),
    "terminal.container_persistent": ("boolean", None, None),
    "terminal.backend": ("execution_backend", None, None),
    "terminal.cwd": ("workspace_path", None, None),
    "terminal.docker_network": ("boolean", None, None),
    "terminal.docker_mount_cwd_to_workspace": ("boolean", None, None),
    "terminal.docker_volumes": ("docker_mounts", None, None),
    "browser.command_timeout": ("integer", 5, 600),
    "browser.snapshot_threshold": ("integer", 1000, 200000),
    "browser.inactivity_timeout": ("integer", 30, 3600),
    "browser.engine": ("browser_engine", None, None),
    "browser.headed": ("boolean", None, None),
    "browser.auto_local_for_private_urls": ("boolean", None, None),
    "browser.dialog_policy": ("dialog_policy", None, None),
    "browser.dialog_timeout_s": ("integer", 1, 3600),
    "browser.allow_private_urls": ("boolean", None, None),
    "browser.use_real_profile": ("boolean", None, None),
    "browser.real_profile_pin": ("profile_pin", None, None),
    "browser.restrict_evaluate": ("boolean", None, None),
    "browser.allow_unsafe_evaluate": ("boolean", None, None),
    "code_execution.mode": ("code_mode", None, None),
    "code_execution.kernel_idle_timeout": ("integer", 30, 86400),
    "code_execution.max_session_kernels": ("integer", 1, 32),
    "computer_use.permission_mode": ("computer_permission", None, None),
    "computer_use.capability_manifest": ("manifest_path", None, None),
    "computer_use.max_image_dimension": ("integer", 320, 4096),
    "computer_use.ax_max_elements": ("integer", 50, 1000),
    "computer_use.capture_after_mode": ("capture_after_mode", None, None),
    "toolsets": ("toolset_names", None, None),
    "command_allowlist": ("allowlist_subset", None, None),
    "approvals.mode": ("approval_mode", None, None),
    "approvals.timeout": ("integer", 15, 600),
    "approvals.denial_breaker_threshold": ("integer", 0, 100000),
    "approvals.deny": ("deny_globs", None, None),
    "approvals.destructive_slash_confirm": ("boolean", None, None),
    "approvals.mcp_reload_confirm": ("boolean", None, None),
    "approvals.single_query_mode": ("automatic_approval", None, None),
    "approvals.unattended_mode": ("automatic_approval", None, None),
    "security.protected_instruction_files": ("boolean", None, None),
    "skills.disabled": ("skill_names", None, None),
    "cron.catch_up_missed": ("boolean", None, None),
    "cron.allow_agent_scheduling": ("boolean", None, None),
    "cron.preflight": ("boolean", None, None),
    "cron.max_parallel_jobs": ("optional_integer", 1, 64),
    "cron.output_retention": ("integer", 0, 10000),
    "cron.script_timeout_seconds": ("integer", 1, 86400),
    "cron.session_db_timeout_seconds": ("integer", 0, 3600),
    "cron.failure_repeat_alert_hours": ("integer", 0, 168),
    "cron.require_restart_safe_scope": ("boolean", None, None),
    "kanban.max_in_progress": ("optional_integer", 1, 64),
    "kanban.max_in_progress_per_profile": ("optional_integer", 1, 16),
    "kanban.max_spawn": ("optional_integer", 1, 64),
    "kanban.failure_limit": ("integer", 1, 20),
    "kanban.dispatch_stale_timeout_seconds": ("integer", 0, 86400),
    "delegation.max_spawn_depth": ("integer", 1, 3),
    "delegation.max_concurrent_children": ("integer", 1, 16),
    "delegation.max_iterations": ("integer", 10, 1000),
    "delegation.child_timeout_seconds": ("integer", 0, 86400),
    "gateway.loop_watchdog": ("boolean", None, None),
    "gateway.startup_watchdog": ("boolean", None, None),
    "gateway.startup_watchdog_timeout_seconds": ("integer", 30, 3600),
    "gateway.restart_loop_guard.max_restarts": ("integer", 0, 20),
    "gateway.respawn_storm.max_starts": ("integer", 0, 100),
    "gateway.signal_interrupt_grace_timeout": ("number", 0, 60),
    "logging.level": ("log_level", None, None),
    "logging.max_size_mb": ("integer", 1, 100),
    "logging.backup_count": ("integer", 1, 50),
}
MODEL_CREDENTIALS = frozenset(("OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"))
REASONING_EFFORTS = frozenset(("", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"))


# The API key is sent to this host, so plaintext is only acceptable for loopback endpoints.
def valid_base_url(value):
    if (not isinstance(value, str) or not 1 <= len(value) <= 512 or "?" in value or "#" in value or
            any(ord(ch) <= 32 or ord(ch) >= 127 for ch in value)):
        return False
    try:
        parsed = urlsplit(value)
        parsed.port
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if not host or parsed.username is not None or parsed.password is not None:
        return False
    if parsed.scheme == "https":
        return True
    if parsed.scheme != "http":
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def valid_field_value(key, value, spec):
    kind = spec[0]
    if kind == "integer":
        return type(value) is int and spec[1] <= value <= spec[2]
    if kind == "optional_integer":
        return value is None or (type(value) is int and spec[1] <= value <= spec[2])
    if kind == "optional_number":
        return value is None or (type(value) in (int, float) and spec[1] <= value <= spec[2])
    if kind == "number":
        return type(value) in (int, float) and spec[1] <= value <= spec[2]
    if kind == "boolean":
        return type(value) is bool
    if kind == "provider":
        return type(value) is str and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", value) is not None
    if kind == "model":
        return type(value) is str and 1 <= len(value) <= 200 and re.fullmatch(r"[^\s\x00-\x1f\x7f]+", value) is not None
    if kind == "reasoning":
        return type(value) is str and value in REASONING_EFFORTS
    if kind == "tail_mode":
        return type(value) is str and value in ("lean", "legacy")
    if kind == "execution_backend":
        return type(value) is str and value in ("local", "docker")
    if kind == "code_mode":
        return type(value) is str and value in ("project", "strict")
    if kind == "dialog_policy":
        return type(value) is str and value in ("must_respond", "auto_dismiss")
    if kind == "browser_engine":
        return type(value) is str and value in ("auto", "chrome", "lightpanda")
    if kind == "capture_after_mode":
        return type(value) is str and value in ("som", "ax", "vision")
    if kind == "computer_permission":
        return type(value) is str and value in ("standard", "bounded")
    if kind == "approval_mode":
        return type(value) is str and value in ("manual", "smart", "off")
    if kind == "automatic_approval":
        return type(value) is str and value in ("deny", "approve")
    if kind == "profile_pin":
        return type(value) is str and (value == "" or re.fullmatch(r"(?:Default|Profile [0-9]{1,3})", value) is not None)
    if kind == "manifest_path":
        return type(value) is str and (value == "" or
            (1 <= len(value) <= 512 and value.startswith("/") and
             value.isprintable()))
    if kind == "workspace_path":
        return type(value) is str and (value == "." or
            (1 <= len(value) <= 512 and value.startswith("/") and
             value.isprintable()))
    if kind in ("docker_mounts", "toolset_names", "allowlist_subset", "deny_globs"):
        limit = 8 if kind == "docker_mounts" else 16 if kind == "toolset_names" else 128
        return (type(value) is list and len(value) <= limit and
                all(type(item) is str and 1 <= len(item) <= 512 and
                    (item.isprintable() if kind in ("docker_mounts", "deny_globs") else
                        all((32 if kind == "allowlist_subset" else 33) <= ord(char) < 127 for char in item))
                    for item in value) and
                len(set(value)) == len(value))
    if kind == "log_level":
        return type(value) is str and value in ("DEBUG", "INFO", "WARNING")
    if kind == "fallback":
        return (type(value) is list and len(value) <= 8 and all(
            type(item) is dict and set(item) == {"provider", "model"} and
            valid_field_value("model.provider", item["provider"], FIELDS["model.provider"]) and
            valid_field_value("model.default", item["model"], FIELDS["model.default"])
            for item in value))
    if kind == "skill_names":
        return (type(value) is list and len(value) <= 512 and len(set(value)) == len(value) and
                all(type(name) is str and re.fullmatch(r"[A-Za-z0-9._/-]{1,100}", name) for name in value))
    if kind == "base_url":
        return valid_base_url(value)
    return False
PINNED_SOURCE = "d923a5eb"


def valid_plugin_id(name):
    return (type(name) is str and re.fullmatch(r"[A-Za-z0-9._/-]{1,100}", name) is not None and
            all(part and part not in (".", "..") for part in name.split("/")))


def valid_mcp_name(name):
    return type(name) is str and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", name) is not None


FAMILIES = (
    ("models", ("model", "models_dev", "providers", "fallback", "fallback_providers", "auxiliary", "agent.service_tier"), "P7-B: provider onboarding and live catalog remain"),
    ("agent", ("agent", "compression", "context", "session", "sessions"), "P7-C: further session/context fields remain"),
    ("execution", ("terminal", "browser", "computer_use", "code_execution", "toolsets"), "P7-D"),
    ("extensions", ("skills", "plugins", "mcp"), "P7-E"),
    ("operations", ("cron", "gateway", "logging", "monitoring", "hooks", "update"), "P7-F"),
)


def revision_bytes(content, home):
    key_path = home / ".friday-config-revision.key"
    try:
        fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, "wb") as output:
            output.write(secrets.token_bytes(32))
            output.flush()
            os.fsync(output.fileno())
    if key_path.is_symlink() or key_path.stat().st_mode & 0o077:
        raise ValueError("unsafe_revision_key")
    deadline = time.monotonic() + 1
    while True:
        key = key_path.read_bytes()
        if len(key) == 32:
            break
        if time.monotonic() >= deadline:
            raise ValueError("invalid_revision_key")
        time.sleep(0.01)
    return int(hmac.new(key, content, hashlib.sha256).hexdigest()[:12], 16) or 1


def snapshot(path):
    if path.is_symlink():
        raise ValueError("config_symlink")
    try:
        content = path.read_bytes()
    except FileNotFoundError:
        content = b""
    raw = yaml.safe_load(content.decode("utf-8-sig")) if content else {}
    if not isinstance(raw, dict):
        raise ValueError("invalid_config")
    env_path = path.parent / ".env"
    if env_path.is_symlink():
        raise ValueError("config_symlink")
    try:
        env_content = env_path.read_bytes()
    except FileNotFoundError:
        env_content = b""
    # Include Hermes' credential store in the same 48-bit, JS-safe CAS token.
    return revision_bytes(content + b"\0" + env_content, path.parent), raw


def revision(path):
    return snapshot(path)[0]


def nested(config, key):
    value = config
    for part in key.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


EXCLUDED_SKILL_DIRS = frozenset((".git", ".github", ".hub", ".archive", ".curator_backups", ".locks",
    ".venv", "venv", "node_modules", "site-packages", "__pycache__", ".tox", ".nox", ".pytest_cache",
    ".mypy_cache", ".ruff_cache"))
SKILL_SUPPORT_DIRS = frozenset(("references", "templates", "assets", "scripts"))


def installed_skills(roots, report_missing=False):
    """Profile roots, with the same recursive/pruned SKILL.md scan as agent.skill_utils.

    A configured external dir on an unplugged drive simply is not there. The inventory asks for that to be
    reported instead of silently dropping every skill behind it; the validation callers do not.
    """
    result, errors = {}, []
    for root in roots:
        if not root.exists():
            if report_missing:
                errors.append("skill_root_missing")
            continue
        if not root.is_dir():
            errors.append("skill_root_unreadable")
            continue
        def onerror(_error):
            errors.append("skill_root_unreadable")
        for current, dirs, files in os.walk(root, followlinks=True, onerror=onerror):
            dirs[:] = [name for name in dirs if name not in EXCLUDED_SKILL_DIRS and
                       not ("SKILL.md" in files and name in SKILL_SUPPORT_DIRS)]
            if "SKILL.md" not in files:
                continue
            manifest = Path(current) / "SKILL.md"
            try:
                # Hermes' declared name is the activation key; path is a stable fallback.
                text = manifest.read_text(encoding="utf-8-sig")[:16384]
                header = text.split("---", 2)[1] if text.startswith("---") else ""
                metadata = yaml.safe_load(header) if header else {}
                name = metadata.get("name") if isinstance(metadata, dict) else None
                name = name.strip() if isinstance(name, str) and name.strip() else manifest.parent.name
                if name in result:
                    errors.append("skill_name_collision")
                result.setdefault(name, True)
            except (OSError, ValueError, yaml.YAMLError):
                errors.append("skill_manifest_unreadable")
    return sorted(result), sorted(set(errors))


def inventory_roots(home, call):
    roots, errors = [home / "skills"], []
    for key in ("skills.create_dir", "skills.external_dirs"):
        try:
            value = json.loads(call("get", key, "--json"))
        except (ValueError, json.JSONDecodeError):
            errors.append("skill_roots_unknown")
            continue
        entries = value if isinstance(value, list) else [value] if isinstance(value, str) else []
        if value is not None and not isinstance(value, (list, str)):
            errors.append("skill_roots_unknown")
        for entry in entries:
            if not isinstance(entry, str):
                errors.append("skill_roots_unknown")
                continue
            entry = os.path.expandvars(os.path.expanduser(entry.strip()))
            if entry:
                path = Path(entry)
                roots.append(path if path.is_absolute() else home / path)
    return list(dict.fromkeys(roots)), errors


def lock_config(home, name=".friday-config.lock"):
    lock_path = home / name
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    lock = os.fdopen(fd, "a+")
    os.fchmod(lock.fileno(), 0o600)
    deadline = time.monotonic() + 15
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return lock
        except BlockingIOError:
            if time.monotonic() >= deadline:
                lock.close()
                raise ValueError("config_lock_timeout")
            time.sleep(0.025)


def process_start(pid):
    try:
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="ascii")
        fields = stat.rsplit(") ", 1)[1].split()
        return None if fields[0] in ("Z", "X") else fields[19]
    except (OSError, IndexError, ValueError):
        return None


def run_runtime_child(command, request, timeout):
    # runtime_command launches Python directly. A separate process group also
    # covers bootstrap/lifecycle descendants before releasing the config locks.
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        stdout, stderr = process.communicate(request, timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.stdout.close()
            process.stderr.close()
            process.wait(timeout=1)
        raise
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def apply_env_value(home, source, key, value):
    # Hermes' CLI takes values only in argv; its Python closure reads them from stdin so secrets stay out of ps.
    env_lock = lock_config(home, ".obsidian-vault.lock")
    try:
        sys.path.insert(0, str(source))
        from hermes_cli._launchers import runtime_command
        probe = Path(__file__).with_name("hermes_model_credential_apply.py")
        command = runtime_command(source, code=f"import runpy; runpy.run_path({str(probe)!r}, run_name='__main__')")
        result = run_runtime_child(command, json.dumps({"key": key, "value": value}), 30)
        try:
            reply = json.loads(result.stdout)
        except (ValueError, TypeError):
            reply = {}
        reply = reply if isinstance(reply, dict) else {}
        if reply.get("error") in ("credential_rejected", "credential_unverified"):
            raise ValueError(reply["error"])
        if result.returncode or reply.get("saved") is not True:
            raise ValueError("credential_readback_failed")
    finally:
        fcntl.flock(env_lock, fcntl.LOCK_UN)
        env_lock.close()


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("status", "update", "credential-update", "plugin-activation", "mcp-http", "mcp-activation", "mcp-bearer", "mcp-probe", "auth-list", "skills-list", "skill-md", "hub-search", "modified-list", "skill-report", "skill-mutate", "skill-command", "skill-governance", "mcp-oauth-start", "mcp-oauth-status", "mcp-oauth-cancel", "model-catalog", "provider-auth", "approval-test", "pairing", "provider-oauth-start", "provider-oauth-status", "provider-oauth-cancel"):
        # An empty stdout with exit 2 looked like a broken adapter; the caller could not tell a typo from a crash.
        print(json.dumps({"error": "invalid_request",
                          "detail": "unknown action " + (sys.argv[1] if len(sys.argv) > 1 else "<missing>")}))
        return 5
    home = Path.home() / ".hermes"
    source = home / "hermes-agent"
    cli = home.parent / ".local" / "bin" / "hermes"
    if not source.is_dir() or not cli.is_file():
        print(json.dumps({"error": "hermes_not_installed"}))
        return 5
    return locked_main(home, source, cli)


SKILL_SLUG = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
SKILL_MD_LIMIT = 65536
PAIRING_PLATFORMS = ("telegram", "discord", "whatsapp")
PAIRING_USER_ID = re.compile(r"^[A-Za-z0-9@._:+-]{1,128}$")


def read_skill_markdown(home, source, slug):
    """Return the installed SKILL.md text for one slug. Text only; rendering is the UI's escaping job."""
    if type(slug) is not str or SKILL_SLUG.fullmatch(slug) is None:
        raise ValueError("invalid_skill_id")
    roots = [home / "skills", source / "skills"]
    for root in roots:
        if not root.is_dir():
            continue
        candidates = [root / slug / "SKILL.md"]
        candidates.extend(child / slug / "SKILL.md" for child in root.iterdir() if child.is_dir())
        for candidate in candidates:
            if candidate.name != "SKILL.md" or not candidate.is_file() or candidate.is_symlink():
                continue
            try:
                resolved = candidate.resolve()
                resolved.relative_to(root.resolve())
            except (OSError, ValueError):
                continue
            size = resolved.stat().st_size
            if size > SKILL_MD_LIMIT:
                raise ValueError("skill_md_too_large")
            text = resolved.read_text(encoding="utf-8", errors="strict")
            if not text.strip():
                continue
            return {"id": slug, "content": text, "bytes": size}
    raise ValueError("skill_md_missing")


def parse_auth_list(text):
    """Parse `hermes auth list` text. Never returns a key: only type and source marker."""
    providers = []
    current = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        header = re.fullmatch(r"([A-Za-z0-9_.-]+) \((\d+) credentials?\):", line.strip())
        if header:
            current = {"provider": header.group(1), "count": int(header.group(2)), "credentials": []}
            providers.append(current)
            continue
        entry = re.fullmatch(r"\s*#(\d+)\s{2,}(.+?)\s{2,}(api[_-]key|oauth(?:_token)?)\s+(\S+?)(\s*←)?\s*", line)
        if entry and current is not None:
            label = entry.group(2).strip()
            kind = entry.group(3).replace("-", "_")
            source = entry.group(4)
            if not label or len(label) > 200 or len(source) > 200:
                raise ValueError("auth_list_format")
            current["credentials"].append({"index": int(entry.group(1)), "label": label,
                                           "type": kind, "source": source, "active": bool(entry.group(5))})
            continue
        raise ValueError("auth_list_format")
    if not providers:
        raise ValueError("auth_list_format")
    for provider in providers:
        if provider["count"] != len(provider["credentials"]):
            raise ValueError("auth_list_format")
    return {"providers": providers}


def read_request():
    """Decode the JSON request from stdin. A UTF-8 BOM must not turn a valid request into a failure (N-068)."""
    raw = sys.stdin.buffer.read()
    if not raw:
        raise ValueError("invalid_request")
    try:
        return json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("invalid_request")


SKILL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
# inspect/audit resolve identities against the registries; a name alone is ambiguous there (N-053).
SKILL_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}(/[A-Za-z0-9][A-Za-z0-9._-]{0,119}){0,2}$")
# The table names the registry a skill came from ("builtin", "local", "skills.sh", "clawhub", ...) and the trust
# the checker assigned ("builtin", "local", "trusted", "community", ...). Both vocabularies grow with every registry,
# so a bounded token is checked instead of a fixed set; the row layout itself stays strictly parsed.
SKILL_SOURCE_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")
SKILL_STATES = {"enabled", "disabled"}

# A cold profile refreshes the skill catalog: 159 skills took 44 s on the operator system, so the old 30 s
# turned a working inventory into "hermes_unavailable" (N-067). One budget for every list call.
SKILL_LIST_TIMEOUT = 90


def skill_list_timeout():
    """Operators with a slow profile can raise the budget; nonsense falls back to the default."""
    try:
        value = int(os.environ.get("FRIDAY_SKILLS_LIST_TIMEOUT", ""))
    except ValueError:
        return SKILL_LIST_TIMEOUT
    return value if 1 <= value <= 600 else SKILL_LIST_TIMEOUT


def parse_skills_list(text):
    """Parse `hermes skills list` output. Only the documented five-column layout is accepted."""
    header = ["Name", "Category", "Source", "Trust", "Status"]
    seen_header = False
    skills = []
    names = set()
    for raw in text.splitlines():
        line = raw.rstrip()
        # v0.20.5 draws the header with light borders (U+2502), v0.22.2 with heavy ones (U+2503); both layouts
        # carry the same five columns, so the parser accepts either and rejects everything else.
        if not line or line[0] not in ("\u2502", "\u2503"):
            continue
        cells = [cell.strip() for cell in re.split("[\u2502\u2503]", line)]
        if len(cells) != 7 or cells[0] or cells[6]:
            raise ValueError("skills_list_format")
        values = cells[1:6]
        if values == header:
            if seen_header or skills:
                raise ValueError("skills_list_format")
            seen_header = True
            continue
        if not seen_header:
            raise ValueError("skills_list_format")
        name, category, origin, trust, state = values
        if SKILL_NAME.fullmatch(name) is None or len(category) > 64 or name in names:
            raise ValueError("skills_list_format")
        if SKILL_SOURCE_TOKEN.fullmatch(origin) is None or SKILL_SOURCE_TOKEN.fullmatch(trust) is None or \
                state not in SKILL_STATES:
            raise ValueError("skills_list_format")
        names.add(name)
        skills.append({"name": name, "category": category, "origin": origin,
                       "trust": trust, "state": state})
    if not seen_header:
        raise ValueError("skills_list_format")
    return {"count": len(skills), "skills": skills}


def parse_hub_search(text, query, source):
    """Parse `hermes skills search --json`. Only the documented fields are read; extra keys are ignored."""
    try:
        payload = json.loads(text)
    except ValueError:
        raise ValueError("hub_search_format")
    if not isinstance(payload, list) or len(payload) > 50:
        raise ValueError("hub_search_format")
    results = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("hub_search_format")
        name = item.get("name")
        identifier = item.get("identifier")
        origin = item.get("source")
        trust = item.get("trust_level")
        description = item.get("description")
        if not isinstance(name, str) or SKILL_NAME.fullmatch(name) is None:
            raise ValueError("hub_search_format")
        if not isinstance(identifier, str) or not 1 <= len(identifier) <= 300:
            raise ValueError("hub_search_format")
        if not isinstance(origin, str) or not 1 <= len(origin) <= 40:
            raise ValueError("hub_search_format")
        if not isinstance(trust, str) or not 1 <= len(trust) <= 40:
            raise ValueError("hub_search_format")
        if not isinstance(description, str) or len(description) > 2000:
            raise ValueError("hub_search_format")
        results.append({"identifier": identifier, "name": name, "source": origin,
                        "trustLevel": trust, "description": description})
    return {"query": query, "source": source, "results": results}


SKILL_REPORT_LIMIT = 65536
# A measured run on v0.22.2: `diff` answers locally in well under a second, while `inspect` and `audit`
# resolve the name against the registries first (37 s here, and a name that also exists upstream comes
# back as an ambiguity table). The limits keep a hanging network from blocking the bridge forever.
# A bare name is resolved against the registries first: 90 s was not enough on the operator system (the identifier
# form answers in 2 s). One budget that a real resolution fits into.
SKILL_REPORT_TIMEOUTS = {"inspect": 150, "audit": 150, "diff": 60}


def parse_skill_report(text, action, name):
    """The CLI documents no JSON for inspect/audit/diff, so the raw text is passed through unchanged.
    It is capped instead of parsed: a table that changes shape between versions must never be turned
    into invented fields."""
    if not isinstance(text, str):
        raise ValueError("skill_report_format")
    body = text.strip("\n")
    if body.strip() == "":
        raise ValueError("skill_report_empty")
    truncated = len(body) > SKILL_REPORT_LIMIT
    body = body[:SKILL_REPORT_LIMIT]
    return {"action": action, "name": name, "text": body, "bytes": len(text.encode("utf-8")),
            "truncated": truncated}


SKILL_MUTATIONS = ("install", "update", "uninstall")
SNAPSHOT_DIR_NAME = "friday-snapshots"
SKILL_MUTATION_TEXT_LIMIT = 4096
SKILL_MUTATION_TIMEOUT = 180


# tap list resolves its GitHub taps over the network; measured well over the old 30 s, so it gets the same budget
# as browse. The service uses 35/95/125 s on top of these, so a timeout is reported, never silently shortened.
SKILL_COMMANDS = {"browse": 90, "check": 120, "tap-list": 90}


GOVERNANCE_ACTIONS = {"trust", "untrust", "tap-add", "tap-remove", "reset"}
GOVERNANCE_TIMEOUT = 90


def governance_target(home, request):
    """Every action touches global state, so the target is checked here: a real directory for trust, a plain
    owner/repo for a tap. Nothing is passed through unvalidated."""
    action = request["action"]
    if action in {"trust", "untrust"}:
        path = request["path"]
        if not isinstance(path, str) or not path.startswith("/") or ".." in path.split("/"):
            raise ValueError("invalid_request")
        resolved = os.path.realpath(path)
        if not os.path.isdir(resolved):
            raise ValueError("invalid_target")
        # The CLI only loads project skills from these two directories; trusting anything else would be a no-op
        # that still claims success.
        if not any(os.path.isdir(os.path.join(resolved, marker, "skills")) for marker in (".hermes", ".agents")):
            raise ValueError("missing_project_skills")
        return resolved
    if action == "tap-add":
        repo = request["repo"]
        if not isinstance(repo, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,38}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}", repo) is None:
            raise ValueError("invalid_request")
        return repo
    if action == "reset":
        # `--restore` is deliberately not exposed: it replaces the local copy with the bundled one, which belongs to
        # the snapshot flow of DASH-10.07, not to a governance toggle.
        name = request["name"]
        if not isinstance(name, str) or SKILL_NAME.fullmatch(name) is None:
            raise ValueError("invalid_request")
        return name
    repo = request["repo"]
    if not isinstance(repo, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,38}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}", repo) is None:
        raise ValueError("invalid_request")
    return repo


def governance_argv(cli, action, target):
    if action in {"trust", "untrust"}:
        return [str(cli), "skills", action, target]
    if action == "reset":
        return [str(cli), "skills", "reset", target]
    if action == "tap-add":
        return [str(cli), "skills", "tap", "add", target]
    return [str(cli), "skills", "tap", "remove", target]


def skill_command_argv(cli, command, name, page, size, source):
    """The three remaining read-only skill commands are text-only and take different arguments."""
    argv = [str(cli), "skills"]
    if command == "tap-list":
        argv.extend(["tap", "list"])
    elif command == "browse":
        argv.append("browse")
        if source is not None:
            argv.extend(["--source", source])
        argv.extend(["--page", str(page), "--size", str(size)])
    else:
        argv.append("check")
        if name is not None:
            argv.append(name)
    return argv


def skill_list_rows(cli, timeout=120):
    """The inventory, read the same way as the `skills-list` action and parsed by the same strict parser.

    The first call in a fresh profile refreshes the catalog, which takes far longer than the 30 s the plain
    inventory allows; a mutation reads the list twice and must not fail on that cold start.
    """
    result = subprocess.run([str(cli), "skills", "list", "--source", "all"], capture_output=True,
                            text=True, timeout=max(timeout, skill_list_timeout()), env=dict(os.environ, COLUMNS="400"))
    if result.returncode:
        raise ValueError("skills_list_failed")
    return parse_skills_list(result.stdout)


def skill_directories(home, name):
    """Installed directories that carry this skill, found with the same pruned scan as the inventory."""
    roots = [home / "skills"]
    profiles = home / "profiles"
    if profiles.is_dir():
        roots.extend(sorted(profiles.glob("*/skills")))
    found = []
    for root in roots:
        if not root.is_dir():
            continue
        for current, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = [entry for entry in dirs if entry not in EXCLUDED_SKILL_DIRS]
            if "SKILL.md" not in files:
                continue
            directory = Path(current)
            try:
                header = (directory / "SKILL.md").read_text(encoding="utf-8-sig")[:16384]
            except OSError:
                continue
            metadata = yaml.safe_load(header.split("---", 2)[1]) if header.startswith("---") else {}
            declared = metadata.get("name") if isinstance(metadata, dict) else None
            if (declared or directory.name) == name:
                found.append(directory)
    return found


def snapshot_skill(home, action, name):
    """Copy the installed skill before a mutation so a failure can be undone without guesswork."""
    directories = skill_directories(home, name)
    if not directories:
        return None
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    base = home / SNAPSHOT_DIR_NAME / ("%s-%s-%s" % (stamp, action, name))
    target, attempt = base, 1
    while target.exists():
        attempt += 1
        target = base.with_name("%s-%d" % (base.name, attempt))
    payload = target / "skill"
    payload.mkdir(parents=True, exist_ok=False)
    for index, directory in enumerate(directories):
        shutil.copytree(directory, payload / str(index), symlinks=False)
    state = {"action": action, "name": name, "createdAt": stamp,
             "directories": [str(directory) for directory in directories]}
    (target / "state.json").write_text(json.dumps(state), encoding="utf-8")
    return target


def restore_skill(snapshot):
    state = json.loads((snapshot / "state.json").read_text(encoding="utf-8"))
    for index, directory in enumerate(state["directories"]):
        current = Path(directory)
        if current.exists():
            shutil.rmtree(current)
        current.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(snapshot / "skill" / str(index), current)


def parse_modified_skills(text):
    """Parse `hermes skills list-modified --json`: a flat array of skill names or nothing."""
    try:
        payload = json.loads(text)
    except ValueError:
        raise ValueError("modified_skills_format")
    if not isinstance(payload, list) or len(payload) > 500:
        raise ValueError("modified_skills_format")
    names = []
    for item in payload:
        if not isinstance(item, str) or SKILL_NAME.fullmatch(item) is None or item in names:
            raise ValueError("modified_skills_format")
        names.append(item)
    return {"names": names}


def locked_main(home, source, cli):
    def call(*args):
        result = subprocess.run([str(cli), "config", *args], capture_output=True, text=True, timeout=15)
        if result.returncode:
            if len(args) == 3 and args[0] == "get" and args[2] == "--json" and \
                    (result.stdout + result.stderr).strip() == f"Config key not set: {args[1]}":
                return "null"
            raise ValueError("hermes_config_failed")
        return result.stdout.strip()

    if sys.argv[1] == "skill-md":
        request = read_request()
        if not isinstance(request, dict) or set(request) != {"id"}:
            raise ValueError("invalid_request")
        print(json.dumps(read_skill_markdown(home, source, request["id"])))
        return 0
    if sys.argv[1] == "skill-report":
        request = read_request()
        if not isinstance(request, dict) or set(request) != {"action", "name"}:
            raise ValueError("invalid_request")
        action = request["action"]
        if action not in ("inspect", "audit", "diff"):
            raise ValueError("invalid_request")
        name = request["name"]
        if not isinstance(name, str) or SKILL_REFERENCE.fullmatch(name) is None:
            raise ValueError("invalid_request")
        try:
            result = subprocess.run([str(cli), "skills", action, name], capture_output=True, text=True,
                                    timeout=SKILL_REPORT_TIMEOUTS[action])
        except subprocess.TimeoutExpired:
            print(json.dumps({"error": "skill_%s_timeout" % action}))
            return 7
        if result.returncode:
            # The CLI explains refusals on stdout/stderr (e.g. "not tracked"); that reason belongs to the operator.
            print(json.dumps({"error": "skill_%s_failed" % action,
                              "detail": (result.stdout + result.stderr).strip()[-600:]}))
            return 6
        print(json.dumps(parse_skill_report(result.stdout, action, name)))
        return 0
    if sys.argv[1] == "skill-mutate":
        request = read_request()
        if not isinstance(request, dict) or set(request) != {"action", "name", "identifier", "force"}:
            raise ValueError("invalid_request")
        action = request["action"]
        if action not in SKILL_MUTATIONS:
            raise ValueError("invalid_request")
        name = request["name"]
        if not isinstance(name, str) or SKILL_NAME.fullmatch(name) is None:
            raise ValueError("invalid_request")
        identifier = request["identifier"]
        if action == "install":
            if not isinstance(identifier, str) or not 3 <= len(identifier) <= 300 or re.search(r"\s", identifier):
                raise ValueError("invalid_request")
        elif identifier is not None:
            raise ValueError("invalid_request")
        force = request["force"]
        if not isinstance(force, bool):
            raise ValueError("invalid_request")
        before = skill_list_rows(cli)
        present_before = any(row["name"] == name for row in before["skills"])
        skill_snapshot = snapshot_skill(home, action, name)
        argv = [str(cli), "skills", action]
        # install and uninstall ask for confirmation; without a TTY the prompt would block a headless invocation.
        # update has no prompt and rejects the flag, so it gets the plain name.
        argv.extend([identifier, "--yes"] if action == "install" else
                    [name, "--yes"] if action == "uninstall" else [name])
        if force:
            argv.append("--force")
        try:
            result = subprocess.run(argv, capture_output=True, text=True, timeout=SKILL_MUTATION_TIMEOUT,
                                    env=dict(os.environ, COLUMNS="400"))
        except subprocess.TimeoutExpired:
            if skill_snapshot is not None:
                restore_skill(skill_snapshot)
            print(json.dumps({"error": "skill_mutation_timeout", "restored": skill_snapshot is not None}))
            return 7
        text = (result.stdout + result.stderr).strip()
        try:
            after = skill_list_rows(cli)
        except ValueError:
            after = None
        present_after = after is not None and any(row["name"] == name for row in after["skills"])
        expected = action != "uninstall"
        if result.returncode or after is None or present_after != expected:
            restored = False
            if skill_snapshot is not None:
                restore_skill(skill_snapshot)
                restored = True
            elif present_after and not present_before:
                for directory in skill_directories(home, name):
                    shutil.rmtree(directory, ignore_errors=True)
                restored = True
            print(json.dumps({"error": "skill_mutation_failed", "restored": restored,
                              "previousPresent": present_before, "detail": text[-600:]}))
            return 6
        row = next((entry for entry in after["skills"] if entry["name"] == name), None)
        print(json.dumps({"action": action, "name": name, "installed": present_after,
                          "enabled": (row["state"] == "enabled") if row else None,
                          "snapshot": skill_snapshot.name if skill_snapshot is not None else None,
                          "text": text[:SKILL_MUTATION_TEXT_LIMIT], "bytes": len(text.encode("utf-8"))}))
        return 0
    if sys.argv[1] == "skill-governance":
        request = read_request()
        if not isinstance(request, dict) or set(request) != {"action", "path", "repo", "name"}:
            raise ValueError("invalid_request")
        if request["action"] not in GOVERNANCE_ACTIONS:
            raise ValueError("invalid_request")
        try:
            target = governance_target(home, request)
        except ValueError as error:
            # Shape errors stay `invalid_request` (exit 5); a refused target is a real answer with its own code.
            if str(error) in {"invalid_target", "missing_project_skills"}:
                print(json.dumps({"error": str(error)}))
                return 6
            raise
        try:
            result = subprocess.run(governance_argv(cli, request["action"], target), capture_output=True, text=True,
                                    timeout=GOVERNANCE_TIMEOUT, env=dict(os.environ, COLUMNS="400"))
        except subprocess.TimeoutExpired:
            print(json.dumps({"error": "skill_governance_timeout"}))
            return 7
        text = (result.stdout + result.stderr).strip()
        # `hermes skills tap remove <unknown>` prints "Error: Tap not found" and still exits 0, so the text decides.
        if result.returncode or text.startswith("Error:") or "\nError:" in text:
            print(json.dumps({"error": "skill_governance_failed", "detail": text[-600:]}))
            return 6
        confirmed = False
        if request["action"] == "reset":
            # `hermes skills reset` answers with a sentence about the manifest entry; the text has to name the skill.
            confirmed = target in text
        elif request["action"] in {"trust", "untrust"}:
            confirmed = target in text
        else:
            try:
                taps = skill_command_argv(cli, "tap-list", None, None, None, None)
                listing = subprocess.run(taps, capture_output=True, text=True, timeout=GOVERNANCE_TIMEOUT,
                                         env=dict(os.environ, COLUMNS="400"))
                listed = listing.stdout.lower()
                # The tap table shows the repository, so that is what a removal names and what an addition must show.
                present = target.lower() in listed
                confirmed = present if request["action"] == "tap-add" else not present
            except subprocess.TimeoutExpired:
                confirmed = False
        if not confirmed:
            print(json.dumps({"error": "skill_governance_unconfirmed", "detail": text[-600:]}))
            return 8
        print(json.dumps({"action": request["action"], "target": target,
                          "text": text[:SKILL_MUTATION_TEXT_LIMIT], "bytes": len(text.encode("utf-8"))}))
        return 0
    if sys.argv[1] == "skill-command":
        request = read_request()
        if not isinstance(request, dict) or set(request) != {"command", "name", "page", "size", "source"}:
            raise ValueError("invalid_request")
        command = request["command"]
        if command not in SKILL_COMMANDS:
            raise ValueError("invalid_request")
        name = request["name"]
        if command == "check":
            if name is not None and (not isinstance(name, str) or SKILL_NAME.fullmatch(name) is None):
                raise ValueError("invalid_request")
        elif name is not None:
            raise ValueError("invalid_request")
        page, size, source = request["page"], request["size"], request["source"]
        if command == "browse":
            if type(page) is not int or not 1 <= page <= 50 or type(size) is not int or not 1 <= size <= 50:
                raise ValueError("invalid_request")
            if source is not None and (not isinstance(source, str) or SKILL_SOURCE_TOKEN.fullmatch(source) is None):
                raise ValueError("invalid_request")
        elif page is not None or size is not None or source is not None:
            raise ValueError("invalid_request")
        try:
            result = subprocess.run(skill_command_argv(cli, command, name, page, size, source),
                                    capture_output=True, text=True, timeout=SKILL_COMMANDS[command],
                                    env=dict(os.environ, COLUMNS="400"))
        except subprocess.TimeoutExpired:
            print(json.dumps({"error": "skill_command_timeout"}))
            return 7
        if result.returncode:
            print(json.dumps({"error": "skill_command_failed",
                              "detail": (result.stdout + result.stderr).strip()[-600:]}))
            return 6
        text = result.stdout
        if len(text) > SKILL_REPORT_LIMIT:
            text = text[:SKILL_REPORT_LIMIT]
            truncated = True
        else:
            truncated = False
        if text.strip() == "":
            print(json.dumps({"error": "skill_report_empty"}))
            return 6
        print(json.dumps({"command": command, "name": name, "text": text.rstrip("\n"),
                          "bytes": len(result.stdout.encode("utf-8")), "truncated": truncated}))
        return 0
    if sys.argv[1] == "hub-search":
        request = read_request()
        if not isinstance(request, dict) or set(request) != {"query", "source", "limit"}:
            raise ValueError("invalid_request")
        query = request["query"]
        if not isinstance(query, str) or not 1 <= len(query) <= 120:
            raise ValueError("invalid_request")
        source = request["source"]
        if source is not None and (not isinstance(source, str) or not 1 <= len(source) <= 40):
            raise ValueError("invalid_request")
        limit = request["limit"]
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 50:
            raise ValueError("invalid_request")
        argv = [str(cli), "skills", "search", query, "--json", "--limit", str(limit)]
        if source is not None:
            argv.extend(["--source", source])
        try:
            result = subprocess.run(argv, capture_output=True, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            print(json.dumps({"error": "hub_search_timeout"}))
            return 7
        if result.returncode:
            print(json.dumps({"error": "hub_search_failed"}))
            return 6
        print(json.dumps(parse_hub_search(result.stdout, query, source)))
        return 0
    if sys.argv[1] == "modified-list":
        result = subprocess.run([str(cli), "skills", "list-modified", "--json"], capture_output=True,
                                text=True, timeout=skill_list_timeout())
        if result.returncode:
            print(json.dumps({"error": "modified_list_failed"}))
            return 6
        print(json.dumps(parse_modified_skills(result.stdout)))
        return 0
    if sys.argv[1] == "skills-list":
        # A wide COLUMNS keeps the table from eliding names; the parser rejects every other layout.
        result = subprocess.run([str(cli), "skills", "list", "--source", "all"], capture_output=True,
                                text=True, timeout=skill_list_timeout(), env=dict(os.environ, COLUMNS="400"))
        if result.returncode:
            print(json.dumps({"error": "skills_list_failed"}))
            return 6
        print(json.dumps(parse_skills_list(result.stdout)))
        return 0
    if sys.argv[1] == "auth-list":
        result = subprocess.run([str(cli), "auth", "list"], capture_output=True, text=True, timeout=15)
        if result.returncode:
            print(json.dumps({"error": "auth_list_failed"}))
            return 6
        print(json.dumps(parse_auth_list(result.stdout)))
        return 0
    config_path = Path(call("path"))
    commit = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=3)
    source_revision = commit.stdout.strip() if commit.returncode == 0 else None
    if sys.argv[1] == "approval-test":
        if source_revision != "d923a5eb487a17c0a68801bba9ef0f56c81040a8":
            raise ValueError("unsupported_source_revision")
        request = read_request()
        if (not isinstance(request, dict) or set(request) != {"command", "revision"} or
                type(request["command"]) is not str or not 1 <= len(request["command"]) <= 512 or
                not request["command"].strip() or
                any(ord(char) < 32 or ord(char) == 127 for char in request["command"]) or
                type(request["revision"]) is not int):
            raise ValueError("invalid_request")
        before, raw = snapshot(config_path)
        if before != request["revision"]:
            print(json.dumps({"error": "revision_conflict"}))
            return 4
        backend = nested(raw, "terminal.backend") or "local"
        if backend not in ("local", "docker"):
            raise ValueError("unsupported_execution_backend")
        sys.path.insert(0, str(source))
        from hermes_cli._launchers import runtime_command
        code = ("import json,sys; from hermes_cli.approvals_test import evaluate_command; "
                "request=json.load(sys.stdin); print(json.dumps(evaluate_command(request['command'], request['backend'])))")
        child = run_runtime_child(runtime_command(source, code=code),
                                  json.dumps({"command": request["command"], "backend": backend}), 15)
        try:
            verdict = json.loads(child.stdout)
        except (TypeError, ValueError):
            verdict = None
        allowed = {"allow": 0, "ask-approval": 2, "hardline-deny": 3, "user-deny": 3}
        if (child.returncode or not isinstance(verdict, dict) or
                verdict.get("env_type") != backend or verdict.get("command") != request["command"] or
                verdict.get("verdict") not in allowed or
                verdict.get("exit_code") != allowed[verdict["verdict"]] or
                not (verdict.get("rule") is None or
                     type(verdict["rule"]) is str and len(verdict["rule"]) <= 512) or
                type(verdict.get("detail")) is not str or len(verdict["detail"]) > 1024):
            raise ValueError("approval_test_unconfirmed")
        if revision(config_path) != before:
            print(json.dumps({"error": "revision_conflict"}))
            return 4
        # Native rule/detail may embed the submitted command or an operator's private glob.
        # The preview only needs the decision, so never return either native string.
        detail = {
            "allow": "Die aktuellen Hermes-Regeln wuerden diesen Befehl zulassen.",
            "ask-approval": "Die aktuellen Hermes-Regeln wuerden eine Freigabe anfordern.",
            "hardline-deny": "Die feste Hermes-Sperrliste wuerde diesen Befehl blockieren.",
            "user-deny": "Eine eigene Hermes-Sperrregel wuerde diesen Befehl blockieren.",
        }[verdict["verdict"]]
        print(json.dumps({"revision": before, "backend": backend, "verdict": verdict["verdict"],
                          "rule": None, "detail": detail}))
        return 0
    if sys.argv[1] in ("mcp-oauth-start", "mcp-oauth-status", "mcp-oauth-cancel"):
        if source_revision != "d923a5eb487a17c0a68801bba9ef0f56c81040a8":
            raise ValueError("unsupported_source_revision")
        request = read_request()
        action = sys.argv[1]
        if not isinstance(request, dict):
            raise ValueError("invalid_request")
        root = home / ".friday-mcp-oauth"
        if action == "mcp-oauth-start":
            if (set(request) != {"name", "revision", "ownerId"} or not valid_mcp_name(request["name"]) or
                    type(request["revision"]) is not int or type(request["ownerId"]) is not str or
                    not 1 <= len(request["ownerId"]) <= 128 or
                    any(ord(char) < 32 or ord(char) == 127 for char in request["ownerId"])):
                raise ValueError("invalid_request")
            before, raw = snapshot(config_path)
            if before != request["revision"]:
                print(json.dumps({"error": "revision_conflict"}))
                return 4
            entry = raw.get("mcp_servers", {}).get(request["name"]) if isinstance(raw.get("mcp_servers"), dict) else None
            token_path = home / "mcp-tokens" / f"{request['name']}.json"
            if (not isinstance(entry, dict) or set(entry) - {"url", "enabled", "auth"} or
                    entry.get("auth") not in (None, "oauth") or
                    entry.get("auth") == "oauth" and (token_path.exists() or token_path.is_symlink()) or
                    not valid_url(entry.get("url")) or entry.get("enabled", True) is not True):
                raise ValueError("managed_entry_conflict")
            if root.is_symlink():
                raise ValueError("unsafe_oauth_state")
            root.mkdir(mode=0o700, exist_ok=True)
            os.chmod(root, 0o700)
            for old_flow in root.iterdir():
                if (not re.fullmatch(r"[0-9a-f]{32}", old_flow.name) or old_flow.is_symlink() or
                        not old_flow.is_dir() or time.time() - old_flow.stat().st_mtime < 86400 or
                        old_flow.resolve().parent != root.resolve()):
                    continue
                from hermes_mcp_oauth_worker import discard_stage
                try:
                    discard_stage(old_flow)
                    for filename in ("owner.json", "worker.json", "state.json", "state.tmp", "cancel"):
                        path = old_flow / filename
                        if path.exists() or path.is_symlink():
                            path.unlink()
                    old_flow.rmdir()
                except OSError:
                    pass
            if len(list(root.iterdir())) >= 256:
                raise ValueError("oauth_flow_limit")
            flow_id = secrets.token_hex(16)
            flow_dir = root / flow_id
            flow_dir.mkdir(mode=0o700)
            fd = os.open(flow_dir / "owner.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as owner_file:
                json.dump({"ownerId": request["ownerId"]}, owner_file)
            from hermes_mcp_oauth_worker import write_state
            write_state(flow_dir, "starting")
            sys.path.insert(0, str(source))
            from hermes_cli._launchers import runtime_command
            helper = Path(__file__).with_name("hermes_mcp_oauth_worker.py")
            command = runtime_command(source, code=f"import runpy; runpy.run_path({str(helper)!r}, run_name='__main__')")
            timeout_binary = shutil.which("timeout")
            if not timeout_binary:
                raise ValueError("oauth_worker_timeout_unavailable")
            # GNU timeout kills the runtime process group even if an SDK DNS
            # lookup or slow-drip socket remains stuck in asyncio.to_thread.
            command = [timeout_binary, "--signal=KILL", "330s", *command]
            child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, start_new_session=True, text=True)
            child.stdin.write(json.dumps({"flowDir": str(flow_dir), "name": request["name"],
                "url": entry["url"], "revision": before, "configPath": str(config_path),
                "source": str(source)}))
            child.stdin.close()
            worker_path = flow_dir / "worker.json"
            fd = os.open(worker_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as worker_file:
                json.dump({"pid": child.pid, "start": process_start(child.pid)}, worker_file)
            deadline = time.monotonic() + 15
            state = {"status": "starting"}
            while time.monotonic() < deadline:
                state = json.loads((flow_dir / "state.json").read_text(encoding="utf-8"))
                if state.get("status") != "starting" or child.poll() is not None:
                    break
                time.sleep(0.1)
            print(json.dumps({"flowId": flow_id, **state}))
            return 0
        if (set(request) != {"flowId", "ownerId"} or type(request["flowId"]) is not str or
                re.fullmatch(r"[0-9a-f]{32}", request["flowId"]) is None or
                type(request["ownerId"]) is not str or not 1 <= len(request["ownerId"]) <= 128):
            raise ValueError("invalid_request")
        flow_dir = root / request["flowId"]
        if root.is_symlink() or flow_dir.is_symlink() or not flow_dir.is_dir():
            raise ValueError("unknown_oauth_flow")
        owner_path = flow_dir / "owner.json"
        if (owner_path.is_symlink() or owner_path.stat().st_size > 512 or
                not hmac.compare_digest(json.loads(owner_path.read_text(encoding="utf-8")).get("ownerId", ""),
                                        request["ownerId"])):
            raise ValueError("unknown_oauth_flow")
        state_lock = lock_config(home)
        try:
            state_path = flow_dir / "state.json"
            if state_path.is_symlink() or state_path.stat().st_size > 16384:
                raise ValueError("unsafe_oauth_state")
            state = json.loads(state_path.read_text(encoding="utf-8"))
            worker_path = flow_dir / "worker.json"
            if worker_path.is_symlink() or worker_path.stat().st_size > 128:
                raise ValueError("unsafe_oauth_state")
            worker = json.loads(worker_path.read_text(encoding="utf-8"))
            pid, started = worker.get("pid"), worker.get("start")
            worker_dead = type(pid) is not int or not isinstance(started, str) or process_start(pid) != started
            if worker_dead:
                from hermes_mcp_oauth_worker import discard_stage, write_state
                discard_stage(flow_dir)
                if state.get("status") in ("starting", "awaiting_approval", "publishing", "cancelling"):
                    write_state(flow_dir, "failed", failureClass="oauth_worker_unconfirmed")
                    state = {"status": "failed", "failureClass": "oauth_worker_unconfirmed"}
            if action == "mcp-oauth-cancel" and state.get("status") in ("starting", "awaiting_approval", "publishing"):
                try:
                    fd = os.open(flow_dir / "cancel", os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
                except FileExistsError:
                    pass
                else:
                    os.close(fd)
                state = {"status": "cancelling"}
            elif state.get("status") in ("starting", "awaiting_approval", "publishing") and \
                    time.time() - state.get("updatedAt", 0) > 350:
                state = {"status": "failed", "failureClass": "oauth_worker_unconfirmed"}
        finally:
            if state_lock is not None:
                fcntl.flock(state_lock, fcntl.LOCK_UN)
                state_lock.close()
        print(json.dumps({"flowId": request["flowId"], **state}))
        return 0
    if sys.argv[1] in ("provider-oauth-start", "provider-oauth-status", "provider-oauth-cancel"):
        if source_revision != "d923a5eb487a17c0a68801bba9ef0f56c81040a8":
            raise ValueError("unsupported_source_revision")
        import hermes_provider_oauth
        request = read_request()
        if sys.argv[1] == "provider-oauth-start":
            print(json.dumps(hermes_provider_oauth.start(home, source, request)))
        else:
            print(json.dumps(hermes_provider_oauth.status(home, request, cancel=sys.argv[1] == "provider-oauth-cancel")))
        return 0
    if sys.argv[1] == "mcp-probe":
        if source_revision != "d923a5eb487a17c0a68801bba9ef0f56c81040a8":
            raise ValueError("unsupported_source_revision")
        request = read_request()
        if (not isinstance(request, dict) or set(request) != {"name", "revision"} or
                not valid_mcp_name(request["name"]) or type(request["revision"]) is not int):
            raise ValueError("invalid_request")
        before, raw = snapshot(config_path)
        if before != request["revision"]:
            print(json.dumps({"error": "revision_conflict"}))
            return 4
        entry = raw.get("mcp_servers", {}).get(request["name"]) if isinstance(raw.get("mcp_servers"), dict) else None
        if (not isinstance(entry, dict) or not valid_url(entry.get("url")) or
                entry.get("enabled", True) is not True):
            raise ValueError("unprobeable_server")
        if set(entry) <= {"url", "enabled"}:
            from hermes_mcp_protocol_probe import ProbeFailure, probe
            try:
                result = probe(entry["url"])
            except ProbeFailure as exc:
                result = {"connected": False, "toolCount": None, "toolCountComplete": False,
                          "failureClass": exc.failure_class}
        elif (re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", request["name"]) and
              set(entry) <= {"url", "enabled", "headers"} and
              entry.get("headers") == {"Authorization": "Bearer ${MCP_" + request["name"].upper() + "_API_KEY}"}):
            sys.path.insert(0, str(source))
            from hermes_cli._launchers import runtime_command
            helper = Path(__file__).with_name("hermes_mcp_auth_probe.py")
            command = runtime_command(source, code=f"import runpy; runpy.run_path({str(helper)!r}, run_name='__main__')")
            child = run_runtime_child(command, json.dumps({"name": request["name"], "url": entry["url"],
                "revision": before, "configPath": str(config_path)}), 28)
            try:
                result = json.loads(child.stdout)
            except (ValueError, TypeError):
                result = None
            if child.returncode or not isinstance(result, dict) or set(result) != {
                    "connected", "toolCount", "toolCountComplete", "failureClass"}:
                raise ValueError("mcp_probe_unconfirmed")
        else:
            raise ValueError("unprobeable_server")
        if revision(config_path) != before:
            print(json.dumps({"error": "revision_conflict"}))
            return 4
        print(json.dumps({"name": request["name"], "revision": before, **result}))
        return 0
    if sys.argv[1] == "pairing":
        if not source_revision or not source_revision.startswith(PINNED_SOURCE):
            raise ValueError("unsupported_source_revision")
        request = read_request()
        keys = set(request) if isinstance(request, dict) else set()
        valid = keys == {"action"} and request["action"] == "list" or (
            keys == {"action", "platform", "requestId"} and request["action"] == "approve" and
            request["platform"] in PAIRING_PLATFORMS and isinstance(request["requestId"], str) and
            re.fullmatch(r"[0-9a-f]{16}", request["requestId"]) is not None) or (
            keys == {"action", "platform", "userId"} and request["action"] == "revoke" and
            request["platform"] in PAIRING_PLATFORMS and isinstance(request["userId"], str) and
            PAIRING_USER_ID.fullmatch(request["userId"]) is not None)
        if not valid:
            raise ValueError("invalid_request")
        sys.path.insert(0, str(source))
        from hermes_cli._launchers import runtime_command
        helper = Path(__file__).with_name("hermes_pairing_store.py")
        command = runtime_command(source, code=f"import runpy; runpy.run_path({str(helper)!r}, run_name='__main__')")
        result = run_runtime_child(command, json.dumps(request), 25)
        response = json.loads(result.stdout)
        if result.returncode == 4 and isinstance(response, dict) and response.get("error") in ("pairing_request_not_found", "pairing_user_not_found"):
            print(json.dumps({"error": response["error"]}))
            return 4
        if result.returncode or not isinstance(response, dict) or not isinstance(response.get("platforms"), list):
            raise ValueError("pairing_unavailable")
        print(json.dumps({"platforms": response["platforms"]}))
        return 0
    if sys.argv[1] == "model-catalog":
        if not source_revision or not source_revision.startswith(PINNED_SOURCE):
            raise ValueError("unsupported_source_revision")
        request = read_request()
        provider_id = request.get("providerId") if isinstance(request, dict) and set(request) == {"providerId"} else False
        if provider_id is False or not (provider_id is None or
                                        isinstance(provider_id, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", provider_id)):
            raise ValueError("invalid_request")
        sys.path.insert(0, str(source))
        from hermes_cli._launchers import runtime_command
        probe = Path(__file__).with_name("hermes_model_catalog.py")
        command = runtime_command(source, code=f"import runpy; runpy.run_path({str(probe)!r}, run_name='__main__')")
        result = run_runtime_child(command, json.dumps(request), 25)
        response = json.loads(result.stdout)
        if result.returncode and isinstance(response, dict) and response.get("error") == "unknown_provider":
            raise ValueError("unknown_provider")
        if result.returncode or not isinstance(response, dict) or not isinstance(response.get("providers"), list):
            raise ValueError("catalog_unavailable")
        print(json.dumps({"sourceRevision": source_revision, "providers": response["providers"],
                          "selected": response.get("selected")}))
        return 0
    if sys.argv[1] == "provider-auth":
        if not source_revision or not source_revision.startswith(PINNED_SOURCE):
            raise ValueError("unsupported_source_revision")
        request = read_request()
        if (not isinstance(request, dict) or set(request) != {"names"} or
                not isinstance(request["names"], list) or not 1 <= len(request["names"]) <= 8 or
                any(not isinstance(name, str) or re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", name) is None
                    for name in request["names"])):
            raise ValueError("invalid_request")
        sys.path.insert(0, str(source))
        from hermes_cli._launchers import runtime_command
        probe = Path(__file__).with_name("hermes_provider_auth.py")
        command = runtime_command(source, code=f"import runpy; runpy.run_path({str(probe)!r}, run_name='__main__')")
        result = run_runtime_child(command, json.dumps(request), 25)
        response = json.loads(result.stdout)
        if result.returncode or not isinstance(response, dict) or not isinstance(response.get("providers"), list):
            raise ValueError("capability_unavailable")
        print(json.dumps({"sourceRevision": source_revision, "providers": response["providers"],
                          "keyPrefixes": response.get("keyPrefixes") or {}}))
        return 0
    if sys.argv[1] in ("update", "credential-update", "plugin-activation", "mcp-http", "mcp-activation", "mcp-bearer"):
        if not source_revision or not source_revision.startswith(PINNED_SOURCE):
            raise ValueError("unsupported_source_revision")
        request = read_request()
        plugin_update = sys.argv[1] == "plugin-activation"
        mcp_activation = sys.argv[1] == "mcp-activation"
        mcp_update = sys.argv[1] in ("mcp-http", "mcp-activation")
        mcp_bearer = sys.argv[1] == "mcp-bearer"
        expected_keys = ({"pluginId", "enabled", "revision"} if plugin_update else
                         {"name", "enabled", "revision"} if mcp_activation else
                         {"name", "token", "revision"} if mcp_bearer else
                         {"name", "url", "enabled", "revision"} if mcp_update else
                         {"key", "value", "revision"})
        if not isinstance(request, dict) or set(request) != expected_keys:
            raise ValueError("invalid_request")
        key = ("plugin:" + request["pluginId"] if plugin_update and isinstance(request["pluginId"], str) else
               "mcp:" + request["name"] if (mcp_update or mcp_bearer) and isinstance(request["name"], str) else request.get("key"))
        value = request["enabled"] if plugin_update or mcp_update else request.get("token") if mcp_bearer else request["value"]
        credential_update = sys.argv[1] == "credential-update"
        spec = FIELDS.get(key) if not (plugin_update or mcp_update or mcp_bearer) else None
        if type(request["revision"]) is not int or (plugin_update and
                (not valid_plugin_id(request["pluginId"]) or
                 type(value) is not bool)) or (mcp_update and
                 (not valid_mcp_name(request["name"]) or type(value) is not bool or
                  not (mcp_activation or request["url"] is None and value is False or
                       type(request["url"]) is str and len(request["url"]) <= 2048))) or (credential_update and
                 (key not in MODEL_CREDENTIALS or not (value is None or
                 (isinstance(value, str) and 1 <= len(value) <= 4096 and
                  all(32 <= ord(char) <= 126 for char in value))))) or \
                 (mcp_bearer and (type(request["name"]) is not str or
                  re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", request["name"]) is None or
                  not (request["token"] is None or type(request["token"]) is str and
                       1 <= len(request["token"]) <= 4096 and
                       all(33 <= ord(char) <= 126 for char in request["token"])))) or \
                (not credential_update and not plugin_update and not mcp_update and not mcp_bearer and
                 (not spec or not valid_field_value(key, value, spec))):
            raise ValueError("unsupported_field")
        lock = lock_config(home)
        try:
            before, _raw_before = snapshot(config_path)
            if request["revision"] != before or revision(config_path) != before:
                print(json.dumps({"error": "revision_conflict"}))
                return 4
            if key in ("terminal.docker_mount_cwd_to_workspace", "terminal.docker_volumes") and \
                    nested(_raw_before, "terminal.backend") not in ("docker",):
                raise ValueError("execution_backend_required")
            if key == "model.base_url" and str(nested(_raw_before, "model.provider") or "").strip().lower() != "custom":
                raise ValueError("custom_provider_required")
            if key == "terminal.cwd" and value != ".":
                workspace = Path(value)
                if (workspace.is_symlink() or not workspace.is_dir() or
                        not workspace.resolve().is_relative_to(home.parent.resolve()) or
                        workspace.resolve().is_relative_to(home.resolve())):
                    raise ValueError("invalid_execution_workspace")
            if key == "terminal.docker_volumes":
                for mount in value:
                    host_path, separator, container_path = mount.partition(":")
                    host = Path(host_path)
                    if (not separator or ":" in container_path or host.is_symlink() or not host.is_dir() or
                            not host.resolve().is_relative_to(home.parent.resolve()) or
                            host.resolve().is_relative_to(home.resolve()) or
                            not re.fullmatch(r"/workspace/mounts/[A-Za-z][A-Za-z0-9_-]{0,63}", container_path)):
                        raise ValueError("invalid_docker_mount")
            if key == "toolsets":
                sys.path.insert(0, str(source))
                from toolsets import TOOLSETS
                if not value or not set(value) <= set(TOOLSETS):
                    raise ValueError("unknown_toolset")
            if key == "command_allowlist":
                prior = nested(_raw_before, "command_allowlist")
                if not isinstance(prior, list) or not all(isinstance(item, str) for item in prior) or \
                        not set(value) <= set(prior):
                    raise ValueError("allowlist_addition_requires_native_approval")
            if key == "terminal.backend" and value == "docker":
                if (nested(_raw_before, "terminal.docker_network") is not False or
                        nested(_raw_before, "terminal.docker_mount_cwd_to_workspace") is True or
                        nested(_raw_before, "terminal.docker_volumes") not in (None, [])):
                    raise ValueError("docker_policy_requires_safe_baseline")
                docker = shutil.which("docker")
                if not docker or subprocess.run([docker, "info", "--format", "{{.ServerVersion}}"],
                                                capture_output=True, timeout=5).returncode:
                    raise ValueError("docker_unavailable")
            if key == "computer_use.permission_mode" and value == "bounded":
                manifest = nested(_raw_before, "computer_use.capability_manifest")
                if not isinstance(manifest, str) or not manifest:
                    raise ValueError("capability_manifest_required")
            if key == "computer_use.capability_manifest" and value:
                manifest_path = Path(value)
                if (manifest_path.is_symlink() or not manifest_path.is_file() or
                        manifest_path.stat().st_size > 65536 or
                        not manifest_path.resolve().is_relative_to(home.resolve())):
                    raise ValueError("invalid_capability_manifest")
            if key == "computer_use.capability_manifest" and not value and \
                    nested(_raw_before, "computer_use.permission_mode") == "bounded":
                raise ValueError("capability_manifest_required")
            if key == "browser.use_real_profile" and value is True and \
                    not nested(_raw_before, "browser.real_profile_pin"):
                raise ValueError("profile_pin_required")
            if key == "browser.real_profile_pin" and not value and \
                    nested(_raw_before, "browser.use_real_profile") is True:
                raise ValueError("profile_pin_required")
            if key == "browser.allow_unsafe_evaluate" and value and nested(_raw_before, "browser.restrict_evaluate") is True:
                raise ValueError("conflicting_browser_evaluate_policy")
            if key == "browser.restrict_evaluate" and value and nested(_raw_before, "browser.allow_unsafe_evaluate") is True:
                raise ValueError("conflicting_browser_evaluate_policy")
            if plugin_update:
                prior = subprocess.run([str(cli), "plugins", "list", "--json", "--user"],
                                       capture_output=True, text=True, timeout=15)
                try:
                    entries = json.loads(prior.stdout)
                except ValueError:
                    entries = None
                matches = [row for row in entries if isinstance(row, dict) and
                           row.get("name") == request["pluginId"]] if isinstance(entries, list) else []
                if prior.returncode or len(matches) != 1 or matches[0].get("status") not in (
                    "enabled", "disabled", "not enabled") or matches[0].get("removed"):
                    raise ValueError("unknown_plugin")
                sys.path.insert(0, str(source))
                from hermes_cli._launchers import runtime_command
                helper = Path(__file__).with_name("hermes_plugin_activation.py")
                command = runtime_command(source, code=f"import runpy; runpy.run_path({str(helper)!r}, run_name='__main__')")
                result = run_runtime_child(command, json.dumps({"pluginId": request["pluginId"], "enabled": value}), 30)
                try:
                    accepted = json.loads(result.stdout).get("ok") is True
                except (ValueError, TypeError):
                    accepted = False
                if result.returncode or not accepted:
                    raise ValueError("plugin_activation_unconfirmed")
            if mcp_update:
                mcp_url = request.get("url")
                if mcp_activation:
                    existing = _raw_before.get("mcp_servers", {}).get(request["name"]) if isinstance(
                        _raw_before.get("mcp_servers"), dict) else None
                    if (not isinstance(existing, dict) or set(existing) - {"url", "enabled"} or
                            not valid_url(existing.get("url"))):
                        raise ValueError("managed_entry_conflict")
                    mcp_url = existing["url"]
                sys.path.insert(0, str(source))
                from hermes_cli._launchers import runtime_command
                helper = Path(__file__).with_name("hermes_mcp_http_apply.py")
                command = runtime_command(source, code=f"import runpy; runpy.run_path({str(helper)!r}, run_name='__main__')")
                result = run_runtime_child(command, json.dumps({"name": request["name"],
                    "url": mcp_url, "enabled": value}), 30)
                try:
                    accepted = json.loads(result.stdout).get("saved") is True
                except (ValueError, TypeError):
                    accepted = False
                if result.returncode or not accepted:
                    raise ValueError("mcp_write_unconfirmed")
            if mcp_bearer:
                existing = _raw_before.get("mcp_servers", {}).get(request["name"]) if isinstance(
                    _raw_before.get("mcp_servers"), dict) else None
                if not isinstance(existing, dict) or not valid_url(existing.get("url")):
                    raise ValueError("managed_entry_conflict")
                env_lock = lock_config(home, ".obsidian-vault.lock")
                try:
                    sys.path.insert(0, str(source))
                    from hermes_cli._launchers import runtime_command
                    helper = Path(__file__).with_name("hermes_mcp_bearer_apply.py")
                    command = runtime_command(source, code=f"import runpy; runpy.run_path({str(helper)!r}, run_name='__main__')")
                    result = run_runtime_child(command, json.dumps({"name": request["name"],
                        "token": request["token"], "expectedUrl": existing["url"],
                        "expectedRevision": before, "configPath": str(config_path)}), 30)
                    try:
                        accepted = json.loads(result.stdout).get("saved") is True
                    except (ValueError, TypeError):
                        accepted = False
                    if result.returncode or not accepted:
                        raise ValueError("mcp_credential_unconfirmed")
                finally:
                    fcntl.flock(env_lock, fcntl.LOCK_UN)
                    env_lock.close()
            if key == "skills.disabled":
                roots, root_errors = inventory_roots(home, call)
                names, scan_errors = installed_skills(roots)
                if root_errors or scan_errors or "hermes-agent" in value or not set(value) <= set(names):
                    raise ValueError("invalid_value")
            if credential_update:
                apply_env_value(home, source, key, value)
            elif not plugin_update and not mcp_update and not mcp_bearer:
                # Hermes owns validation and preserving the rest of config.yaml. Never --force.
                call("set", key, json.dumps(value, separators=(",", ":")) if isinstance(value, list) else
                     "null" if value is None else str(value).lower() if isinstance(value, bool) else str(value))
                if key == "model.base_url":
                    # Hermes binds OPENAI_API_KEY only to the OPENAI_BASE_URL host, so both must name the same endpoint.
                    apply_env_value(home, source, "OPENAI_BASE_URL", value)
                if key == "model.provider" and str(value).strip().lower() != "custom" and \
                        str(nested(_raw_before, "model.provider") or "").strip().lower() == "custom":
                    # The OPENAI_BASE_URL binding belongs to the custom endpoint; left behind it would send a later OpenAI key there.
                    apply_env_value(home, source, "OPENAI_BASE_URL", None)
                if key == "browser.use_real_profile" and value is False:
                    # Revocation must remove credential snapshots now, rather
                    # than waiting for the next browser tool invocation.
                    snapshot_root = home / "browser-profile"
                    if snapshot_root.is_symlink():
                        raise ValueError("profile_snapshot_cleanup_failed")
                    if snapshot_root.exists():
                        shutil.rmtree(snapshot_root)
                    if snapshot_root.exists():
                        raise ValueError("profile_snapshot_cleanup_failed")
            current, raw = snapshot(config_path)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()
    else:
        current, raw = snapshot(config_path)
    write_key = key if sys.argv[1] in ("plugin-activation", "mcp-http", "mcp-activation", "mcp-bearer") else None
    values = {}
    for key in FIELDS:
        if key != "skills.disabled":
            values[key] = json.loads(call("get", key, "--json"))
    try:
        disabled_skills = json.loads(call("get", "skills.disabled", "--json"))
        # Hermes get reports an unset optional key as null; skill_utils resolves that to an empty set.
        if disabled_skills is None and nested(raw, "skills.disabled") is None:
            disabled_skills = []
    except (ValueError, json.JSONDecodeError):
        disabled_skills = None
    values["skills.disabled"] = disabled_skills
    explicit = {key: nested(raw, key) is not None for key in FIELDS}
    # Only safe, typed leaves cross the bridge; provider credentials and arbitrary YAML do not.
    for key, spec in FIELDS.items():
        if key == "fallback_model" and isinstance(values[key], dict):
            values[key] = [values[key]]
        if not valid_field_value(key, values[key], spec) and values[key] is not None:
            values[key] = None
    roots, root_errors = inventory_roots(home, call)
    skill_names, skill_errors = installed_skills(roots, report_missing=True)
    if not isinstance(disabled_skills, list) or not all(isinstance(name, str) for name in disabled_skills):
        disabled_skills = None
        skill_errors.append("skill_activation_unknown")
    disabled_set = set(disabled_skills) if disabled_skills is not None else set()
    plugin_errors = []
    try:
        result = subprocess.run([str(cli), "plugins", "list", "--json", "--user"], capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise ValueError("plugin_list_failed")
        plugin_rows = json.loads(result.stdout)
        if not isinstance(plugin_rows, list) or not all(isinstance(row, dict) and isinstance(row.get("name"), str)
                                                        and isinstance(row.get("status"), str) for row in plugin_rows):
            raise ValueError("plugin_list_invalid")
    except (ValueError, json.JSONDecodeError, subprocess.TimeoutExpired):
        plugin_rows = []
        plugin_errors.append("plugin_inventory_unknown")
    mcp_rows, mcp_errors = [], []
    env_lines = (home / ".env").read_text(encoding="utf-8-sig").splitlines() if (home / ".env").exists() else []
    env_names = {line.partition("=")[0].strip() for line in env_lines if "=" in line and
                 line.partition("=")[2].strip().strip('"')}
    mcp_config = raw.get("mcp_servers")
    if mcp_config is not None and not isinstance(mcp_config, dict):
        mcp_errors.append("mcp_inventory_unknown")
    elif isinstance(mcp_config, dict):
        for name, entry in mcp_config.items():
            if not isinstance(name, str) or not isinstance(entry, dict):
                mcp_errors.append("mcp_inventory_unknown")
                continue
            transport = "http" if isinstance(entry.get("url"), str) else "stdio" if isinstance(entry.get("command"), str) else "unknown"
            endpoint = None
            if transport == "http":
                try:
                    parts = urlsplit(entry["url"])
                    if parts.scheme in ("https", "http") and parts.hostname and not parts.username and not parts.password:
                        endpoint = f"{parts.scheme}://{parts.hostname}"
                except ValueError:
                    pass
            env_key = "MCP_" + re.sub(r"[^A-Za-z0-9_]", "_", name.upper()).strip("_") + "_API_KEY"
            bearer_template = {"Authorization": "Bearer ${" + env_key + "}"}
            auth_mode = ("oauth" if entry.get("auth") == "oauth" else
                         "bearer" if entry.get("headers") == bearer_template else
                         "none" if "auth" not in entry and "headers" not in entry else "unknown")
            mcp_rows.append({"id": name, "transport": transport,
                             "enabled": entry.get("enabled", True) if type(entry.get("enabled", True)) is bool else None,
                             "endpoint": endpoint,
                             "authMode": auth_mode,
                             "credentialConfigured": env_key in env_names if auth_mode == "bearer" else
                                                     (not (home / "mcp-tokens" / f"{name}.json").is_symlink() and
                                                      (home / "mcp-tokens" / f"{name}.json").is_file())
                                                     if auth_mode == "oauth" and
                                                        re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name) else None,
                             "editable": transport == "http" and set(entry) <= {"url", "enabled"} and
                                         valid_url(entry.get("url"))})
    if revision(config_path) != current:
        raise ValueError("concurrent_config_change")
    configured_providers = raw.get("providers")
    provider_names = set(configured_providers) if isinstance(configured_providers, dict) else set()
    current_provider = values.get("model.provider")
    if current_provider:
        provider_names.add(current_provider)
    invalid_provider_names = any(not valid_field_value("model.provider", name, FIELDS["model.provider"])
                                 for name in provider_names)
    provider_names = sorted(name for name in provider_names if
                            valid_field_value("model.provider", name, FIELDS["model.provider"]))
    # This list covers the configured profile only. Hermes' picker can also offer
    # installed providers and curated models, so it is not a complete catalog.
    inventory_reasons = sorted(set(root_errors + skill_errors + plugin_errors + mcp_errors +
                                   ["provider_catalog_not_enumerated"] +
                                   (["model_provider_name_unsupported"] if invalid_provider_names else [])))
    from_env = {key: False for key in MODEL_CREDENTIALS}
    env_path = home / ".env"
    if env_path.exists():
        # Only a key at the start of an assignment counts; values never leave the bridge.
        for line in env_path.read_text(encoding="utf-8").splitlines():
            name, separator, candidate = line.partition("=")
            if separator and name in MODEL_CREDENTIALS and candidate.strip().strip('"'):
                from_env[name] = True
    write = None
    if sys.argv[1] == "plugin-activation":
        matches = [row for row in plugin_rows if row.get("name") == request["pluginId"]]
        write = {"key": write_key, "persisted": len(matches) == 1 and
                 matches[0].get("status") in ("enabled", "disabled", "not enabled") and
                 (matches[0]["status"] == "enabled") == value}
    elif sys.argv[1] in ("mcp-http", "mcp-activation"):
        persisted = (not isinstance(mcp_config, dict) or request["name"] not in mcp_config) if not mcp_activation and request["url"] is None else (
            isinstance(mcp_config, dict) and mcp_config.get(request["name"]) ==
            {"url": mcp_url, "enabled": value})
        write = {"key": write_key, "persisted": persisted and not mcp_errors}
    elif sys.argv[1] == "mcp-bearer":
        entry = mcp_config.get(request["name"]) if isinstance(mcp_config, dict) else None
        env_key = "MCP_" + request["name"].upper() + "_API_KEY"
        persisted = isinstance(entry, dict) and (entry.get("headers") ==
            {"Authorization": "Bearer ${" + env_key + "}"}) == (request["token"] is not None) and \
            (env_key in env_names) == (request["token"] is not None)
        write = {"key": write_key, "persisted": persisted and not mcp_errors}
    elif sys.argv[1] == "update":
        write = {"key": request["key"], "persisted": values[request["key"]] == request["value"]}
    elif sys.argv[1] == "credential-update":
        write = {"key": request["key"], "persisted": from_env.get(request["key"], False) ==
                 (request["value"] is not None)}
    print(json.dumps({
        "installed": True, "revision": current, "sourceRevision": source_revision,
        "values": values, "explicit": explicit,
        "secrets": {"model.api_key": bool(nested(raw, "model.api_key")),
                    **from_env},
        "families": [{"id": name, "roots": roots, "followup": followup,
                      "configFileSet": any(nested(raw, root) is not None for root in roots)} for name, roots, followup in FAMILIES],
        "inventory": {"scope": "profile", "skillsComplete": not (root_errors or skill_errors),
                      "pluginsComplete": not plugin_errors, "modelProvidersComplete": False,
                      "reasons": inventory_reasons},
        "modelProviders": [{"id": name,
                            "configFileSet": (isinstance(configured_providers, dict) and name in configured_providers) or
                                             nested(raw, "model.provider") == name,
                            "authenticated": None, "available": None} for name in provider_names],
        "skills": [{"id": name, "installed": True,
                    "enabled": True if name == "hermes-agent" else None if disabled_skills is None else name not in disabled_set}
                   for name in skill_names],
        "plugins": [{"id": row["name"], "installed": True,
                     "enabled": True if row["status"] == "enabled" else False if row["status"] in ("disabled", "not enabled") else None,
                     "configured": None} for row in plugin_rows],
        "mcpServers": mcp_rows, "mcpComplete": not mcp_errors,
        "write": write,
    }))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, ImportError, subprocess.TimeoutExpired) as error:
        message = str(error)
        canonical = message in {"config_symlink", "invalid_request", "unsupported_field", "invalid_value", "unknown_provider",
            "managed_entry_conflict", "unknown_oauth_flow", "oauth_flow_limit", "unsafe_oauth_state", "unsupported_source_revision",
            "execution_backend_required", "docker_policy_requires_safe_baseline", "docker_unavailable", "invalid_execution_workspace", "invalid_docker_mount",
            "capability_manifest_required", "invalid_capability_manifest", "conflicting_browser_evaluate_policy",
            "unknown_toolset", "allowlist_addition_requires_native_approval", "profile_snapshot_cleanup_failed",
            "profile_pin_required", "custom_provider_required", "pairing_unavailable"}
        # "hermes_unavailable" used to swallow the real reason (missing binary, broken profile, parse error) and the
        # operator only saw an unreachable distro. Keep the canonical code, add what actually happened.
        payload = {"error": message if canonical else "hermes_unavailable"}
        if not canonical and message and message != "hermes_unavailable":
            payload["detail"] = message[-400:]
        print(json.dumps(payload))
        raise SystemExit(5)
