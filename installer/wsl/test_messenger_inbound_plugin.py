import base64
import hashlib
import hmac
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
        self.plugin._messenger_registration_home = str(self.home)
        self.plugin._messenger_registration_stamp = self.plugin._messenger_files_stamp(self.home)
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
        self.assertRegex(json.loads(requests[0].data)["accountEpoch"], r"^[a-f0-9]{64}$")

    def test_config_change_requires_gateway_restart_before_any_more_capture(self):
        requests = []
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return b'{"data":{"reason":"unlinked"}}'
        def open_request(request, timeout):
            requests.append(json.loads(request.data))
            return Response()
        with patch.object(self.plugin, "urlopen", open_request):
            self.call()
            (self.home / ".env").write_text("TELEGRAM_BOT_TOKEN=new-synthetic-account")
            self.call("followup")
        self.assertEqual(requests[1]["suppressionReason"], "account_changed")
        self.assertEqual(requests[1]["text"], "")

    def test_change_before_first_admission_does_not_set_new_account_as_live_baseline(self):
        (self.home / ".env").write_text("TELEGRAM_BOT_TOKEN=replaced-before-first-message")
        requests = []
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return b'{"data":{"reason":"account_changed"}}'
        def open_request(request, timeout):
            requests.append(json.loads(request.data))
            return Response()
        with patch.object(self.plugin, "urlopen", open_request):
            self.call()
        self.assertEqual(requests[0]["suppressionReason"], "account_changed")
        self.assertEqual(requests[0]["text"], "")

    def test_new_gateway_process_rotates_link_provenance_even_with_same_key(self):
        spec = importlib.util.spec_from_file_location("friday_memory_plugin_restart", PLUGIN)
        restarted = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(restarted)
        key = base64.b64decode(self.key)
        old_epoch = hmac.new(key, self.plugin._messenger_process_nonce + b"telegram", hashlib.sha256).hexdigest()
        new_epoch = hmac.new(key, restarted._messenger_process_nonce + b"telegram", hashlib.sha256).hexdigest()
        self.assertNotEqual(old_epoch, new_epoch)

    def test_named_profiles_suppress_capture_without_receiving_bot_identity(self):
        profiles = self.home / "profiles" / "other-bot"
        profiles.mkdir(parents=True)
        requests = []
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return b'{"data":{"reason":"multi_profile_unknown"}}'
        def open_request(request, timeout):
            requests.append(json.loads(request.data))
            return Response()
        with patch.object(self.plugin, "urlopen", open_request):
            self.call("Harmloser Inhalt")
        self.assertEqual(requests[0]["suppressionReason"], "multi_profile_unknown")
        self.assertEqual(requests[0]["text"], "")

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


    def test_linked_admission_binds_cross_channel_context_and_assistant_to_exact_turn(self):
        requests = []
        session = ["telegram:18412"]
        approval = types.ModuleType("tools.approval_context")
        approval.get_current_session_key = lambda default="": session[0]
        class Response:
            status = 200
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return json.dumps(self.body).encode()
        def open_request(request, timeout):
            body = json.loads(request.data)
            requests.append(body)
            if body.get("eventType") is None:
                return Response({"data": {"reason": "captured", "eventId": "messenger-" + "a" * 64,
                    "context": [{"source": "voice/friday", "occurredAt": "2026-01-01T00:00:00Z",
                                 "text": "Earlier owner conversation"}]}})
            return Response({"data": {"reason": "captured", "eventId": "messenger-" + "b" * 64}})
        with patch.dict(sys.modules, {"tools": types.ModuleType("tools"), "tools.approval_context": approval}), \
             patch.object(self.plugin, "urlopen", open_request):
            self.call()
            context = self.plugin._pre(platform="telegram", sender_id="18412", session_id="sid", turn_id="turn")
            self.assertIn("Earlier owner conversation", context["context"])
            session[0] = "telegram:other"
            self.plugin._post(platform="telegram", session_id="sid", turn_id="turn",
                              assistant_response="Antwort")
            self.assertEqual(len(requests), 1)
            session[0] = "telegram:18412"
            self.call()
            self.plugin._pre(platform="telegram", sender_id="18412", session_id="sid", turn_id="turn-2")
            self.plugin._messenger_tool(session_id="sid", turn_id="turn-2", tool_call_id="call-1",
                                        tool_name="terminal", status="error", result="secret not forwarded")
            self.plugin._post(platform="telegram", session_id="sid", turn_id="turn-2",
                              assistant_response="Antwort")
        self.assertEqual(requests[-2]["eventType"], "action_result")
        self.assertEqual(requests[-2]["actionId"], "terminal")
        self.assertEqual(requests[-2]["outcome"], "uncertain")
        self.assertNotIn("secret not forwarded", json.dumps(requests))
        self.assertEqual(requests[-1]["eventType"], "assistant_response")
        self.assertEqual(requests[-1]["admissionEventId"], "messenger-" + "a" * 64)
        self.assertEqual(requests[-1]["senderId"], "18412")


if __name__ == "__main__":
    unittest.main()
