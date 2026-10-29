"""Tests for the Hermes pairing helper: listing, approving, revoking and refusal of unknown actions."""
import importlib.util
import io
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HELPER = Path(__file__).with_name("hermes_pairing_store.py")


class FakeStore:
    """Same shape as gateway.pairing.PairingStore, with one pending and one approved telegram entry."""

    def __init__(self):
        self.pending = {
            "telegram": [
                {"platform": "telegram", "request_id": "0123456789abcdef", "user_id": "424242",
                 "user_name": "Alex", "age_minutes": 3},
                {"platform": "telegram", "request_id": "", "user_id": "77", "user_name": "Alt",
                 "age_minutes": 1},
            ],
            "discord": [],
            "whatsapp": [],
        }
        self.approved = {
            "telegram": [{"platform": "telegram", "user_id": "515151", "user_name": "Sam",
                           "approved_at": 1793260000.0}],
            "discord": [],
            "whatsapp": [],
        }

    def list_pending(self, platform):
        return [dict(entry) for entry in self.pending.get(platform, [])]

    def list_approved(self, platform):
        return [dict(entry) for entry in self.approved.get(platform, [])]

    def approve_request(self, platform, request_id):
        for index, entry in enumerate(self.pending.get(platform, [])):
            if entry["request_id"] == request_id:
                del self.pending[platform][index]
                self.approved.setdefault(platform, []).append(
                    {"platform": platform, "user_id": entry["user_id"], "user_name": entry["user_name"],
                     "approved_at": 1793260001.0})
                return {"user_id": entry["user_id"], "user_name": entry["user_name"]}
        return None

    def revoke(self, platform, user_id):
        if platform != "telegram" or user_id != "515151":
            return False
        self.approved["telegram"] = [entry for entry in self.approved["telegram"]
                                    if entry["user_id"] != user_id]
        return True


def node_keys(node):
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from node_keys(value)
    elif isinstance(node, list):
        for item in node:
            yield from node_keys(item)


def platform_of(payload, name):
    return next(entry for entry in payload["platforms"] if entry["platform"] == name)


class PairingStoreHelperTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.saved = {name: sys.modules.get(name) for name in ("gateway", "gateway.pairing")}
        gateway = types.ModuleType("gateway")
        pairing = types.ModuleType("gateway.pairing")
        pairing.PairingStore = FakeStore
        gateway.pairing = pairing
        sys.modules["gateway"] = gateway
        sys.modules["gateway.pairing"] = pairing
        spec = importlib.util.spec_from_file_location("hermes_pairing_store", HELPER)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    @classmethod
    def tearDownClass(cls):
        for name, module in cls.saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module

    def setUp(self):
        self.store = FakeStore()

    def invoke_helper(self, request):
        stdout = io.StringIO()
        with patch("sys.stdin", io.StringIO(json.dumps(request))), \
                patch("sys.stdout", stdout), \
                patch.object(self.module, "PairingStore", lambda: self.store):
            code = self.module.main()
        return code, json.loads(stdout.getvalue())

    def test_list_shows_pending_and_approved_without_codes(self):
        code, payload = self.invoke_helper({"action": "list"})
        self.assertEqual(code, 0)
        telegram = platform_of(payload, "telegram")
        self.assertEqual(telegram["pending"], [{"requestId": "0123456789abcdef", "userId": "424242",
                                                "userName": "Alex", "ageMinutes": 3}])
        self.assertTrue(telegram["approved"][0]["approvedAt"].endswith("Z"))
        self.assertEqual(platform_of(payload, "discord"), {"platform": "discord", "pending": [], "approved": []})
        self.assertEqual(platform_of(payload, "whatsapp"), {"platform": "whatsapp", "pending": [], "approved": []})
        self.assertNotIn("code", set(node_keys(payload)))

    def test_approve_moves_the_request_and_rejects_unknown_ids(self):
        code, payload = self.invoke_helper({"action": "approve", "platform": "telegram",
                                  "requestId": "0123456789abcdef"})
        self.assertEqual(code, 0)
        self.assertIn("424242", [entry["userId"] for entry in platform_of(payload, "telegram")["approved"]])
        self.assertEqual(self.invoke_helper({"action": "approve", "platform": "telegram",
                                   "requestId": "ffffffffffffffff"}),
                         (4, {"error": "pairing_request_not_found"}))

    def test_revoke_removes_the_user_and_rejects_unknown_ids(self):
        code, payload = self.invoke_helper({"action": "revoke", "platform": "telegram", "userId": "515151"})
        self.assertEqual(code, 0)
        self.assertEqual(platform_of(payload, "telegram")["approved"], [])
        self.assertEqual(self.invoke_helper({"action": "revoke", "platform": "telegram", "userId": "999"}),
                         (4, {"error": "pairing_user_not_found"}))

    def test_unknown_action_is_refused(self):
        self.assertEqual(self.invoke_helper({"action": "wipe"}), (2, {"error": "invalid_request"}))


if __name__ == "__main__":
    unittest.main()
