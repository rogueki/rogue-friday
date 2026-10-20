"""Opt-in integration test for a patched official d923 Hermes source checkout.

FRIDAY_HERMES_OFFICIAL_SOURCE must point to an isolated checkout at the exact pin.
Run patch_hermes_run_stop.py on that checkout before invoking this test. No live
Friday service or user profile is accessed; the board DB and Hermes home are temp.
"""

import importlib.util
from contextlib import contextmanager
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch


PIN = "d923a5eb487a17c0a68801bba9ef0f56c81040a8"
SOURCE = os.environ.get("FRIDAY_HERMES_OFFICIAL_SOURCE")


@unittest.skipUnless(SOURCE, "set FRIDAY_HERMES_OFFICIAL_SOURCE to the patched official d923 checkout")
class OfficialHermesLifecycleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(SOURCE).resolve()
        actual = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
        if actual != PIN:
            raise AssertionError(f"official Hermes pin differs: {actual}")
        patcher = Path(__file__).resolve().parents[1] / "patch_hermes_run_stop.py"
        subprocess.run([sys.executable, str(patcher), str(root), "--require-patched"], check=True)
        sys.path.insert(0, str(root))
        # Hermes's optional state preflight imports the full agent stack. The
        # test owns a fresh temp DB and still exercises Hermes's real init path.
        state_stub = types.ModuleType("hermes_state")
        state_stub.preflight_db_writability = lambda *args, **kwargs: None
        cls.previous_state_module = sys.modules.get("hermes_state")
        sys.modules["hermes_state"] = state_stub
        from hermes_cli import kanban_db, kanban_db_connect, kanban_db_dispatch

        cls.kanban = kanban_db
        cls.connect = kanban_db_connect
        cls.dispatch = kanban_db_dispatch
        api_path = root / "plugins/kanban/dashboard/plugin_api.py"
        spec = importlib.util.spec_from_file_location("friday_official_plugin_api", api_path)
        cls.api = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.api
        spec.loader.exec_module(cls.api)

    @classmethod
    def tearDownClass(cls):
        if cls.previous_state_module is None:
            sys.modules.pop("hermes_state", None)
        else:
            sys.modules["hermes_state"] = cls.previous_state_module
        sys.path.remove(str(Path(SOURCE).resolve()))
        sys.modules.pop("friday_official_plugin_api", None)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="friday-hermes-real-db-")
        self.home_patch = patch.dict(os.environ, {"HERMES_HOME": str(Path(self.temp.name) / "home")})
        self.home_patch.start()
        path = Path(self.temp.name) / "board.db"
        self.connect.init_db(path)
        self.db = self.connect.connect(path)

    def tearDown(self):
        self.db.close()
        self.home_patch.stop()
        self.temp.cleanup()

    def task(self):
        return self.kanban.create_task(self.db, title="Friday official fixture", workspace_kind="scratch")

    def expected(self, task_id):
        task = self.kanban.get_task(self.db, task_id)
        event = self.db.execute("SELECT COALESCE(MAX(id), 0) FROM task_events WHERE task_id = ?", (task_id,)).fetchone()[0]
        return dict(expected_event_id=event, expected_status=task.status,
                    expected_run_id=task.current_run_id, expected_claim_lock=task.claim_lock)

    def claim_with_worker(self, task_id, pid=55123):
        claimed = self.kanban.claim_task(self.db, task_id, claimer=self.kanban._host_prefix() + "friday-fixture")
        self.assertIsNotNone(claimed)
        with self.kanban.write_txn(self.db):
            self.db.execute("UPDATE tasks SET worker_pid = ?, worker_started_at = NULL WHERE id = ?", (pid, task_id))
        return self.expected(task_id)

    def claim_with_real_worker(self, task_id):
        worker = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                                  start_new_session=True)
        try:
            fingerprint = self.dispatch._process_fingerprint(worker.pid)
            self.assertIsNotNone(fingerprint)
            claimed = self.kanban.claim_task(
                self.db, task_id, claimer=self.kanban._host_prefix() + "friday-real-worker")
            self.assertIsNotNone(claimed)
            with self.kanban.write_txn(self.db):
                self.db.execute("UPDATE tasks SET worker_pid = ?, worker_started_at = ? WHERE id = ?",
                                (worker.pid, fingerprint, task_id))
            # Reap on a separate thread: a zombie still answers kill(pid, 0) on Linux.
            threading.Thread(target=worker.wait, daemon=True).start()
            return worker, self.expected(task_id)
        except BaseException:
            worker.kill()
            worker.wait(timeout=5)
            raise

    @unittest.skipUnless(sys.platform.startswith("linux"), "POSIX process fixture runs in Linux CI")
    def test_real_child_cancel_terminates_before_archive(self):
        task_id = self.task()
        worker, expected = self.claim_with_real_worker(task_id)
        try:
            self.assertTrue(self.kanban.archive_task(self.db, task_id, **expected))
            self.assertIsNotNone(worker.poll())
            task = self.kanban.get_task(self.db, task_id)
            self.assertEqual((task.status, task.current_run_id), ("archived", None))
            run = self.db.execute("SELECT ended_at FROM task_runs WHERE id = ?",
                                  (expected["expected_run_id"],)).fetchone()
            self.assertIsNotNone(run[0])
        finally:
            if worker.poll() is None:
                worker.kill()
            worker.wait(timeout=5)

    @unittest.skipUnless(sys.platform.startswith("linux"), "POSIX process fixture runs in Linux CI")
    def test_real_child_named_stop_blocks_and_ends_run(self):
        task_id = self.task()
        worker, expected = self.claim_with_real_worker(task_id)
        try:
            self.assertTrue(self.kanban.friday_terminate_run(self.db, expected["expected_run_id"]))
            self.assertIsNotNone(worker.poll())
            task = self.kanban.get_task(self.db, task_id)
            self.assertEqual((task.status, task.block_kind, task.current_run_id),
                             ("blocked", "friday_stopped", None))
            run = self.db.execute("SELECT ended_at FROM task_runs WHERE id = ?",
                                  (expected["expected_run_id"],)).fetchone()
            self.assertIsNotNone(run[0])
        finally:
            if worker.poll() is None:
                worker.kill()
            worker.wait(timeout=5)

    def test_running_cancel_ends_the_named_run_and_signals_once(self):
        task_id = self.task()
        expected = self.claim_with_worker(task_id)
        alive = {"value": True}
        signals = []

        def send(pid, sig):
            signals.append((pid, sig))
            alive["value"] = False

        with patch.object(self.kanban, "_pid_alive", side_effect=lambda pid: alive["value"]):
            self.assertTrue(self.kanban.archive_task(self.db, task_id, signal_fn=send, **expected))
        self.assertEqual(signals, [(55123, signal.SIGTERM)])
        task = self.kanban.get_task(self.db, task_id)
        self.assertEqual((task.status, task.current_run_id), ("archived", None))
        run = self.db.execute("SELECT ended_at FROM task_runs WHERE id = ?", (expected["expected_run_id"],)).fetchone()
        self.assertIsNotNone(run[0])

    def test_cancel_surviving_worker_rolls_back_status_and_run(self):
        task_id = self.task()
        expected = self.claim_with_worker(task_id)
        signals = []
        with patch.object(self.kanban, "_pid_alive", return_value=True), \
             patch.object(self.dispatch, "_poll_worker_exit", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "still has a live worker"):
                self.kanban.archive_task(self.db, task_id,
                    signal_fn=lambda pid, sig: signals.append((pid, sig)), **expected)
        self.assertEqual(len(signals), 2)  # SIGTERM, then SIGKILL
        task = self.kanban.get_task(self.db, task_id)
        self.assertEqual((task.status, task.current_run_id, task.claim_lock),
                         ("running", expected["expected_run_id"], expected["expected_claim_lock"]))
        self.assertIsNone(self.db.execute("SELECT ended_at FROM task_runs WHERE id = ?",
                                           (expected["expected_run_id"],)).fetchone()[0])

    def test_named_stop_blocks_until_explicit_retry(self):
        task_id = self.task()
        expected = self.claim_with_worker(task_id)
        alive = {"value": True}
        signals = []

        def send(pid, sig):
            signals.append((pid, sig))
            alive["value"] = False

        with patch.object(self.kanban, "_pid_alive", side_effect=lambda pid: alive["value"]):
            self.assertTrue(self.kanban.friday_terminate_run(
                self.db, expected["expected_run_id"], signal_fn=send))
        stopped = self.kanban.get_task(self.db, task_id)
        self.assertEqual((stopped.status, stopped.block_kind, stopped.current_run_id),
                         ("blocked", "friday_stopped", None))
        self.assertEqual(signals, [(55123, signal.SIGTERM)])
        self.assertTrue(self.kanban.unblock_task(self.db, task_id, **self.expected(task_id)))
        self.assertEqual(self.kanban.get_task(self.db, task_id).status, "ready")

    def test_retry_archived_and_friday_stopped_use_real_transition_helpers(self):
        archived = self.task()
        self.assertTrue(self.kanban.archive_task(self.db, archived))
        expected = self.expected(archived)
        self.assertTrue(self.api._set_status_direct(self.db, archived, "ready", **expected))
        self.assertEqual(self.kanban.get_task(self.db, archived).status, "ready")
        stopped = self.task()
        with self.kanban.write_txn(self.db):
            self.db.execute("UPDATE tasks SET status = 'blocked', block_kind = 'friday_stopped' WHERE id = ?", (stopped,))
            self.kanban._append_event(self.db, stopped, "blocked")
        expected = self.expected(stopped)
        self.assertTrue(self.kanban.unblock_task(self.db, stopped, **expected))
        resumed = self.kanban.get_task(self.db, stopped)
        self.assertEqual((resumed.status, resumed.current_run_id), ("ready", None))

    def test_stale_event_and_replaced_run_do_not_touch_new_worker(self):
        task_id = self.task()
        stale = self.expected(task_id)
        self.kanban.claim_task(self.db, task_id, claimer=self.kanban._host_prefix() + "new-run")
        current = self.kanban.get_task(self.db, task_id)
        self.assertFalse(self.kanban.archive_task(self.db, task_id, **stale))
        self.assertEqual(self.kanban.get_task(self.db, task_id).current_run_id, current.current_run_id)
        self.assertEqual(self.kanban.get_task(self.db, task_id).status, "running")
        self.assertFalse(self.api._set_status_direct(self.db, task_id, "ready", **stale))
        self.assertEqual(self.kanban.get_task(self.db, task_id).claim_lock, current.claim_lock)

    def test_real_routes_return_409_after_replacement_claim(self):
        @contextmanager
        def fixture_board(_board):
            yield "default", self.db

        cancel_id = self.task()
        stale_cancel = self.api.FridayLifecycleBody(**self.expected(cancel_id))
        self.kanban.claim_task(self.db, cancel_id, claimer=self.kanban._host_prefix() + "cancel-replacement")
        retry_id = self.task()
        self.assertTrue(self.kanban.archive_task(self.db, retry_id))
        stale_retry = self.api.FridayLifecycleBody(**self.expected(retry_id))
        self.assertTrue(self.api._set_status_direct(self.db, retry_id, "ready", **self.expected(retry_id)))
        self.kanban.claim_task(self.db, retry_id, claimer=self.kanban._host_prefix() + "retry-replacement")
        before = {task_id: self.kanban.get_task(self.db, task_id).current_run_id
                  for task_id in (cancel_id, retry_id)}
        with patch.object(self.api, "_board_conn", fixture_board):
            for endpoint, task_id, payload in (
                (self.api.friday_cancel_task, cancel_id, stale_cancel),
                (self.api.friday_retry_task, retry_id, stale_retry),
            ):
                with self.assertRaises(self.api.HTTPException) as caught:
                    endpoint(task_id, payload, board="default")
                self.assertEqual(caught.exception.status_code, 409)
                current = self.kanban.get_task(self.db, task_id)
                self.assertEqual((current.status, current.current_run_id), ("running", before[task_id]))


if __name__ == "__main__":
    unittest.main()
