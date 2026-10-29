#!/usr/bin/env python3
"""One isolated, revision-bound Hermes MCP PKCE login for Friday."""

import asyncio
import fcntl
import json
import os
import re
import signal
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_config_bridge import lock_config, revision, snapshot
from hermes_mcp_http_apply import valid_url
from hermes_mcp_oauth_transport import OAuthTransportFailure, endpoint_parts, public_address, make_transport

PINNED_SOURCE = "d923a5eb487a17c0a68801bba9ef0f56c81040a8"
FLOW_SECONDS = 300
HARD_DEADLINE_SECONDS = 330


def write_state(flow_dir, status, **fields):
    state = {"status": status, "updatedAt": int(time.time()), **fields}
    temporary = flow_dir / "state.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(state, output, separators=(",", ":"))
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, flow_dir / "state.json")


def discard_stage(flow_dir):
    stage = flow_dir / "stage"
    tokens = stage / "mcp-tokens"
    if stage.is_symlink() or tokens.is_symlink():
        return
    if tokens.is_dir():
        for path in tokens.iterdir():
            if path.is_file() or path.is_symlink():
                path.unlink()
        tokens.rmdir()
    if stage.is_dir():
        stage.rmdir()


def current_entry(config_path, name, url, expected_revision):
    current, raw = snapshot(config_path)
    entries = raw.get("mcp_servers")
    entry = entries.get(name) if isinstance(entries, dict) else None
    if current != expected_revision:
        raise ValueError("revision_conflict")
    if (not isinstance(entry, dict) or set(entry) - {"url", "enabled", "auth"} or
            entry.get("url") != url or entry.get("enabled", True) is not True):
        raise ValueError("managed_entry_conflict")
    if entry.get("auth") not in (None, "oauth"):
        raise ValueError("managed_entry_conflict")
    token_path = config_path.parent / "mcp-tokens" / f"{name}.json"
    if entry.get("auth") == "oauth" and (token_path.exists() or token_path.is_symlink()):
        raise ValueError("oauth_credential_conflict")
    return entry


def publish(flow_dir, config_path, name, url, expected_revision, storage):
    from hermes_cli.mcp_config import _get_mcp_servers, _save_mcp_server

    lock = lock_config(config_path.parent)
    try:
        if (flow_dir / "cancel").exists():
            raise ValueError("oauth_cancelled")
        original_entry = current_entry(config_path, name, url, expected_revision)
        if _get_mcp_servers().get(name) != original_entry:
            raise ValueError("managed_entry_conflict")
        real_storage = type(storage)(name)
        stage_files = storage._state_paths()
        if not storage.has_cached_tokens() or any(path.is_symlink() for path in stage_files):
            raise ValueError("oauth_token_unconfirmed")
        # A pre-existing native login belongs to another flow and must not be overwritten.
        destinations = (real_storage._tokens_path(), real_storage._client_info_path(),
                        real_storage._meta_path())
        if any(path.exists() or path.is_symlink() for path in destinations):
            raise ValueError("oauth_credential_conflict")
        new_entry = {"url": url, "enabled": True, "auth": "oauth"}
        if not _save_mcp_server(name, new_entry):
            raise ValueError("config_rejected")
        after_save_revision = revision(config_path)
        written = []
        try:
            if (flow_dir / "cancel").exists():
                raise ValueError("oauth_cancelled")
            if _get_mcp_servers().get(name) != new_entry:
                raise ValueError("concurrent_config_change")
            # Config is published first. An interrupted copy leaves an OAuth
            # entry without usable tokens, never tokens attached to a foreign URL.
            real_storage._tokens_path().parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            for source, destination in zip(stage_files, destinations):
                if not source.is_file():
                    continue
                data = source.read_bytes()
                temporary = destination.with_name(f".friday-{flow_dir.name}-{destination.name}.tmp")
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
                try:
                    with os.fdopen(fd, "wb") as output:
                        output.write(data)
                        output.flush()
                        os.fsync(output.fileno())
                    os.link(temporary, destination, follow_symlinks=False)
                    written.append((destination, data))
                finally:
                    if temporary.exists():
                        temporary.unlink()
                if _get_mcp_servers().get(name) != new_entry or revision(config_path) != after_save_revision:
                    raise ValueError("concurrent_config_change")
                if (flow_dir / "cancel").exists():
                    raise ValueError("oauth_cancelled")
            if not real_storage.has_cached_tokens() or _get_mcp_servers().get(name) != new_entry:
                raise ValueError("oauth_publication_unconfirmed")
            if (flow_dir / "cancel").exists():
                raise ValueError("oauth_cancelled")
            new_revision = revision(config_path)
            # Cancel reads the state and places its marker under the same
            # config lock. It cannot acknowledge cancellation after commit.
            write_state(flow_dir, "configured", revision=new_revision, runtimeApplied=None)
            return new_revision
        except BaseException:
            for destination, data in written:
                try:
                    if not destination.is_symlink() and destination.is_file() and destination.read_bytes() == data:
                        destination.unlink()
                except OSError:
                    pass
            if _get_mcp_servers().get(name) == new_entry and revision(config_path) == after_save_revision:
                _save_mcp_server(name, original_entry)
            raise
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


async def login(flow_dir, name, url, config_path, expected_revision):
    import httpx2
    from mcp.client.auth.oauth2 import OAuthClientProvider
    from tools import mcp_oauth as mo
    from tools.mcp_oauth_provider import HermesProviderMixin, build_provider_kwargs

    stage_home = flow_dir / "stage"
    stage_home.mkdir(mode=0o700)
    storage = mo.HermesTokenStorage(name, hermes_home=stage_home)
    cfg = {"cimd": False, "timeout": FLOW_SECONDS}
    kwargs = build_provider_kwargs(cfg, storage, ssh_proxy_hint=False)
    port = cfg["_resolved_port"]

    async def announce(authorization_url):
        if len(authorization_url) > 8192:
            raise ValueError("oauth_authorization_url_invalid")
        host, _ = endpoint_parts(authorization_url)
        public_address(host)
        write_state(flow_dir, "awaiting_approval", authorizationUrl=authorization_url)

    async def callback():
        handler, result = mo._make_callback_handler()
        server = mo._start_callback_server(port, handler)
        import threading
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True).start()
        deadline = time.monotonic() + FLOW_SECONDS
        try:
            while not mo._result_taken(result):
                if (flow_dir / "cancel").exists():
                    raise ValueError("oauth_cancelled")
                if time.monotonic() > deadline:
                    raise ValueError("oauth_timeout")
                await asyncio.sleep(0.2)
            return mo._callback_outcome(result, None)
        finally:
            server.shutdown()
            server.server_close()

    kwargs["redirect_handler"] = announce
    kwargs["callback_handler"] = callback
    provider_class = type("FridayHermesOAuthProvider", (HermesProviderMixin, OAuthClientProvider), {})
    provider = provider_class(server_url=url, **kwargs)
    transport = make_transport(httpx2)
    async with httpx2.AsyncClient(transport=transport, auth=provider, follow_redirects=False,
                                   timeout=10.0, trust_env=False) as client:
        # A resource request triggers the SDK's 401 -> discovery -> DCR ->
        # authorization-code/PKCE -> token exchange, all through this transport.
        response = await client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                       "clientInfo": {"name": "friday-mcp-oauth", "version": "1"}}},
            headers={"Accept": "application/json, text/event-stream"})
        if response.status_code != 200 or not storage.has_cached_tokens():
            raise ValueError("oauth_handshake_unconfirmed")
    if (flow_dir / "cancel").exists():
        raise ValueError("oauth_cancelled")
    write_state(flow_dir, "publishing")
    publish(flow_dir, config_path, name, url, expected_revision, storage)


def arm_hard_deadline(seconds=HARD_DEADLINE_SECONDS):
    # The worker runs in its own session; killing that process group also ends SDK threads and helpers stuck in DNS or
    # slow-drip sockets. This does not rely on the timeout binary: uutils timeout (Ubuntu 26.04+) leaves the group alive.
    timer = threading.Timer(seconds, os.killpg, args=(os.getpgrp(), signal.SIGKILL))
    timer.daemon = True
    timer.start()
    return timer


def main():
    arm_hard_deadline()
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or set(request) != {"flowDir", "name", "url", "revision", "configPath", "source"}:
        return 2
    name, url = request["name"], request["url"]
    if (not isinstance(name, str) or re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name) is None or
            not valid_url(url) or type(request["revision"]) is not int):
        return 2
    config_path = Path(request["configPath"])
    flow_dir = Path(request["flowDir"])
    source = Path(request["source"])
    if (source.resolve() != (config_path.parent / "hermes-agent").resolve() or
            not flow_dir.is_dir() or flow_dir.is_symlink() or
            flow_dir.parent.resolve() != (config_path.parent / ".friday-mcp-oauth").resolve()):
        return 2
    import subprocess
    head = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"],
                          capture_output=True, text=True, timeout=3)
    if head.returncode or head.stdout.strip() != PINNED_SOURCE:
        write_state(flow_dir, "failed", failureClass="unsupported_source_revision")
        return 1
    try:
        current_entry(config_path, name, url, request["revision"])
        asyncio.run(asyncio.wait_for(login(flow_dir, name, url, config_path, request["revision"]),
                                     FLOW_SECONDS + 20))
        return 0
    except OAuthTransportFailure as exc:
        write_state(flow_dir, "failed", failureClass=exc.failure_class)
    except (ValueError, asyncio.TimeoutError) as exc:
        allowed = {"revision_conflict", "managed_entry_conflict", "oauth_credential_conflict",
            "oauth_cancelled", "oauth_timeout", "oauth_handshake_unconfirmed", "oauth_publication_unconfirmed",
            "concurrent_config_change", "config_rejected", "oauth_token_unconfirmed",
            "oauth_authorization_url_invalid"}
        write_state(flow_dir, "failed", failureClass=str(exc) if str(exc) in allowed else "oauth_failed")
    except Exception:
        write_state(flow_dir, "failed", failureClass="oauth_failed")
    finally:
        try:
            discard_stage(flow_dir)
        except OSError:
            pass
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
