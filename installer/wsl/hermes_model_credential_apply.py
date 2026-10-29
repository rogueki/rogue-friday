#!/usr/bin/env python3
"""Run only inside Hermes' pinned Python closure; a model credential arrives through stdin; OPENAI_BASE_URL is written or removed without the credential mirror scrub."""
import json
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from hermes_cli.config import load_env
from hermes_cli.credential_lifecycle import save_provider_env_credential, remove_provider_env_credential


VERIFY_TIMEOUT = 10


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib would forward the Authorization header to a redirect target; the key may only reach the provider host.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verification_request(key, value, env):
    if key == "OPENROUTER_API_KEY":
        # /models is public on OpenRouter; /key answers 401 for an unknown key.
        return urllib.request.Request("https://openrouter.ai/api/v1/key", headers={"Authorization": f"Bearer {value}"})
    if key == "ANTHROPIC_API_KEY":
        return urllib.request.Request("https://api.anthropic.com/v1/models",
                                      headers={"x-api-key": value, "anthropic-version": "2023-06-01"})
    base = env.get("OPENAI_BASE_URL") or "https://api.openai.com/v1"
    parts = urlsplit(base)
    if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in ("127.0.0.1", "localhost", "::1")):
        return None
    return urllib.request.Request(base.rstrip("/") + "/models", headers={"Authorization": f"Bearer {value}"})


def verify_credential(key, value, env):
    """Returns "ok", "rejected" or "unverified" without ever echoing the key."""
    request = verification_request(key, value, env)
    if request is None:
        return "unverified"
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=VERIFY_TIMEOUT) as response:
            return "ok" if response.status == 200 else "unverified"
    except urllib.error.HTTPError as exc:
        return "rejected" if exc.code in (401, 403) else "unverified"
    except (urllib.error.URLError, OSError, ValueError):
        return "unverified"


def main():
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or set(request) != {"key", "value"}:
        return 2
    key, value = request["key"], request["value"]
    if key == "OPENAI_BASE_URL":
        if value is None:
            from hermes_cli.config import require_env_writable, remove_env_value
            require_env_writable(key, "remove")
            remove_env_value(key)
            saved = key not in load_env()
            print(json.dumps({"saved": saved, "configured": False if saved else None}))
            return 0 if saved else 5
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
    if value is not None:
        verdict = verify_credential(key, value, load_env())
        if verdict != "ok":
            # A key the provider did not confirm must never replace the stored, possibly working one.
            print(json.dumps({"saved": False, "configured": None, "error": f"credential_{verdict}"}))
            return 6
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
