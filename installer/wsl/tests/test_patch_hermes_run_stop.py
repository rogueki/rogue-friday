import importlib.util
import sqlite3
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Optional


PATCH = Path(__file__).resolve().parents[1] / "patch_hermes_run_stop.py"
spec = importlib.util.spec_from_file_location("patch_hermes_run_stop", PATCH)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class RunStopCasTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript("""
            CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT, current_run_id INTEGER,
                claim_lock TEXT, worker_pid INTEGER, worker_started_at INTEGER,
                claim_expires INTEGER, block_kind TEXT);
            CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, ended_at INTEGER, status TEXT);
            CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT);
            INSERT INTO tasks VALUES ('t_one','running',1,'lock-one',111,100,999,NULL);
            INSERT INTO task_runs VALUES (1,'t_one',NULL,'running');
            INSERT INTO task_events VALUES (1,'t_one');
        """)
        self.signalled = []
        self.events = []

        @contextmanager
        def write_txn(conn):
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield
            except Exception:
                conn.rollback()
                raise
            else:
                conn.commit()

        def record(conn, task_id, termination, *, error, payload):
            current = conn.execute("SELECT current_run_id FROM tasks WHERE id = ?", (task_id,)).fetchone()[0]
            conn.execute("UPDATE task_runs SET ended_at = 123, status = 'reclaimed' WHERE id = ?", (current,))
            conn.execute("UPDATE tasks SET current_run_id = NULL WHERE id = ?", (task_id,))
            self.events.append(("reclaimed", current, payload))

        def signal(pid, lock, *, signal_fn=None, started_at=None):
            if pid is None:
                return {"terminated": False}
            self.signalled.append((pid, lock, started_at))
            return {"signalled": True}

        def event(conn, task_id, kind, payload, *, run_id):
            self.events.append((kind, run_id, payload))

        namespace = {"sqlite3": sqlite3, "Optional": Optional, "write_txn": write_txn,
            "_record_reclaim": record, "_terminate_reclaimed_worker": signal,
            "_worker_alive": lambda pid, started_at: False, "_append_event": event}
        exec(module.RUN_STOP, namespace)
        self.stop = namespace["friday_terminate_run"]
        self.matches = namespace["friday_lifecycle_matches"]

    def tearDown(self):
        self.conn.close()

    def test_named_run_is_blocked_and_signalled_once(self):
        self.assertTrue(self.stop(self.conn, 1, reason="user"))
        task = self.conn.execute("SELECT status, block_kind, current_run_id FROM tasks").fetchone()
        self.assertEqual(tuple(task), ("blocked", "friday_stopped", None))
        self.assertEqual(self.signalled, [(111, "lock-one", 100)])
        self.assertFalse(self.stop(self.conn, 1, reason="repeat"))
        self.assertEqual(len(self.signalled), 1)

    def test_stale_run_cannot_signal_replacement_worker(self):
        # The caller's earlier observation can become stale before the write transaction.
        prechecked = self.conn.execute(
            "SELECT current_run_id FROM tasks WHERE id = 't_one'").fetchone()[0]
        self.assertEqual(prechecked, 1)
        self.conn.execute("INSERT INTO task_runs VALUES (2,'t_one',NULL,'running')")
        self.conn.execute("UPDATE tasks SET current_run_id = 2, claim_lock = 'lock-two', worker_pid = 222")
        self.conn.commit()
        self.assertFalse(self.stop(self.conn, 1, reason="stale"))
        task = self.conn.execute("SELECT status, current_run_id, claim_lock, worker_pid FROM tasks").fetchone()
        self.assertEqual(tuple(task), ("running", 2, "lock-two", 222))
        self.assertIsNone(self.conn.execute("SELECT ended_at FROM task_runs WHERE id = 2").fetchone()[0])
        self.assertEqual(self.signalled, [])
        self.assertEqual(self.events, [])

    def test_a_signal_failure_rolls_back_the_stop(self):
        def fail_signal(pid, lock, *, signal_fn=None, started_at=None):
            raise RuntimeError("signal failed")
        self.stop.__globals__["_terminate_reclaimed_worker"] = fail_signal
        with self.assertRaisesRegex(RuntimeError, "signal failed"):
            self.stop(self.conn, 1)
        task = self.conn.execute("SELECT status, block_kind, current_run_id FROM tasks").fetchone()
        self.assertEqual(tuple(task), ("running", None, 1))
        self.assertIsNone(self.conn.execute("SELECT ended_at FROM task_runs WHERE id = 1").fetchone()[0])

    def test_surviving_worker_is_reported_without_redispatch(self):
        self.stop.__globals__["_worker_alive"] = lambda pid, started_at: True
        with self.assertRaisesRegex(RuntimeError, "survived termination"):
            self.stop(self.conn, 1)
        self.assertEqual(self.conn.execute("SELECT status FROM tasks").fetchone()[0], "running")

    def test_missing_pid_closes_named_run_without_signalling(self):
        self.conn.execute("UPDATE tasks SET worker_pid = NULL, worker_started_at = NULL")
        self.conn.commit()
        self.assertTrue(self.stop(self.conn, 1))
        self.assertEqual(self.signalled, [])
        self.assertEqual(self.conn.execute("SELECT status FROM tasks").fetchone()[0], "blocked")

    def test_event_revision_and_run_claim_are_checked_together(self):
        expected = dict(expected_event_id=1, expected_status="running", expected_run_id=1,
                        expected_claim_lock="lock-one")
        self.assertTrue(self.matches(self.conn, "t_one", **expected))
        self.conn.execute("INSERT INTO task_events VALUES (2,'t_one')")
        self.assertFalse(self.matches(self.conn, "t_one", **expected))
        expected["expected_event_id"] = 2
        self.conn.execute("UPDATE tasks SET current_run_id = 2, claim_lock = 'lock-two'")
        self.assertFalse(self.matches(self.conn, "t_one", **expected))


if __name__ == "__main__":
    unittest.main()
