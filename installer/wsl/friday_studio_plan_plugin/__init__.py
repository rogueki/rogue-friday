"""Read and save Friday's Content Studio plan through the loopback Control API (revision-checked, no paid actions)."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


READ_TOOL = "friday_studio_plan_read"
WRITE_TOOL = "friday_studio_plan_write"
READ_SCHEMA = {"name": READ_TOOL, "description": "Read the Content Studio plan shared with Friday Dashboard (ideas and postings) "
               "together with its revision. Never changes anything.",
               "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}
WRITE_SCHEMA = {"name": WRITE_TOOL, "description": "Save the complete Content Studio plan. Pass the revision from the last read; if the "
                "plan changed in the meantime nothing is written and the result is revision_conflict. Read again and merge before "
                "retrying. Starts no production and no paid provider job.",
                "parameters": {"type": "object", "properties": {
                    "plan": {"type": "object", "description": "Complete plan document as returned by the read tool"},
                    "revision": {"type": "integer", "minimum": 0, "description": "Revision returned by the last read"}},
                    "required": ["plan", "revision"], "additionalProperties": False}}
PLAN_PATH = "/api/v1/content-studio/plan"
MAX_BODY = 2_000_000


class _Blocked(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _blocked(code: str) -> str:
    return json.dumps({"status": "blocked", "write_effect": False, "error": {"code": code}}, ensure_ascii=False)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _setting(home: Path):
    config = home / ".hermes/friday-studio-plan-bridge.json"
    key_file = home / ".hermes/friday-studio-plan-bridge.key"
    if config.is_symlink() or key_file.is_symlink() or config.stat().st_mode & 0o077 or key_file.stat().st_mode & 0o077:
        raise _Blocked("bridge_not_private")
    data = json.loads(config.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != {"port"} or type(data["port"]) is not int or not 1024 <= data["port"] <= 65535:
        raise _Blocked("bridge_unavailable")
    key = key_file.read_text(encoding="ascii").strip()
    if len(key) != 44 or not key.endswith("="):
        raise _Blocked("bridge_unavailable")
    return data["port"], key


def _call(method: str, plan: dict | None = None, revision: int | None = None) -> dict:
    port, key = _setting(Path.home())
    url = f"http://127.0.0.1:{port}{PLAN_PATH}"
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    body = None
    if method == "PUT":
        body = json.dumps(plan, ensure_ascii=False).encode("utf-8")
        if len(body) > MAX_BODY:
            raise _Blocked("request_too_large")
        headers.update({"Content-Type": "application/json", "If-Match": str(revision)})
    opener = build_opener(ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(Request(url, data=body, method=method, headers=headers), timeout=10) as response:
            if response.status != 200 or response.geturl() != url:
                raise _Blocked("bridge_unavailable")
            payload = response.read(MAX_BODY + 1)
    except HTTPError as error:
        raise _Blocked({409: "revision_conflict", 403: "forbidden", 400: "invalid_plan", 413: "request_too_large",
                        422: "invalid_plan"}.get(error.code, "bridge_unavailable")) from error
    except _Blocked:
        raise
    except Exception as error:
        # A save whose answer was lost may still have been applied; the caller must read again before retrying.
        raise _Blocked("unknown_plan_outcome" if method == "PUT" else "bridge_unavailable") from error
    if len(payload) > MAX_BODY:
        raise _Blocked("response_too_large")
    page = json.loads(payload)
    data = page.get("data") if isinstance(page, dict) else None
    if not isinstance(data, dict) or type(data.get("revision")) is not int:
        raise _Blocked("invalid_response")
    return data


def register(ctx):
    def read(params: dict, **_kwargs) -> str:
        if not isinstance(params, dict) or params:
            return _blocked("invalid_request")
        try:
            data = _call("GET")
        except _Blocked as blocked:
            return _blocked(blocked.code)
        except Exception:
            return _blocked("bridge_unavailable")
        return json.dumps({"status": "completed", "revision": data["revision"], "plan": data.get("plan"), "write_effect": False},
                          ensure_ascii=False)

    def write(params: dict, **_kwargs) -> str:
        if (not isinstance(params, dict) or set(params) != {"plan", "revision"} or not isinstance(params["plan"], dict)
                or type(params["revision"]) is not int or params["revision"] < 0):
            return _blocked("invalid_request")
        try:
            data = _call("PUT", params["plan"], params["revision"])
        except _Blocked as blocked:
            return _blocked(blocked.code)
        except Exception:
            return _blocked("unknown_plan_outcome")
        return json.dumps({"status": "completed", "revision": data["revision"], "write_effect": True}, ensure_ascii=False)

    ctx.register_tool(name=READ_TOOL, toolset="friday_studio_plan", schema=READ_SCHEMA, handler=read)
    ctx.register_tool(name=WRITE_TOOL, toolset="friday_studio_plan", schema=WRITE_SCHEMA, handler=write)
