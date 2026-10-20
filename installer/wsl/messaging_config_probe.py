"""Execute only under Hermes' published dependency runtime; emit no credentials."""
from dataclasses import asdict
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sys


def probe(platform):
    from gateway.config import Platform, load_gateway_config, _getenv
    from hermes_cli.send_cmd import _load_hermes_env

    _load_hermes_env()
    config = load_gateway_config()
    member = Platform(platform)
    if member not in config.get_connected_platforms():
        return {"state": "unconfigured"}
    if platform == "dingtalk":
        extra = config.platforms[member].extra or {}
        if not (extra.get("webhook_url") or _getenv("DINGTALK_WEBHOOK_URL", "")):
            return {"state": "unconfigured"}
    home = Path.home() / ".hermes"
    key_path = home / "friday-messenger-revision.key"
    try:
        fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, "wb") as stream:
            stream.write(secrets.token_bytes(32))
    key = key_path.read_bytes()
    if len(key) != 32 or key_path.stat().st_mode & 0o077:
        return {"state": "unavailable"}
    files = (home / ".env", home / "config.yaml", home / "gateway.json")
    metadata = [(path.name, path.stat().st_mtime_ns, path.stat().st_size)
                for path in files if path.is_file()]
    effective = asdict(config.platforms[member])
    source = json.dumps({"effective": effective, "files": metadata}, sort_keys=True, default=str).encode()
    return {"state": "configured", "revision": hmac.new(key, source, hashlib.sha256).hexdigest()}


if __name__ == "__main__":
    try:
        print(json.dumps(probe(sys.argv[1])))
    except Exception:
        print(json.dumps({"state": "unavailable"}))
