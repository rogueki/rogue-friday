import base64
import importlib.util
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from configure_studio_bridge import PLUGIN_NAME, configure

INSTALLER = Path(__file__).resolve().parents[1]
KEY = base64.b64encode(b"k" * 32).decode("ascii")


def load_plugin():
    spec = importlib.util.spec_from_file_location("friday_studio_plan_under_test", INSTALLER / "wsl/friday_studio_plan_plugin/__init__.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeStudio(BaseHTTPRequestHandler):
    revision = 3
    plan = {}
    seen = []

    def _reply(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        FakeStudio.seen.append(("GET", self.path, self.headers.get("Authorization"), None))
        self._reply(200, {"data": {"revision": FakeStudio.revision, "plan": FakeStudio.plan}})

    def do_PUT(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeStudio.seen.append(("PUT", self.path, self.headers.get("Authorization"), self.headers.get("If-Match")))
        if self.headers.get("If-Match") != str(FakeStudio.revision):
            return self._reply(409, {"error": {"code": "CONFLICT"}})
        FakeStudio.revision += 1
        FakeStudio.plan = body
        self._reply(200, {"data": {"revision": FakeStudio.revision, "plan": body}})

    def log_message(self, *args):
        pass


class StudioPlanBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name) / "home"
        self.home.mkdir()
        FakeStudio.revision, FakeStudio.plan, FakeStudio.seen = 3, {"version": 1, "content": [], "postings": []}, []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeStudio)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def tools(self):
        registered = {}

        class Ctx:
            def register_tool(self, name, toolset, schema, handler):
                registered[name] = handler

        load_plugin().register(Ctx())
        return registered

    def test_configure_installs_private_plugin_and_is_idempotent(self):
        hermes = self.home / ".hermes"
        hermes.mkdir()
        config = hermes / "config.yaml"
        config.write_text("model: test\nplugins:\n  enabled:\n    - existing\n", encoding="utf-8")
        self.assertTrue(configure(INSTALLER, self.port, KEY, self.home))
        self.assertFalse(configure(INSTALLER, self.port, KEY, self.home))
        text = config.read_text(encoding="utf-8")
        self.assertIn("existing", text)
        self.assertIn(PLUGIN_NAME, text)
        for path in (hermes / "friday-studio-plan-bridge.key", hermes / "friday-studio-plan-bridge.json",
                     hermes / "plugins" / PLUGIN_NAME / "__init__.py"):
            self.assertEqual(path.stat().st_mode & 0o077, 0, path)
        self.assertEqual(json.loads((hermes / "friday-studio-plan-bridge.json").read_text(encoding="utf-8")), {"port": self.port})
        with self.assertRaises(ValueError):
            configure(INSTALLER, self.port, "kein-schluessel", self.home)

    def test_plugin_reads_and_saves_only_with_current_revision(self):
        configure(INSTALLER, self.port, KEY, self.home)
        tools = self.tools()
        plan = {"version": 1, "content": [{"id": "idea-1"}], "postings": []}
        with patch.object(Path, "home", return_value=self.home):
            read = json.loads(tools["friday_studio_plan_read"]({}))
            self.assertEqual((read["status"], read["revision"], read["write_effect"]), ("completed", 3, False))
            stale = json.loads(tools["friday_studio_plan_write"]({"plan": plan, "revision": 2}))
            self.assertEqual((stale["status"], stale["error"]["code"], stale["write_effect"]), ("blocked", "revision_conflict", False))
            self.assertEqual(FakeStudio.revision, 3)
            saved = json.loads(tools["friday_studio_plan_write"]({"plan": plan, "revision": 3}))
            self.assertEqual((saved["status"], saved["revision"], saved["write_effect"]), ("completed", 4, True))
            self.assertEqual(FakeStudio.plan, plan)
            self.assertEqual(json.loads(tools["friday_studio_plan_write"]({"plan": plan}))["error"]["code"], "invalid_request")
            self.assertEqual(json.loads(tools["friday_studio_plan_read"]({"x": 1}))["error"]["code"], "invalid_request")
        self.assertEqual({entry[1] for entry in FakeStudio.seen}, {"/api/v1/content-studio/plan"})
        self.assertTrue(all(entry[2] == f"Bearer {KEY}" for entry in FakeStudio.seen))
        self.assertEqual([entry[3] for entry in FakeStudio.seen if entry[0] == "PUT"], ["2", "3"])

    def test_plugin_refuses_a_key_file_readable_by_others(self):
        configure(INSTALLER, self.port, KEY, self.home)
        os.chmod(self.home / ".hermes/friday-studio-plan-bridge.key", 0o644)
        with patch.object(Path, "home", return_value=self.home):
            result = json.loads(self.tools()["friday_studio_plan_read"]({}))
        self.assertEqual((result["status"], result["error"]["code"]), ("blocked", "bridge_not_private"))
        self.assertEqual(FakeStudio.seen, [])


if __name__ == "__main__":
    unittest.main()
