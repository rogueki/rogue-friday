#!/usr/bin/env python3
"""A mutation is snapshotted first: a failure restores the old files, a success reports the new state."""
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hermes_config_bridge as bridge

FAKE_CLI = '''#!/usr/bin/env python3
import json, os, shutil, sys
from pathlib import Path
root = Path(__file__).resolve().parent
state = root / "state.json"
rows = json.loads(state.read_text(encoding="utf-8")) if state.exists() else []
args = sys.argv[1:]
mode = os.environ.get("FAKE_MODE", "ok")

def write_rows(items):
    state.write_text(json.dumps(items), encoding="utf-8")

def skill_dir(name):
    return root / "skills" / name

def table(items):
    print("\\u250c" + "\\u2500" * 30 + "\\u2510")
    print("\\u2502Name\\u2502Category\\u2502Source\\u2502Trust\\u2502Status\\u2502")
    for name in items:
        print("\\u2502%s\\u2502\\u2502local\\u2502local\\u2502enabled\\u2502" % name)
    print("\\u2514" + "\\u2500" * 30 + "\\u2518")

if args[:2] == ["skills", "list"]:
    table(rows)
    sys.exit(0)
with open(root / "argv.log", "a", encoding="utf-8") as log:
    log.write(json.dumps(args) + "\\n")
action = args[1]
if action == "install":
    name = args[2].rsplit("/", 1)[-1]
    if mode == "fail":
        print("install failed: registry unreachable")
        sys.exit(1)
    skill_dir(name).mkdir(parents=True, exist_ok=True)
    (skill_dir(name) / "SKILL.md").write_text("---\\nname: %s\\n---\\nnew\\n" % name, encoding="utf-8")
    write_rows(sorted(rows + [name]))
    print("Installed: %s" % name)
    sys.exit(0)
name = args[2]
if action == "update":
    if mode == "fail":
        print("update failed: checksum mismatch")
        sys.exit(1)
    (skill_dir(name) / "SKILL.md").write_text("---\\nname: %s\\n---\\nupstream\\n" % name, encoding="utf-8")
    print("Updated 1 skill(s).")
    sys.exit(0)
if action == "uninstall":
    if mode == "fail":
        print("uninstall failed: in use")
        sys.exit(1)
    shutil.rmtree(skill_dir(name))
    write_rows([row for row in rows if row != name])
    print("Removed: %s" % name)
    sys.exit(0)
print("unsupported: %s" % action)
sys.exit(2)
'''


def build_home():
    root = Path(tempfile.mkdtemp(prefix="friday-mutate-"))
    (root / "hermes-agent").mkdir()
    cli = root / "hermes"
    cli.write_text(FAKE_CLI, encoding="utf-8")
    cli.chmod(0o755)
    skill = root / "skills" / "demo"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: demo\n---\noriginal\n", encoding="utf-8")
    (root / "state.json").write_text(json.dumps(["demo"]), encoding="utf-8")
    return root, cli


def run(home, cli, request, mode="ok"):
    os.environ["FAKE_MODE"] = mode
    sys.argv = ["hermes_config_bridge.py", "skill-mutate"]
    sys.stdin = io.StringIO(json.dumps(request))
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = bridge.locked_main(home, home / "hermes-agent", cli)
    payload = json.loads(buffer.getvalue().strip().splitlines()[-1])
    return code, payload


REQUEST = {"action": "update", "name": "demo", "identifier": None, "force": False}
HOME, CLI = build_home()

# 1. Success: the old file lands in a snapshot and the new upstream text is live.
code, payload = run(HOME, CLI, REQUEST)
assert code == 0, (code, payload)
assert payload["installed"] is True and payload["enabled"] is True, payload
assert payload["snapshot"] and payload["snapshot"].endswith("-update-demo"), payload
assert "upstream" in (HOME / "skills" / "demo" / "SKILL.md").read_text(encoding="utf-8")
snapshot = HOME / bridge.SNAPSHOT_DIR_NAME / payload["snapshot"]
assert "original" in (snapshot / "skill" / "0" / "SKILL.md").read_text(encoding="utf-8")

# 2. Failure: the service restores exactly the file it snapshotted before the CLI ran.
skill_file = HOME / "skills" / "demo" / "SKILL.md"
skill_file.write_text("---\nname: demo\n---\nhand-edited\n", encoding="utf-8")
before = skill_file.read_text(encoding="utf-8")
code, payload = run(HOME, CLI, REQUEST, mode="fail")
assert code == 6, (code, payload)
assert payload["error"] == "skill_mutation_failed" and payload["restored"] is True, payload
assert "update failed" in payload["detail"], payload
assert skill_file.read_text(encoding="utf-8") == before

# 3. Install of a skill that was not installed before: no snapshot is needed, but failure removes what it created.
install = {"action": "install", "name": "fresh", "identifier": "skills-sh/x/fresh", "force": True}
code, payload = run(HOME, CLI, install)
assert code == 0 and payload["snapshot"] is None, payload
assert (HOME / "skills" / "fresh" / "SKILL.md").is_file()
code, payload = run(HOME, CLI, {"action": "install", "name": "broken", "identifier": "skills-sh/x/broken", "force": False},
                     mode="fail")
assert code == 6 and payload["error"] == "skill_mutation_failed", payload
# Nothing existed before and nothing was created, so there is nothing to undo.
assert payload["restored"] is False and payload["previousPresent"] is False, payload
assert not (HOME / "skills" / "broken").exists()

# 4. Uninstall: the directory goes away and the verification sees it gone.
code, payload = run(HOME, CLI, {"action": "uninstall", "name": "fresh", "identifier": None, "force": False})
assert code == 0 and payload["installed"] is False and payload["enabled"] is None, payload
assert not (HOME / "skills" / "fresh").exists()

# 5. Bad requests never reach the CLI.
for bad in ({"action": "remove", "name": "demo", "identifier": None, "force": False},
            {"action": "install", "name": "demo", "identifier": None, "force": False},
            {"action": "update", "name": "../evil", "identifier": None, "force": False},
            {"action": "update", "name": "demo", "identifier": "x", "force": False},
            {"action": "update", "name": "demo", "identifier": None, "force": "yes"}):
    try:
        run(HOME, CLI, bad)
    except ValueError as error:
        assert str(error) == "invalid_request", error
    else:
        raise AssertionError("accepted a bad request: %r" % (bad,))

print("skill-mutate: 15 checks passed")
# 6. The exact argv: install and uninstall need the confirmation flag, update rejects it.
logged = (HOME / "argv.log").read_text(encoding="utf-8").strip().splitlines()
argv = [json.loads(line) for line in logged if "skills" in line]
assert ["skills", "install", "skills-sh/x/fresh", "--yes", "--force"] in argv, argv
assert ["skills", "update", "demo"] in argv, argv
assert ["skills", "uninstall", "fresh", "--yes"] in argv, argv
assert not any(entry[:2] == ["skills", "update"] and "--yes" in entry for entry in argv), argv

print("skill-mutate-argv: 4 checks passed")

