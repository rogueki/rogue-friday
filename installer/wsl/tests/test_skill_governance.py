#!/usr/bin/env python3
"""Trust markers and taps: the two remaining mutating skill commands, with target checks before the CLI runs."""
import io
import json
import os
import stat
import sys
import tempfile
import textwrap
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hermes_config_bridge as bridge

ROOT = Path(tempfile.mkdtemp(prefix="friday-governance-"))
HOME = ROOT / "home"
CLI = ROOT / "bin" / "hermes"
LOG = ROOT / "argv.log"
PROJECT = ROOT / "project"
(HOME).mkdir()
(PROJECT / ".hermes" / "skills" / "demo").mkdir(parents=True)
(PROJECT / ".hermes" / "skills" / "demo" / "SKILL.md").write_text("# demo\n", encoding="utf-8")
CLI.parent.mkdir(parents=True)

STATE = ROOT / "taps.txt"
CLI.write_text(textwrap.dedent(f"""\
    #!{sys.executable}
    import json, os, sys
    with open(r"{LOG}", "a", encoding="utf-8") as log:
        log.write(json.dumps(sys.argv[1:]) + "\\n")
    state = r"{STATE}"
    args = sys.argv[1:]
    def taps():
        if not os.path.exists(state):
            return []
        return [line for line in open(state, encoding="utf-8").read().splitlines() if line]
    if args[:3] == ["skills", "trust", "{PROJECT}"]:
        print("Trusted: {PROJECT}")
    elif args[:3] == ["skills", "untrust", "{PROJECT}"]:
        print("Untrusted: {PROJECT}")
    elif args[:3] == ["skills", "reset", "demo"]:
        print("Cleared bundled manifest entry for demo")
    elif args[:4] == ["skills", "tap", "add", "owner/repo"]:
        rows = taps()
        if "owner/repo" not in rows:
            rows.append("owner/repo")
        open(state, "w", encoding="utf-8").write("\\n".join(rows))
        print("Added tap: owner/repo")
    elif args[:4] == ["skills", "tap", "remove", "owner/repo"]:
        rows = taps()
        if "owner/repo" not in rows:
            print("Error: Tap not found: owner/repo")
        else:
            open(state, "w", encoding="utf-8").write("\\n".join([row for row in rows if row != "owner/repo"]))
            print("Removed tap: owner/repo")
    elif args == ["skills", "tap", "list"]:
        rows = taps()
        print("Configured Taps" + ("\\n " + "  ".join(rows) if rows else ""))
    else:
        sys.exit(2)
    """), encoding="utf-8")
CLI.chmod(CLI.stat().st_mode | stat.S_IEXEC)


def run(request):
    sys.argv = ["hermes_config_bridge.py", "skill-governance"]
    sys.stdin = io.TextIOWrapper(io.BytesIO(json.dumps(request).encode("utf-8")), encoding="utf-8")
    buffer = io.StringIO()
    try:
        with redirect_stdout(buffer):
            code = bridge.locked_main(HOME, HOME / "hermes-agent", CLI)
    except ValueError as error:
        code = 5
        buffer.write(json.dumps({"error": str(error)}))
    return code, json.loads(buffer.getvalue().strip().splitlines()[-1])


def argv():
    return [json.loads(line) for line in LOG.read_text(encoding="utf-8").strip().splitlines()]


blank = {"action": None, "path": None, "repo": None, "name": None}

# 1. trust and untrust a project that really carries project skills
code, payload = run({**blank, "action": "trust", "path": str(PROJECT)})
assert code == 0 and payload["target"] == str(PROJECT), payload
assert "Trusted" in payload["text"], payload
assert argv()[-1] == ["skills", "trust", str(PROJECT)], argv()
code, payload = run({**blank, "action": "untrust", "path": str(PROJECT)})
assert code == 0 and "Untrusted" in payload["text"], payload
assert argv()[-1] == ["skills", "untrust", str(PROJECT)], argv()

# 2. a path without project skills is refused before the CLI runs
before = len(argv())
code, payload = run({**blank, "action": "trust", "path": str(ROOT)})
assert code == 6 and payload["error"] == "missing_project_skills", payload
code, payload = run({**blank, "action": "trust", "path": str(ROOT / "does-not-exist")})
assert code == 6 and payload["error"] == "invalid_target", payload
assert len(argv()) == before, argv()

# 3. relative paths and traversal are refused as bad shape
for bad_path in ("project", "/tmp/../etc", "", None):
    code, payload = run({**blank, "action": "trust", "path": bad_path})
    assert code == 5 and payload["error"] == "invalid_request", (bad_path, payload)
assert len(argv()) == before, argv()

# 4. taps: add confirms through a real read-back, remove needs no extra confirmation
code, payload = run({**blank, "action": "tap-add", "repo": "owner/repo"})
assert code == 0 and "Added tap" in payload["text"], payload
assert argv()[-2] == ["skills", "tap", "add", "owner/repo"], argv()
code, payload = run({**blank, "action": "tap-remove", "repo": "owner/repo"})
assert code == 0 and "Removed tap" in payload["text"], payload
assert ["skills", "tap", "remove", "owner/repo"] in argv()[-2:], argv()

# 5. malformed repos and tap names never reach the CLI
for bad in ({"action": "tap-add", "repo": "no-slash"},
            {"action": "tap-add", "repo": "owner/re po"},
            {"action": "tap-remove", "repo": "../x"},
            {"action": "tap-remove", "repo": ""},
            {"action": "publish"}):
    code, payload = run({**blank, **bad})
    assert code == 5 and payload["error"] == "invalid_request", (bad, payload)

# 5b. reset names a skill and is confirmed by the CLI text that names it
code, payload = run({**blank, "action": "reset", "name": "demo"})
assert code == 0 and "demo" in payload["text"], payload
assert argv()[-1] == ["skills", "reset", "demo"], argv()
code, payload = run({**blank, "action": "reset", "name": "../etc"})
assert code == 5 and payload["error"] == "invalid_request", payload

# 6. an add the tap list does not show is reported as unconfirmed, not as success
CLI.write_text(textwrap.dedent(f"""\
    #!{sys.executable}
    import sys
    args = sys.argv[1:]
    if args == ["skills", "tap", "list"]:
        print("No custom taps configured.")
    else:
        print("Added tap: someone/else")
    """), encoding="utf-8")
CLI.chmod(CLI.stat().st_mode | stat.S_IEXEC)
code, payload = run({**blank, "action": "tap-add", "repo": "owner/other"})
assert code == 8 and payload["error"] == "skill_governance_unconfirmed", payload

# 6b. A removal the CLI reports as an error counts as failure even though it exits 0.
CLI.write_text("#!" + sys.executable + "\nimport sys\nprint('Error: Tap not found: owner/repo')\nsys.exit(0)\n",
               encoding="utf-8")
CLI.chmod(CLI.stat().st_mode | stat.S_IEXEC)
code, payload = run({**blank, "action": "tap-remove", "repo": "owner/repo"})
assert code == 6 and payload["error"] == "skill_governance_failed", payload
assert "Tap not found" in payload["detail"], payload

# 7. a failing CLI is reported with its text
CLI.write_text("#!/bin/sh\necho 'boom' >&2\nexit 3\n", encoding="utf-8")
CLI.chmod(CLI.stat().st_mode | stat.S_IEXEC)
code, payload = run({**blank, "action": "untrust", "path": str(PROJECT)})
assert code == 6 and payload["error"] == "skill_governance_failed", payload
assert "boom" in payload["detail"], payload

print("skill-governance: 16 checks passed")