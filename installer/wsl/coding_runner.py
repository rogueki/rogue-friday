#!/usr/bin/env python3
"""Owner-requested native Coding CLI jobs in Friday-Ubuntu; no shell command construction."""
import fcntl
import hashlib
import json
import os
import re
import resource
import shutil
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

CLI_BIN = {"codex": "codex", "opencode": "opencode", "claude-code": "claude"}
TERMINAL = {"completed", "failed", "cancelled", "interrupted", "timed_out"}
RUN_ID = re.compile(r"^run_[a-f0-9]{32}$")
ROOT = (Path(os.environ["FRIDAY_CODING_RUN_DIR"]) if os.environ.get("FRIDAY_CODING_TEST_MODE") == "1"
        and os.environ.get("FRIDAY_CODING_RUN_DIR") else Path.home() / ".local/share/friday/coding-runs")
MAX_OUTPUT = 1024 * 1024
MAX_SECONDS = 900
RETENTION_SECONDS = 7 * 24 * 60 * 60


def die(message, code=2):
    print(json.dumps({"error": message}), flush=True)
    raise SystemExit(code)


def base_env():
    home = str(Path.home())
    env = os.environ.copy()
    env["PATH"] = ":".join((
        home + "/.local/bin",
        home + "/.local/share/friday/node/v24.21.0/bin",
        home + "/.local/share/friday/coding-cli/npm/bin",
        "/usr/local/bin", "/usr/bin", "/bin",
    ))
    if env.get("FRIDAY_CODING_TEST_MODE") == "1":
        env["PATH"] = env.get("FRIDAY_CODING_TEST_BIN_DIR", "") + ":" + env["PATH"]
    return env


def repository_target(windows_path):
    try:
        linux_path = (windows_path if os.environ.get("FRIDAY_CODING_TEST_MODE") == "1" and windows_path.startswith("/")
                      else subprocess.check_output(["wslpath", "-u", "--", windows_path], text=True, timeout=5).strip())
        workdir = Path(linux_path).resolve(strict=True)
    except (OSError, subprocess.SubprocessError):
        die("repository_unavailable", 3)
    if not workdir.is_dir() or not (workdir / ".git").exists():
        die("git_root_missing", 3)
    git = subprocess.run(["git", "-c", f"safe.directory={workdir}", "-C", str(workdir), "rev-parse", "--show-toplevel"],
                         text=True, capture_output=True, timeout=5)
    if git.returncode or Path(git.stdout.strip()).resolve() != workdir:
        die("linux_git_unreadable", 3)
    return str(workdir)


def target(cli, windows_path):
    if cli not in CLI_BIN:
        die("unknown_cli")
    workdir = repository_target(windows_path)
    binary = shutil.which(CLI_BIN[cli], path=base_env()["PATH"])
    if not binary:
        die("native_cli_missing", 4)
    binary = str(Path(binary).resolve(strict=True))
    if binary.startswith("/mnt/") or binary.endswith((".exe", ".cmd")):
        die("native_cli_missing", 4)
    version = subprocess.run([binary, "--version"], text=True, capture_output=True, timeout=8, env=base_env())
    if version.returncode or not version.stdout.strip():
        die("native_cli_unverified", 4)
    return workdir, binary, version.stdout.splitlines()[0][:160]


def repository(windows_path):
    print(json.dumps({"workdir": repository_target(windows_path)}))


def paths(run_id):
    if not RUN_ID.fullmatch(run_id):
        die("invalid_run_id")
    return ROOT / (run_id + ".json"), ROOT / (run_id + ".out"), ROOT / (run_id + ".task")


def save(path, value):
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def load(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        die("run_not_found", 5)


def owned_worker(pid, run_id):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        proc = Path(f"/proc/{pid}")
        if proc.stat().st_uid != os.geteuid() or os.getpgid(pid) != pid:
            return False
        command = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
        return "coding_runner.py worker" in command and run_id in command
    except (OSError, ProcessLookupError):
        return False


def response(meta, output_path):
    output = ""
    if output_path.exists():
        with output_path.open("rb") as stream:
            stream.seek(max(0, output_path.stat().st_size - 12000))
            output = stream.read(12000).decode("utf-8", "replace")
    return {"runId": meta["runId"], "status": meta["status"], "requestedCli": meta["requestedCli"],
            "requestedWorkdir": meta["requestedWorkdir"], "preflightVersion": meta["preflightVersion"],
            "executionVerified": meta.get("executionVerified", False), "output": output or None,
            "error": meta.get("error"), "updatedAt": meta.get("updatedAt")}


def start(cli, windows_path, idem):
    if not re.fullmatch(r"idem_[A-F0-9]{26}", idem):
        die("invalid_idempotency_key")
    task = sys.stdin.buffer.read(16001)
    if len(task) > 16000 or len(task.strip()) < 10 or task.lstrip().startswith(b"-"):
        die("invalid_task")
    workdir, binary, version = target(cli, windows_path)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ROOT, 0o700)
    run_id = "run_" + hashlib.sha256(idem.encode()).hexdigest()[:32]
    meta_path, output_path, task_path = paths(run_id)
    fingerprint = hashlib.sha256(cli.encode() + b"\0" + workdir.encode() + b"\0" + task).hexdigest()
    with (ROOT / ".lock").open("a+b") as lock:
        os.chmod(ROOT / ".lock", 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if meta_path.exists():
            meta = load(meta_path)
            if meta.get("fingerprint") != fingerprint:
                die("idempotency_conflict", 6)
            print(json.dumps(response(meta, output_path)), flush=True)
            return
        active = 0
        for candidate in ROOT.glob("run_*.json"):
            other = load(candidate)
            if other.get("status") in TERMINAL and other.get("updatedAt", 0) < time.time() - RETENTION_SECONDS:
                if RUN_ID.fullmatch(other.get("runId", "")) and candidate.name == other["runId"] + ".json":
                    for suffix in (".json", ".out", ".task"):
                        (ROOT / (other["runId"] + suffix)).unlink(missing_ok=True)
                continue
            if other.get("status") not in TERMINAL and owned_worker(other.get("pid"), other.get("runId")):
                active += 1
        if active >= 1:
            die("coding_run_busy", 7)
        meta = {"runId": run_id, "status": "queued", "requestedCli": cli, "requestedWorkdir": workdir,
                "windowsPath": windows_path, "binary": binary, "preflightVersion": version, "executionVerified": False,
                "updatedAt": time.time(), "fingerprint": fingerprint, "pid": None, "error": None}
        fd = os.open(task_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(task)
        save(meta_path, meta)
        worker = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "worker", run_id],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  start_new_session=True, close_fds=True, env=base_env())
        meta["pid"] = worker.pid
        save(meta_path, meta)
        print(json.dumps(response(meta, output_path)), flush=True)


def probe(cli, windows_path):
    workdir, binary, version = target(cli, windows_path)
    print(json.dumps({"workdir": workdir, "binary": binary, "version": version}), flush=True)


def worker(run_id):
    meta_path, output_path, task_path = paths(run_id)
    for _ in range(50):
        meta = load(meta_path)
        if meta.get("pid") == os.getpid():
            break
        time.sleep(0.1)
    else:
        return
    task = task_path.read_bytes()
    task_path.unlink(missing_ok=True)
    workdir, binary, _ = target(meta["requestedCli"], meta["windowsPath"])
    if workdir != meta["requestedWorkdir"] or binary != meta["binary"]:
        meta.update(status="failed", error="coding_target_changed", updatedAt=time.time())
        save(meta_path, meta)
        return
    cli = meta["requestedCli"]
    if cli == "codex":
        argv = [binary, "exec", "--sandbox", "workspace-write", "--ephemeral", "--color", "never", "-"]
    elif cli == "opencode":
        argv = [binary, "run", task.decode("utf-8")]
    else:
        argv = [binary, "-p", task.decode("utf-8"), "--max-turns", "20"]
    with (ROOT / ".lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        meta = load(meta_path)
        if meta["status"] in TERMINAL:
            return
        output_fd = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        output = os.fdopen(output_fd, "wb")
        def limit_file():
            resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT, MAX_OUTPUT))
        try:
            child = subprocess.Popen(argv, cwd=workdir, stdin=subprocess.PIPE if cli == "codex" else subprocess.DEVNULL,
                                     stdout=output, stderr=subprocess.STDOUT, env=base_env(), preexec_fn=limit_file)
            meta.update(status="running", executionVerified=True, updatedAt=time.time())
            save(meta_path, meta)
        except Exception:
            output.close()
            meta.update(status="failed", error="Coding-CLI could not start", updatedAt=time.time())
            save(meta_path, meta)
            return
    with output:
        try:
            child.communicate(input=task if cli == "codex" else None, timeout=MAX_SECONDS)
            meta.update(status="completed" if child.returncode == 0 else "failed", error=None if child.returncode == 0 else f"CLI exit {child.returncode}", updatedAt=time.time(), executionVerified=True)
        except subprocess.TimeoutExpired:
            meta.update(status="timed_out", error="Coding-CLI exceeded 900 seconds", updatedAt=time.time(), executionVerified=True)
            save(meta_path, meta)
            os.killpg(os.getpgrp(), signal.SIGKILL)
            return
    save(meta_path, meta)
    # A CLI may have left helpers running in this group after its main process exited.
    os.killpg(os.getpgrp(), signal.SIGKILL)


def status(run_id):
    meta_path, output_path, _ = paths(run_id)
    meta = load(meta_path)
    if meta["status"] not in TERMINAL and not owned_worker(meta.get("pid"), run_id):
        meta.update(status="interrupted", error="Runner process ended before reporting completion", updatedAt=time.time())
        save(meta_path, meta)
    print(json.dumps(response(meta, output_path)), flush=True)


def stop(run_id):
    meta_path, output_path, _ = paths(run_id)
    with (ROOT / ".lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        meta = load(meta_path)
        if meta["status"] not in TERMINAL:
            pid = meta.get("pid")
            if owned_worker(pid, run_id):
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            meta.update(status="cancelled", error=None, updatedAt=time.time())
            save(meta_path, meta)
    print(json.dumps(response(meta, output_path)), flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "start":
        start(*sys.argv[2:])
    elif len(sys.argv) == 4 and sys.argv[1] == "probe":
        probe(*sys.argv[2:])
    elif len(sys.argv) == 3 and sys.argv[1] == "repository":
        repository(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] in {"worker", "status", "stop"}:
        globals()[sys.argv[1]](sys.argv[2])
    else:
        die("usage")
