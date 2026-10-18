"""Execute under the pinned Hermes dependency runtime; report presence only."""
import json
import os
import sys


def probe(request):
    from hermes_cli.send_cmd import _load_hermes_env
    from gateway.config import load_gateway_config

    if not isinstance(request, dict) or set(request) != {"fields"} or not isinstance(request["fields"], list):
        raise ValueError("invalid request")
    fields = request["fields"]
    if len(fields) > 256 or any(not isinstance(field, str) or not field.isidentifier() or not field.isupper() for field in fields):
        raise ValueError("invalid fields")
    _load_hermes_env()
    config = load_gateway_config()
    return {"state": "available", "configured": [item.value for item in config.get_connected_platforms()],
            "present": {field: bool(os.environ.get(field)) for field in fields}}


if __name__ == "__main__":
    try:
        print(json.dumps(probe(json.load(sys.stdin))))
    except Exception:
        print(json.dumps({"state": "unavailable"}))
