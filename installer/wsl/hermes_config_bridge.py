#!/usr/bin/env python3
"""Narrow Friday bridge to the installed Hermes config API. No raw config leaves this process."""

import hashlib
import hmac
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
    "browser.command_timeout": ("integer", 5, 600),
    "browser.snapshot_threshold": ("integer", 1000, 200000),
    "skills.disabled": ("skill_names", None, None),
}
MODEL_CREDENTIALS = frozenset(("OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"))
REASONING_EFFORTS = frozenset(("", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"))


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
    if kind == "fallback":
        return (type(value) is list and len(value) <= 8 and all(
            type(item) is dict and set(item) == {"provider", "model"} and
            valid_field_value("model.provider", item["provider"], FIELDS["model.provider"]) and
            valid_field_value("model.default", item["model"], FIELDS["model.default"])
            for item in value))
    if kind == "skill_names":
        return (type(value) is list and len(value) <= 512 and len(set(value)) == len(value) and
                all(type(name) is str and re.fullmatch(r"[A-Za-z0-9._/-]{1,100}", name) for name in value))
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


def installed_skills(roots):
    """Profile roots, with the same recursive/pruned SKILL.md scan as agent.skill_utils."""
    result, errors = {}, []
    for root in roots:
        if not root.exists():
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


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("status", "update", "credential-update", "plugin-activation", "mcp-http", "mcp-activation", "mcp-bearer", "mcp-probe", "mcp-oauth-start", "mcp-oauth-status", "mcp-oauth-cancel", "model-catalog"):
        return 2
    home = Path.home() / ".hermes"
    source = home / "hermes-agent"
    cli = home.parent / ".local" / "bin" / "hermes"
    if not source.is_dir() or not cli.is_file():
        print(json.dumps({"error": "hermes_not_installed"}))
        return 5
    return locked_main(home, source, cli)


def locked_main(home, source, cli):
    def call(*args):
        result = subprocess.run([str(cli), "config", *args], capture_output=True, text=True, timeout=15)
        if result.returncode:
            if len(args) == 3 and args[0] == "get" and args[2] == "--json" and \
                    (result.stdout + result.stderr).strip() == f"Config key not set: {args[1]}":
                return "null"
            raise ValueError("hermes_config_failed")
        return result.stdout.strip()

    config_path = Path(call("path"))
    commit = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=3)
    source_revision = commit.stdout.strip() if commit.returncode == 0 else None
    if sys.argv[1] in ("mcp-oauth-start", "mcp-oauth-status", "mcp-oauth-cancel"):
        if source_revision != "d923a5eb487a17c0a68801bba9ef0f56c81040a8":
            raise ValueError("unsupported_source_revision")
        request = json.load(sys.stdin)
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
    if sys.argv[1] == "mcp-probe":
        if source_revision != "d923a5eb487a17c0a68801bba9ef0f56c81040a8":
            raise ValueError("unsupported_source_revision")
        request = json.load(sys.stdin)
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
    if sys.argv[1] == "model-catalog":
        if not source_revision or not source_revision.startswith(PINNED_SOURCE):
            raise ValueError("unsupported_source_revision")
        request = json.load(sys.stdin)
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
    if sys.argv[1] in ("update", "credential-update", "plugin-activation", "mcp-http", "mcp-activation", "mcp-bearer"):
        if not source_revision or not source_revision.startswith(PINNED_SOURCE):
            raise ValueError("unsupported_source_revision")
        request = json.load(sys.stdin)
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
                # The CLI accepts secrets only in argv. Use its Python closure with stdin instead.
                env_lock = lock_config(home, ".obsidian-vault.lock")
                try:
                    sys.path.insert(0, str(source))
                    from hermes_cli._launchers import runtime_command
                    probe = Path(__file__).with_name("hermes_model_credential_apply.py")
                    command = runtime_command(source, code=f"import runpy; runpy.run_path({str(probe)!r}, run_name='__main__')")
                    result = run_runtime_child(command, json.dumps({"key": key, "value": value}), 30)
                    try:
                        saved = json.loads(result.stdout).get("saved") is True
                    except (ValueError, TypeError):
                        saved = False
                    if result.returncode or not saved:
                        raise ValueError("credential_readback_failed")
                finally:
                    fcntl.flock(env_lock, fcntl.LOCK_UN)
                    env_lock.close()
            elif not plugin_update and not mcp_update and not mcp_bearer:
                # Hermes owns validation and preserving the rest of config.yaml. Never --force.
                call("set", key, json.dumps(value, separators=(",", ":")) if isinstance(value, list) else
                     "null" if value is None else str(value).lower() if isinstance(value, bool) else str(value))
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
    skill_names, skill_errors = installed_skills(roots)
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
        print(json.dumps({"error": str(error) if str(error) in {"config_symlink", "invalid_request", "unsupported_field", "invalid_value", "unknown_provider", "managed_entry_conflict", "unknown_oauth_flow", "oauth_flow_limit", "unsafe_oauth_state", "unsupported_source_revision"} else "hermes_unavailable"}))
        raise SystemExit(5)
