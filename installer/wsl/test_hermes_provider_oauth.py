"""Anbieter-Anmeldung per Device-Code: Besitzerbindung, Abbruch, Zeitablauf und Hermes' Sitzungszustaende."""

import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hermes_provider_oauth as po

REAL_SLEEP = time.sleep


class FakeRoutes:
    """Bildet das Sitzungs-Dict von hermes_cli.web_routers.oauth nach."""

    def __init__(self, **result):
        self._oauth_sessions = {}
        self._oauth_sessions_lock = threading.Lock()
        self.result = {"session_id": "sid-1", "flow": "device_code", "user_code": "ABCD-1234",
                       "verification_url": "https://auth.example.org/device", "expires_in": 600,
                       "poll_interval": 5, **result}
        self.started = []
        self.session = None
        self.fail = False

    async def _start_device_code_flow(self, provider, profile=None):
        self.started.append(provider)
        if self.fail:
            raise RuntimeError("provider refused")
        if isinstance(self.result.get("session_id"), str):
            self.session = {"status": "pending"}
            self._oauth_sessions[self.result["session_id"]] = self.session
        return self.result


class ProviderOAuthTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / ".hermes"
        self.source = self.home / "hermes-agent"
        self.source.mkdir(parents=True)
        self.root = self.home / ".friday-provider-oauth"

    def new_flow(self, letter="a", status="starting", **fields):
        self.root.mkdir(mode=0o700, exist_ok=True)
        flow_dir = self.root / (letter * 32)
        flow_dir.mkdir()
        (flow_dir / "owner.json").write_text(json.dumps({"ownerId": "owner-1", "provider": "nous"}))
        po.write_state(flow_dir, status, **fields)
        return flow_dir

    def run_worker(self, flow_dir, routes, tick=None, head=po.PINNED_SOURCE, provider="nous"):
        request = {"flowDir": str(flow_dir), "provider": provider, "source": str(self.source), "home": str(self.home)}
        web_routers = types.ModuleType("hermes_cli.web_routers")
        web_routers.oauth = routes
        git = types.SimpleNamespace(returncode=0, stdout=head + "\n")
        ticks = []

        def bounded(seconds):
            # Ein nicht erkannter Zustand darf den Test nicht bis zur echten Frist pollen lassen.
            ticks.append(seconds)
            if len(ticks) > 20:
                raise RuntimeError("worker kept polling")
            if tick:
                tick(seconds)

        with patch.dict(sys.modules, {"hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli.web_routers": web_routers}), \
             patch.object(po, "arm_hard_deadline"), patch.object(po.subprocess, "run", return_value=git), \
             patch.object(po.time, "sleep", side_effect=bounded), \
             patch.object(sys, "stdin", io.StringIO(json.dumps(request))):
            code = po.main()
        return code, json.loads((flow_dir / "state.json").read_text())

    def test_approval_reports_configured_after_showing_code_and_link(self):
        flow_dir = self.new_flow()
        routes = FakeRoutes()
        seen = []

        def tick(_seconds):
            seen.append(json.loads((flow_dir / "state.json").read_text()))
            routes.session["status"] = "approved"

        code, state = self.run_worker(flow_dir, routes, tick)
        self.assertEqual(code, 0)
        self.assertEqual(state["status"], "configured")
        self.assertEqual(routes.started, ["nous"])
        self.assertEqual(seen[0]["status"], "awaiting_approval")
        self.assertEqual(seen[0]["userCode"], "ABCD-1234")
        self.assertEqual(seen[0]["verificationUrl"], "https://auth.example.org/device")
        self.assertRegex(seen[0]["expiresAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

    def test_hermes_session_outcomes_fail_with_their_own_class(self):
        for letter, outcome, expected in (("b", "denied", "oauth_denied"), ("c", "expired", "oauth_expired"),
                                          ("d", "error", "oauth_error"), ("e", "cancelled", "oauth_cancelled"),
                                          ("f", None, "oauth_expired")):
            flow_dir = self.new_flow(letter)
            routes = FakeRoutes()

            def tick(_seconds, routes=routes, outcome=outcome):
                if outcome is None:
                    routes._oauth_sessions.clear()
                else:
                    routes.session["status"] = outcome

            code, state = self.run_worker(flow_dir, routes, tick)
            self.assertEqual(code, 1, outcome)
            self.assertEqual(state, {"status": "failed", "updatedAt": state["updatedAt"], "failureClass": expected})

    def test_cancel_marker_ends_the_hermes_session(self):
        flow_dir = self.new_flow()
        routes = FakeRoutes()
        code, state = self.run_worker(flow_dir, routes, lambda _seconds: (flow_dir / "cancel").touch())
        self.assertEqual(code, 1)
        self.assertEqual(state["failureClass"], "oauth_cancelled")
        self.assertEqual(routes._oauth_sessions, {})
        self.assertTrue(routes.session["cancelled"])

    def test_expiry_cancels_the_session_instead_of_waiting_forever(self):
        flow_dir = self.new_flow()
        routes = FakeRoutes(expires_in=1)
        code, state = self.run_worker(flow_dir, routes, lambda _seconds: REAL_SLEEP(0.6))
        self.assertEqual(code, 1)
        self.assertEqual(state["failureClass"], "oauth_timeout")
        self.assertTrue(routes.session["cancelled"])

    def test_unusable_start_answers_fail_closed(self):
        flow_dir = self.new_flow("b")
        routes = FakeRoutes(verification_url="http://auth.example.org/device")
        code, state = self.run_worker(flow_dir, routes)
        self.assertEqual((code, state["failureClass"]), (1, "oauth_start_invalid"))
        self.assertEqual(routes._oauth_sessions, {})
        flow_dir = self.new_flow("c")
        routes = FakeRoutes()
        routes.fail = True
        code, state = self.run_worker(flow_dir, routes)
        self.assertEqual((code, state["failureClass"]), (1, "oauth_start_failed"))

    def test_unpinned_source_and_foreign_paths_are_refused(self):
        flow_dir = self.new_flow()
        routes = FakeRoutes()
        code, state = self.run_worker(flow_dir, routes, head="0" * 40)
        self.assertEqual((code, state["failureClass"]), (1, "unsupported_source_revision"))
        self.assertEqual(routes.started, [])
        foreign = Path(self.temp.name) / ("b" * 32)
        foreign.mkdir()
        request = {"flowDir": str(foreign), "provider": "nous", "source": str(self.source), "home": str(self.home)}
        with patch.object(po, "arm_hard_deadline"), patch.object(sys, "stdin", io.StringIO(json.dumps(request))):
            self.assertEqual(po.main(), 2)
        request = {"flowDir": str(flow_dir), "provider": "anthropic", "source": str(self.source), "home": str(self.home)}
        with patch.object(po, "arm_hard_deadline"), patch.object(sys, "stdin", io.StringIO(json.dumps(request))):
            self.assertEqual(po.main(), 2)

    def test_start_binds_the_owner_and_returns_only_display_fields(self):
        self.root.mkdir(mode=0o700)
        stale = self.root / ("b" * 32)
        stale.mkdir()
        (stale / "state.json").write_text('{"status":"failed"}')
        os.utime(stale, (time.time() - 90000, time.time() - 90000))
        sent = {}

        class FakeInput:
            def write(self, body):
                sent.update(json.loads(body))

            def close(self):
                po.write_state(Path(sent["flowDir"]), "awaiting_approval", userCode="ABCD-1234",
                               verificationUrl="https://auth.example.org/device", expiresAt="2026-10-31T10:15:00Z")

        class FakeWorker:
            stdin = FakeInput()
            pid = os.getpid()

            def poll(self):
                return None

        launchers = types.ModuleType("hermes_cli._launchers")
        launchers.runtime_command = lambda *args, **kwargs: ["provider-worker"]
        with patch.dict(sys.modules, {"hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli._launchers": launchers}), \
             patch.object(sys, "path", sys.path.copy()), \
             patch.object(po.subprocess, "Popen", return_value=FakeWorker()) as popen, \
             patch.object(po.shutil, "which", return_value="/usr/bin/timeout"):
            result = po.start(self.home, self.source, {"provider": "nous", "ownerId": "owner-1"})
            with self.assertRaisesRegex(ValueError, "invalid_request"):
                po.start(self.home, self.source, {"provider": "anthropic", "ownerId": "owner-1"})
            with self.assertRaisesRegex(ValueError, "invalid_request"):
                po.start(self.home, self.source, {"provider": "nous", "ownerId": "owner\n1"})
        self.assertEqual(result["status"], "awaiting_approval")
        self.assertEqual(result["provider"], "nous")
        self.assertRegex(result["flowId"], r"^[0-9a-f]{32}$")
        self.assertEqual(result["userCode"], "ABCD-1234")
        self.assertNotIn("updatedAt", result)
        self.assertEqual(popen.call_args.args[0], ["/usr/bin/timeout", "--signal=KILL", "970s", "provider-worker"])
        self.assertEqual(set(sent), {"flowDir", "provider", "source", "home"})
        owner = self.root / result["flowId"] / "owner.json"
        self.assertEqual(json.loads(owner.read_text()), {"ownerId": "owner-1", "provider": "nous"})
        self.assertEqual(stat.S_IMODE(owner.stat().st_mode), 0o600)
        self.assertFalse(stale.exists())

    def test_status_is_owner_bound_and_detects_a_dead_worker(self):
        flow_dir = self.new_flow(status="awaiting_approval", userCode="ABCD-1234",
                                 verificationUrl="https://auth.example.org/device", expiresAt="2026-10-31T10:15:00Z")
        (flow_dir / "worker.json").write_text(json.dumps({"pid": os.getpid(), "start": "42"}))
        request = {"flowId": "a" * 32, "ownerId": "owner-1"}
        with patch.object(po, "process_start", return_value="42"):
            alive = po.status(self.home, request)
            with self.assertRaisesRegex(ValueError, "unknown_oauth_flow"):
                po.status(self.home, {"flowId": "a" * 32, "ownerId": "another-owner"})
            with self.assertRaisesRegex(ValueError, "unknown_oauth_flow"):
                po.status(self.home, {"flowId": "c" * 32, "ownerId": "owner-1"})
        self.assertEqual(alive, {"flowId": "a" * 32, "provider": "nous", "status": "awaiting_approval",
                                 "userCode": "ABCD-1234", "verificationUrl": "https://auth.example.org/device",
                                 "expiresAt": "2026-10-31T10:15:00Z"})
        with patch.object(po, "process_start", return_value=None):
            dead = po.status(self.home, request)
        self.assertEqual(dead["status"], "failed")
        self.assertEqual(dead["failureClass"], "oauth_worker_unconfirmed")
        self.assertEqual(json.loads((flow_dir / "state.json").read_text())["status"], "failed")

    def test_cancel_marks_only_running_flows(self):
        running = self.new_flow("a", status="awaiting_approval", userCode="ABCD-1234")
        (running / "worker.json").write_text(json.dumps({"pid": os.getpid(), "start": "42"}))
        done = self.new_flow("b", status="configured")
        with patch.object(po, "process_start", return_value="42"):
            cancelled = po.status(self.home, {"flowId": "a" * 32, "ownerId": "owner-1"}, cancel=True)
            finished = po.status(self.home, {"flowId": "b" * 32, "ownerId": "owner-1"}, cancel=True)
        self.assertEqual(cancelled, {"flowId": "a" * 32, "provider": "nous", "status": "cancelling"})
        self.assertTrue((running / "cancel").exists())
        self.assertEqual(finished["status"], "configured")
        self.assertFalse((done / "cancel").exists())


if __name__ == "__main__":
    unittest.main()
