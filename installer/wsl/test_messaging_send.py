import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("messaging_send", Path(__file__).with_name("messaging_send.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class MessengerSendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = Path(self.tmp.name)
        root = home / "hermes-agent"
        (root / "hermes_cli").mkdir(parents=True)
        (root / "hermes_cli" / "send_cmd.py").write_text("# pinned fake\n")
        cli = home / "hermes"
        cli.write_text("# fake\n")
        self.patches = [patch.object(bridge, "ROOT", root), patch.object(bridge, "CLI", cli),
                        patch.object(bridge, "configured_revision", return_value="a" * 64)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.calls = []

    def runner(self, argv, **kwargs):
        self.calls.append((argv, kwargs))
        if argv[0] == "git":
            return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
        return subprocess.CompletedProcess(argv, 0, json.dumps({"success": True, "message_id": "provider-1"}), "")

    def request(self, **changes):
        request = {"action": "send", "platform": "telegram", "recipient": "12345678", "text": "Synthetic hello",
                   "expectedConfigRevision": "a" * 64, **changes}
        if request["action"] == "check":
            request.pop("expectedConfigRevision")
        return request

    def test_check_never_sends_and_send_uses_exact_argv_with_body_only_on_stdin(self):
        self.assertEqual(bridge.send(self.request(action="check"), self.runner),
                         {"state": "configured", "revision": "a" * 64})
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(bridge.send(self.request(), self.runner), {"state": "sent", "externalId": "provider-1"})
        argv, kwargs = self.calls[-1]
        self.assertEqual(argv[1:], ["send", "--to", "telegram:12345678", "--file", "-", "--json"])
        self.assertEqual(kwargs["input"], "Synthetic hello")
        self.assertNotIn("Synthetic hello", " ".join(argv))

    def test_invalid_target_or_media_is_rejected_before_send(self):
        self.assertEqual(bridge.send(self.request(recipient="room/unsafe"), self.runner)["reason"], "invalid_target_or_text")
        self.assertEqual(bridge.send(self.request(text="MEDIA:/private/file"), self.runner)["reason"], "invalid_target_or_text")
        self.assertEqual(self.calls, [])

    def test_matrix_colon_target_and_missing_configuration(self):
        self.assertEqual(bridge.send(self.request(platform="matrix", recipient="@user:example.org"), self.runner)["state"], "sent")
        with patch.object(bridge, "configured_revision", return_value=None):
            self.assertEqual(bridge.send(self.request(action="check"), self.runner)["reason"], "platform_not_configured")

    def test_account_change_between_check_and_send_rejects_before_cli(self):
        self.assertEqual(bridge.send(self.request(expectedConfigRevision="b" * 64), self.runner),
                         {"state": "rejected", "reason": "configuration_changed"})
        self.assertEqual(len(self.calls), 1)  # pinned git check only

    def test_unavailable_config_probe_is_distinct_from_unconfigured(self):
        with patch.object(bridge, "configured_revision", side_effect=RuntimeError("missing Hermes runtime")):
            self.assertEqual(bridge.send(self.request(action="check"), self.runner),
                             {"state": "rejected", "reason": "config_probe_unavailable"})
        with patch.object(bridge, "configured_revision", return_value=None):
            self.assertEqual(bridge.send(self.request(action="check"), self.runner),
                             {"state": "rejected", "reason": "platform_not_configured"})

    def test_timeout_and_malformed_receipt_are_uncertain(self):
        def timeout(argv, **kwargs):
            if argv[0] == "git":
                return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
            raise subprocess.TimeoutExpired(argv, 30)
        self.assertEqual(bridge.send(self.request(), timeout), {"state": "uncertain"})
        def malformed(argv, **kwargs):
            if argv[0] == "git":
                return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
            return subprocess.CompletedProcess(argv, 0, "not-json", "")
        self.assertEqual(bridge.send(self.request(), malformed), {"state": "uncertain"})
        def negative(argv, **kwargs):
            if argv[0] == "git":
                return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
            return subprocess.CompletedProcess(argv, 1, '{"error":"provider denied","success":false}', "")
        self.assertEqual(bridge.send(self.request(), negative), {"state": "uncertain"})


if __name__ == "__main__":
    unittest.main()
