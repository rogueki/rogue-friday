#!/usr/bin/env python3
"""The three remaining read-only skill commands (browse, check, tap list) as text, with their own arguments."""
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

ROOT = Path(tempfile.mkdtemp(prefix="friday-skill-command-"))
HOME = ROOT / "home"
CLI = ROOT / "bin" / "hermes"
LOG = ROOT / "argv.log"

CLI.parent.mkdir(parents=True)
CLI.write_text(textwrap.dedent(f"""\
    #!{sys.executable}
    import json, os, sys
    with open(r"{LOG}", "a", encoding="utf-8") as log:
        log.write(json.dumps(sys.argv[1:]) + "\\n")
    args = sys.argv[1:]
    if args == ["skills", "tap", "list"]:
        print("Configured taps\\n  github  anthropics/skills")
    elif args[:2] == ["skills", "browse"]:
        print("Browsing skills.sh\\n1. skill-creator  anthropics/skills  1200 installs")
    elif args[:2] == ["skills", "check"]:
        print("Checking " + (args[2] if len(args) > 2 else "all skills") + "\\nOK")
    elif args[:2] == ["skills", "browse"] or args[1] == "browse":
        sys.exit(2)
    else:
        sys.exit(3)
    """), encoding="utf-8")
CLI.chmod(CLI.stat().st_mode | stat.S_IEXEC)


def run(request):
    sys.argv = ["hermes_config_bridge.py", "skill-command"]
    sys.stdin = io.StringIO(json.dumps(request))
    buffer = io.StringIO()
    try:
        with redirect_stdout(buffer):
            code = bridge.locked_main(HOME, HOME / "hermes-agent", CLI)
    except ValueError as error:
        # The entry point turns a refused request into exit code 5; call the same contract here.
        code = 5
        buffer.write(json.dumps({"error": str(error)}))
    return code, json.loads(buffer.getvalue().strip().splitlines()[-1])


def argv():
    return [json.loads(line) for line in LOG.read_text(encoding="utf-8").strip().splitlines()]


blank = {"command": None, "name": None, "page": None, "size": None, "source": None}

# 1. tap list
code, payload = run({**blank, "command": "tap-list"})
assert code == 0 and "Configured taps" in payload["text"], payload
assert payload["name"] is None and payload["truncated"] is False, payload
assert argv()[-1] == ["skills", "tap", "list"], argv()

# 2. browse with paging and source
code, payload = run({**blank, "command": "browse", "page": 2, "size": 10, "source": "skills-sh"})
assert code == 0 and "skill-creator" in payload["text"], payload
assert argv()[-1] == ["skills", "browse", "--source", "skills-sh", "--page", "2", "--size", "10"], argv()

# 3. check all skills vs one skill
code, payload = run({**blank, "command": "check"})
assert code == 0 and "all skills" in payload["text"], payload
assert argv()[-1] == ["skills", "check"], argv()
code, payload = run({**blank, "command": "check", "name": "demo"})
assert code == 0 and "Checking demo" in payload["text"], payload
assert argv()[-1] == ["skills", "check", "demo"], argv()

# 4. parameters that do not belong to the command are refused before the CLI runs
before = len(argv())
for bad in ({**blank, "command": "tap-list", "page": 1},
            {**blank, "command": "browse", "name": "demo"},
            {**blank, "command": "browse", "page": 0},
            {**blank, "command": "browse", "size": 51},
            {**blank, "command": "browse", "source": "bad source!"},
            {**blank, "command": "check", "name": "../etc/passwd"},
            {**blank, "command": "publish"}):
    code, payload = run(bad)
    assert code == 5 and payload["error"] == "invalid_request", (bad, payload)
assert len(argv()) == before, argv()

# 5. extra or missing keys are refused as well
code, payload = run({"command": "tap-list"})
assert code == 5 and payload["error"] == "invalid_request", payload
code, payload = run({**blank, "command": "tap-list", "extra": 1})
assert code == 5 and payload["error"] == "invalid_request", payload

# 6. a failing command is reported as failure with its own text, not as an empty report
code, payload = run({**blank, "command": "tap-list"}) if False else (0, None)
CLI.write_text(textwrap.dedent(f"""\
    #!{sys.executable}
    import sys
    print("boom: registry unreachable", file=sys.stderr)
    sys.exit(1)
    """), encoding="utf-8")
CLI.chmod(CLI.stat().st_mode | stat.S_IEXEC)
code, payload = run({**blank, "command": "tap-list"})
assert code == 6 and payload["error"] == "skill_command_failed", payload
assert "registry unreachable" in payload["detail"], payload

print("skill-command: 12 checks passed")