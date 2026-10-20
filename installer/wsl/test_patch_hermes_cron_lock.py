"""Check the pinned cron lock patch and its fail-closed lock behavior."""

import ast
import contextlib
import hashlib
import os
from pathlib import Path
import shutil
import stat
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

import patch_hermes_cron_lock as patcher


class CronLockPatchTest(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("FRIDAY_HERMES_SOURCE_FIXTURE"), "opt-in pinned source checkout")
    def test_official_source_patch_rollback_and_unknown_bytes(self):
        source = Path(os.environ["FRIDAY_HERMES_SOURCE_FIXTURE"]) / patcher.RELATIVE
        with tempfile.TemporaryDirectory(prefix="friday-cron-patch-") as directory:
            root = Path(directory)
            target = root / patcher.RELATIVE
            target.parent.mkdir(parents=True)
            shutil.copyfile(source, target)
            target.chmod(0o640)
            self.assertEqual(patcher.apply(root, check=True), "original")
            self.assertEqual(patcher.apply(root), "patched")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
            self.assertEqual(patcher.apply(root, require_patched=True), "patched")
            compile(target.read_bytes(), str(target), "exec")
            self.assertEqual(patcher.apply(root, rollback=True), "rolled_back")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), patcher.ORIGINAL_SHA)
            target.write_bytes(target.read_bytes() + b"\n# unknown change\n")
            with self.assertRaisesRegex(ValueError, "unknown Hermes cron source"):
                patcher.apply(root)

    @unittest.skipUnless(os.environ.get("FRIDAY_HERMES_SOURCE_FIXTURE"), "opt-in pinned source checkout")
    def test_actual_patched_lock_refuses_missing_cross_process_flock(self):
        source = Path(os.environ["FRIDAY_HERMES_SOURCE_FIXTURE"]) / patcher.RELATIVE
        code = patcher.patched(source.read_bytes()).decode("utf-8")
        function = next(node for node in ast.parse(code).body
                        if isinstance(node, ast.FunctionDef) and node.name == "friday_strict_jobs_lock")
        namespace = {"contextlib": contextlib, "_jobs_lock_state": threading.local(),
                     "_jobs_file_lock": threading.RLock(), "ensure_dirs": lambda: None,
                     "_jobs_lock_file": lambda: Path("/tmp/unused-friday-cron-lock"),
                     "_acquire_flock": lambda _fd, _timeout: False,
                     "_release_flock": lambda fd: fd.close()}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "<patched cron>", "exec"), namespace)
        with tempfile.TemporaryDirectory(prefix="friday-cron-lock-") as directory:
            namespace["_jobs_lock_file"] = lambda: Path(directory) / ".jobs.lock"
            with self.assertRaisesRegex(RuntimeError, "cross-process lock unavailable"):
                with namespace["friday_strict_jobs_lock"]():
                    self.fail("mutation would have crossed an unavailable lock")
            namespace["_acquire_flock"] = lambda _fd, _timeout: True
            with namespace["friday_strict_jobs_lock"]():
                self.assertEqual(namespace["_jobs_lock_state"].depth, 1)
            self.assertEqual(namespace["_jobs_lock_state"].depth, 0)

    @unittest.skipUnless(os.environ.get("FRIDAY_HERMES_SOURCE_FIXTURE"), "opt-in pinned source checkout")
    def test_official_scheduler_survives_lock_failure_and_retries_next_tick(self):
        source = Path(os.environ["FRIDAY_HERMES_SOURCE_FIXTURE"]) / "cron/scheduler_provider.py"
        provider = ast.parse(source.read_text(encoding="utf-8"))
        scheduler = next(node for node in provider.body
                         if isinstance(node, ast.ClassDef) and node.name == "InProcessCronScheduler")
        start = next(node for node in scheduler.body
                     if isinstance(node, ast.FunctionDef) and node.name == "start")
        ticks, errors, heartbeats = [], [], []
        stopped = threading.Event()

        def cron_tick(**_kwargs):
            ticks.append(len(ticks))
            if len(ticks) == 1:
                raise RuntimeError("cron cross-process lock unavailable")

        def wait(_seconds):
            if len(ticks) >= 2:
                stopped.set()

        stopped.wait = wait
        fake_modules = {
            "cron.scheduler": types.SimpleNamespace(CronTickYielded=type("CronTickYielded", (Exception,), {}), tick=cron_tick),
            "cron.jobs": types.SimpleNamespace(clear_ticker_error=lambda: None,
                                                record_ticker_error=lambda *args: errors.append(args),
                                                record_ticker_heartbeat=lambda **kwargs: heartbeats.append(kwargs)),
            "cron.scheduler_ownership": types.SimpleNamespace(register_ticked_homes=lambda _homes: None),
            "hermes_constants": types.SimpleNamespace(get_process_hermes_home=lambda: Path("/tmp/disposable")),
        }
        class Scheduler:
            def recover_interrupted(self):
                return 0

        namespace = {"logger": types.SimpleNamespace(info=lambda *args: None, error=lambda *args, **kwargs: None),
                     "_guarded_store_write": lambda function, _label, *args, **kwargs: function(*args, **kwargs),
                     "_note_tick_failure": lambda _error, failures: failures + 1,
                     "_backoff_wait_seconds": lambda _interval, _failures: 0,
                     "time": types.SimpleNamespace(monotonic=lambda: 0)}
        exec(compile(ast.Module(body=[start], type_ignores=[]), str(source), "exec"), namespace)
        with patch.dict("sys.modules", fake_modules):
            namespace["start"](Scheduler(), stopped, interval=0)
        self.assertEqual(len(ticks), 2)
        self.assertTrue(any("cross-process lock unavailable" in str(item) for item in errors))
        self.assertEqual([item.get("success") for item in heartbeats], [None, False, True])

    @unittest.skipUnless(os.environ.get("FRIDAY_HERMES_SOURCE_FIXTURE"), "opt-in pinned source checkout")
    def test_native_scheduler_write_lock_also_refuses_degraded_mode(self):
        source = Path(os.environ["FRIDAY_HERMES_SOURCE_FIXTURE"]) / patcher.RELATIVE
        code = patcher.patched(source.read_bytes()).decode("utf-8")
        function = next(node for node in ast.parse(code).body
                        if isinstance(node, ast.FunctionDef) and node.name == "_jobs_lock")
        namespace = {"contextlib": contextlib, "_jobs_lock_state": threading.local(),
                     "_jobs_file_lock": threading.RLock(), "ensure_dirs": lambda: None,
                     "_acquire_flock": lambda _fd, _timeout: False,
                     "_release_flock": lambda fd: fd.close(), "_JOBS_LOCK_TIMEOUT_SECONDS": 0.1}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "<patched cron>", "exec"), namespace)
        with tempfile.TemporaryDirectory(prefix="friday-cron-native-lock-") as directory:
            namespace["_jobs_lock_file"] = lambda: Path(directory) / ".jobs.lock"
            with self.assertRaisesRegex(RuntimeError, "cross-process lock unavailable"):
                with namespace["_jobs_lock"]():
                    self.fail("native scheduler would have written without cross-process lock")
            self.assertEqual(namespace["_jobs_lock_state"].depth, 0)


if __name__ == "__main__":
    unittest.main()
