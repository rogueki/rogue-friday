import base64
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


PLUGIN = Path(__file__).with_name("friday_memory_plugin") / "__init__.py"


class MessengerAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.key = base64.b64encode(b"k" * 32).decode()
        self.settings = self.home / "memory.sqlite"
        with sqlite3.connect(self.settings) as db:
            db.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT)")
            db.execute("INSERT INTO metadata VALUES (?,?)", ("capture_settings", json.dumps({
                "enabled": True, "privateMode": False, "channels": {"messenger": True}})))
        self.config = self.home / "bridge.json"
        self.config.write_text(json.dumps({"port": 48111, "accountId": "default",
                                           "hermesHome": str(self.home), "settingsDb": str(self.settings)}))
        self.keyfile = self.home / "bridge.key"
        self.keyfile.write_text(self.key)
        spec = importlib.util.spec_from_file_location("friday_memory_plugin_test", PLUGIN)
        self.plugin = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.plugin)
        self.plugin.MESSENGER_CONFIG = self.config
        self.plugin.MESSENGER_KEY = self.keyfile
        self.source = {"platform": "telegram", "profile": None, "chat_type": "dm",
                       "user_id": "18412", "chat_id": "18412"}
        self.patches = [patch.dict(sys.modules, {"hermes_constants": types.SimpleNamespace(
            get_hermes_home=lambda: self.home)})]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def call(self, text="Hallo", session="telegram:18412"):
        return self.plugin._messenger_admitted(source=self.source, platform="telegram",
                                               message_id="m-1", text=text, session_key=session)

    def test_admitted_owner_link_candidate_is_forwarded_with_scoped_key(self):
        requests = []
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return b'{"data":{"reason":"unlinked"}}'
        def open_request(request, timeout):
            requests.append(request)
            self.assertEqual(timeout, 1.5)
            return Response()
        with patch.object(self.plugin, "urlopen", open_request):
            self.assertIsNone(self.call())
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].get_header("Authorization"), f"Bearer {self.key}")
        self.assertEqual(json.loads(requests[0].data)["senderId"], "18412")

    def test_private_session_and_wrong_routed_home_never_forward(self):
        requests = []
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return b'{"data":{"reason":"private"}}'
        def open_request(request, timeout):
            requests.append(json.loads(request.data))
            return Response()
        with patch.object(self.plugin, "urlopen", open_request):
            self.call("Do not store this conversation")
            self.call("harmloser Folgetext")
            with patch.dict(sys.modules, {"hermes_constants": types.SimpleNamespace(
                get_hermes_home=lambda: self.home / "other")}):
                self.call("anderes Profil", "another")
        self.assertEqual(len(requests), 2)
        self.assertTrue(all(item["suppressionReason"] == "private" and item["text"] == "" for item in requests))

    def test_disabled_policy_never_forwards(self):
        with sqlite3.connect(self.settings) as db:
            db.execute("UPDATE metadata SET value=?", (json.dumps({
                "enabled": True, "privateMode": False, "channels": {"messenger": False}}),))
        with patch.object(self.plugin, "urlopen") as open_request:
            self.call()
        self.assertEqual(json.loads(open_request.call_args.args[0].data)["suppressionReason"], "policy_disabled")
        self.assertEqual(json.loads(open_request.call_args.args[0].data)["text"], "")


if __name__ == "__main__":
    unittest.main()
