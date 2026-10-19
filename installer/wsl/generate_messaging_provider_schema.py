"""Snapshot per-platform writable fields from the pinned Hermes manifests."""
import json
from pathlib import Path
import subprocess
import sys

import yaml

from messaging_catalog import CORE_ONLY, ROOT, PINNED

EXCLUDED = {"a2a", "raft", "email", "telegram", "discord", "whatsapp"}
NON_WRITABLE = {"BUZZ_CLI_PATH", "BUZZ_CREDENTIALS_FILE", "HERMES_SIMPLEX_TEXT_BATCH_DELAY"}


def fields():
    pin = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short=8", "HEAD"],
                         capture_output=True, text=True, timeout=3, check=False)
    if pin.returncode or pin.stdout.strip() != PINNED:
        raise RuntimeError("Hermes source version changed")
    entries = {}
    for path in (ROOT / "plugins" / "platforms").glob("*/plugin.yaml"):
        name = path.parent.name
        if name in EXCLUDED:
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        entries[name] = {field["name"]: {"secret": field.get("password") is True,
                                         "required": field in data.get("requires_env", [])}
                         for field in data.get("requires_env", []) + data.get("optional_env", [])
                         if field["name"] not in NON_WRITABLE and not field["name"].endswith("_ALLOW_ALL_USERS")}
    for name, required in CORE_ONLY.items():
        entries[name] = {field: {"secret": secret, "required": True} for field, secret in required}
    return dict(sorted(entries.items()))


def schema(specs):
    variants = []
    for platform, spec in specs.items():
        variants.append({"type": "object", "properties": {
            "platform": {"const": platform},
            "revision": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
            "values": {"type": "object", "properties": {
                field: {"type": ["string", "null"], "maxLength": 32768 if field == "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON" else 4096}
                for field in spec}, "minProperties": 1, "maxProperties": 10, "additionalProperties": False},
        }, "required": ["platform", "revision", "values"], "additionalProperties": False})
    return {"$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://friday.local/schemas/integrations/messenger-provider-update.schema.json",
            "title": "MessengerProviderUpdate", "oneOf": variants}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate_messaging_provider_schema.py SPECS_JSON SCHEMA_JSON")
    specs = fields()
    Path(sys.argv[1]).write_text(json.dumps(specs, indent=2) + "\n", encoding="utf-8")
    Path(sys.argv[2]).write_text(json.dumps(schema(specs), indent=2) + "\n", encoding="utf-8")
