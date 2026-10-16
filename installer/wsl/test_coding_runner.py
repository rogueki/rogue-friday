#!/usr/bin/env python3
"""Isolated fake CLI proof: argv/cwd/task and process-group stop; no provider call."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT = Path(__file__).with_name("coding_runner.py")


def call(env, *args, task=None):
    process = subprocess.run([sys.executable, str(SCRIPT), *args], input=task, text=True,
                             capture_output=True, env=env, timeout=15)
    assert process.returncode == 0, process.stdout + process.stderr
    return json.loads(process.stdout)


def main():
    with tempfile.TemporaryDirectory(prefix="friday-coding-test-") as root:
        root = Path(root)
        repo = root / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        binaries = root / "bin"
        binaries.mkdir()
        fake = binaries / "codex"
        fake.write_text("""#!/usr/bin/env python3
import json, os, sys, time
if '--version' in sys.argv:
    print('fake-codex 1.0')
    sys.exit(0)
task = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == 'run' else sys.argv[sys.argv.index('-p') + 1] if '-p' in sys.argv else sys.stdin.read()
print(json.dumps({'cwd': os.getcwd(), 'argv': sys.argv[1:], 'task': task}), flush=True)
if 'STOP' in task:
    time.sleep(60)
""", encoding="utf-8")
        fake.chmod(0o700)
        for name in ("opencode", "claude"):
            clone = binaries / name
            shutil.copyfile(fake, clone)
            clone.chmod(0o700)
        env = os.environ.copy()
        env.update(FRIDAY_CODING_TEST_MODE="1", FRIDAY_CODING_TEST_BIN_DIR=str(binaries),
                   FRIDAY_CODING_RUN_DIR=str(root / "runs"))
        version = call(env, "probe", "codex", str(repo))
        assert version["version"] == "fake-codex 1.0"
        first = call(env, "start", "codex", str(repo), "idem_" + "A" * 26, task="Change this synthetic repo")
        for _ in range(50):
            state = call(env, "status", first["runId"])
            if state["status"] == "completed":
                break
            time.sleep(0.1)
        assert state["status"] == "completed", state
        assert state["executionVerified"] is True
        output = json.loads(state["output"].strip())
        assert output == {"cwd": str(repo), "argv": ["exec", "--sandbox", "workspace-write", "--ephemeral", "--color", "never", "-"],
                          "task": "Change this synthetic repo"}, output
        replay = call(env, "start", "codex", str(repo), "idem_" + "A" * 26, task="Change this synthetic repo")
        assert replay["runId"] == first["runId"]
        for cli, expected_argv, key in (("opencode", ["run", "Change this synthetic repo"], "C"),
                                        ("claude-code", ["-p", "Change this synthetic repo", "--max-turns", "20"], "D")):
            other = call(env, "start", cli, str(repo), "idem_" + key * 26, task="Change this synthetic repo")
            for _ in range(50):
                state = call(env, "status", other["runId"])
                if state["status"] == "completed":
                    break
                time.sleep(0.1)
            assert state["status"] == "completed", state
            output = json.loads(state["output"].strip())
            assert output == {"cwd": str(repo), "argv": expected_argv, "task": "Change this synthetic repo"}, output
        second = call(env, "start", "codex", str(repo), "idem_" + "B" * 26, task="STOP this synthetic repo")
        for _ in range(50):
            state = call(env, "status", second["runId"])
            if state["executionVerified"]:
                break
            time.sleep(0.1)
        assert state["executionVerified"] is True, state
        busy = subprocess.run([sys.executable, str(SCRIPT), "start", "codex", str(repo), "idem_" + "E" * 26],
                              input="Another synthetic task", text=True, capture_output=True, env=env, timeout=15)
        assert busy.returncode == 7 and json.loads(busy.stdout)["error"] == "coding_run_busy", busy.stdout
        stopped = call(env, "stop", second["runId"])
        assert stopped["status"] == "cancelled", stopped
        assert call(env, "status", second["runId"])["status"] == "cancelled"
        pid = json.loads((root / "runs" / (second["runId"] + ".json")).read_text(encoding="utf-8"))["pid"]
        for _ in range(20):
            try:
                os.killpg(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        else:
            raise AssertionError("Stopped process group survived")
        queued = call(env, "start", "codex", str(repo), "idem_" + "F" * 26, task="STOP this queued synthetic repo")
        assert call(env, "stop", queued["runId"])["status"] == "cancelled"
        time.sleep(0.2)
        assert call(env, "status", queued["runId"])["status"] == "cancelled"
    print("fake coding runner: PASS")


if __name__ == "__main__":
    main()
