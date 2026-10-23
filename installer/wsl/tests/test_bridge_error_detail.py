"""A failed run must say why it failed: the operator only saw "hermes_unavailable" before.

The canonical token stays in `error` (the TypeScript service branches on it); `detail` carries the reason the
process or the CLI actually produced so a missing binary or a slow CLI is diagnosable.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE = os.path.join(os.path.dirname(HERE), "hermes_config_bridge.py")
FAILURES = []


def check(name, condition, detail=""):
    if condition:
        print("ok   " + name)
    else:
        print("FAIL " + name + (" :: " + detail if detail else ""))
        FAILURES.append(name)


def run(args, env_extra=None):
    env = dict(os.environ)
    env.update(env_extra or {})
    result = subprocess.run([sys.executable, BRIDGE, *args], capture_output=True, text=True, timeout=180, env=env)
    try:
        return result.returncode, json.loads(result.stdout.strip() or "{}"), result.stdout
    except json.JSONDecodeError:
        return result.returncode, {"raw": result.stdout[-400:]}, result.stdout


# Without the CLI the bridge names the missing installation instead of blaming the distro.
code, payload, _ = run(["skills-list"], {"HOME": "/tmp/friday-empty-home"})
check("missing CLI names the installation", payload.get("error") == "hermes_not_installed", repr(payload))
check("missing CLI is a failed run", code != 0, str(code))

# A timeout keeps both the canonical code and the command it could not finish; that is the exact reason the
# inventory was empty on the operator system before the budget was raised (N-067). Distros without the CLI cannot
# exercise this path, so the check states which environment it proved.
code, payload, _ = run(["skills-list"], {"FRIDAY_SKILLS_LIST_TIMEOUT": "1"})
if payload.get("error") == "hermes_not_installed":
    print("skip slow-CLI timeout: this distro has no Hermes CLI")
else:
    check("a slow CLI is reported as unavailable",
          payload.get("error") in ("hermes_unavailable", "skills_list_failed"), repr(payload))
    check("a slow CLI keeps the timed-out command", "timed out" in str(payload.get("detail", "")), repr(payload))

# A canonical refusal keeps exactly one meaning and does not grow a detail field.
code, payload, _ = run(["definitely-not-a-command"])
check("unknown action stays invalid_request", payload.get("error") == "invalid_request", repr(payload))
check("unknown action keeps the refused command", "definitely-not-a-command" in str(payload.get("detail", "")), repr(payload))

# The parser accepts the bounded source vocabulary the CLI actually prints.
sys.path.insert(0, os.path.dirname(HERE))
import hermes_config_bridge as bridge  # noqa: E402

external = bridge.parse_skills_list(
    "\u2502 Name          \u2503 Category \u2503 Source   \u2503 Trust \u2503 Status  \u2502\n"
    "\u2502 friday-weather \u2503 weather  \u2503 external \u2503 local \u2503 enabled \u2502\n")
check("an external source token parses", external == {"count": 1, "skills": [
    {"name": "friday-weather", "category": "weather", "origin": "external", "trust": "local", "state": "enabled"}]}, repr(external))

print()
print("Tests", len(FAILURES), "failed" if FAILURES else "passed")
sys.exit(1 if FAILURES else 0)