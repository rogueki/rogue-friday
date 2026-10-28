#!/usr/bin/env python3
"""Run only inside Hermes' pinned Python closure; a model credential arrives through stdin; OPENAI_BASE_URL is written without the credential mirror scrub."""
import json
import sys

from hermes_cli.config import load_env
from hermes_cli.credential_lifecycle import save_provider_env_credential, remove_provider_env_credential


def main():
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or set(request) != {"key", "value"}:
        return 2
    key, value = request["key"], request["value"]
    if key == "OPENAI_BASE_URL":
        if (not isinstance(value, str) or not 1 <= len(value) <= 512 or
                any(not 33 <= ord(char) <= 126 for char in value)):
            return 2
        from hermes_cli.config import require_env_writable, save_env_value
        require_env_writable(key, "set")
        save_env_value(key, value)
        saved = load_env().get(key) == value
        print(json.dumps({"saved": saved, "configured": value is not None if saved else None}))
        return 0 if saved else 5
    if key not in ("OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY") or \
            not (value is None or (isinstance(value, str) and 1 <= len(value) <= 4096 and
                                   all(32 <= ord(char) <= 126 for char in value))):
        return 2
    result = remove_provider_env_credential(key) if value is None else save_provider_env_credential(key, value)
    saved = result.get("ok") is True and load_env().get(key) == value
    print(json.dumps({"saved": saved, "configured": value is not None if saved else None}))
    return 0 if saved else 5


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, TypeError, OSError, KeyError):
        print(json.dumps({"saved": False, "configured": None}))
        raise SystemExit(5)
