import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("telephony_runner", Path(__file__).with_name("telephony_runner.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class TelephonyRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "telephony"
        self.root_patch = patch.object(runner, "ROOT", self.root)
        self.profile_patch = patch.object(runner, "PROFILE", self.root / "profile.json")
        self.root_patch.start()
        self.profile_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.profile_patch.stop)

    def test_profile_is_private_and_saved_values_do_not_claim_adapter_readiness(self):
        profile = dict(mode="trunk", ariUser="friday", ariPassword="long-secret-123", ariPort=8088,
                       ownerEndpoint="friday-owner", callerId="+491701234567", sipHost="sip.example.test",
                       sipUser="acct123", sipPassword="sip-secret-123")
        with patch.object(runner, "ari", return_value=(0, {})):
            result = runner.configure({"profile": profile, "revision": 0})
        self.assertTrue(result["configured"])
        self.assertFalse(result["ready"])
        self.assertFalse(result["ariReachable"])
        self.assertNotIn("sipPassword", json.dumps(result))
        self.assertEqual(stat.S_IMODE((self.root / "profile.json").stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.root / "pjsip.friday.conf").stat().st_mode), 0o600)

    def test_real_status_requires_ari_owner_endpoint_and_exact_registration(self):
        profile = dict(mode="trunk", ariUser="friday", ariPassword="long-secret-123", ariPort=8088,
                       ownerEndpoint="friday-owner", callerId="+491701234567", sipHost="sip.example.test",
                       sipUser="acct123", sipPassword="sip-secret-123", revision=1)
        self.root.mkdir()
        runner.PROFILE.write_text(json.dumps(profile))
        def fake_ari(_profile, _method, path, _body=None):
            return (200, {"state": "online"}) if path.startswith("endpoints/") else (200, {})
        def fake_cli(command):
            return "friday-trunk-reg Registered" if "registration" in command else "friday-outbound Dial(PJSIP/${EXTEN}@friday-trunk,60)"
        with patch.object(runner, "ari", side_effect=fake_ari), patch.object(runner, "asterisk", side_effect=fake_cli), patch.object(runner, "installed_matches", return_value=True):
            self.assertTrue(runner.status()["ready"])
        with patch.object(runner, "ari", side_effect=fake_ari), patch.object(runner, "asterisk", return_value="other-trunk Registered"), patch.object(runner, "installed_matches", return_value=True):
            self.assertFalse(runner.status()["ready"])

    def test_originate_targets_owner_first_and_rejects_invalid_destination(self):
        profile = dict(mode="trunk", ariUser="friday", ariPassword="long-secret-123", ariPort=8088,
                       ownerEndpoint="friday-owner", callerId="+491701234567", sipHost="sip.example.test",
                       sipUser="acct123", sipPassword="sip-secret-123", revision=1)
        self.root.mkdir()
        runner.PROFILE.write_text(json.dumps(profile))
        with patch.object(runner, "status", return_value={"ready": True}), patch.object(runner, "ari", return_value=(200, {})) as ari:
            result = runner.originate({"callId": "call_" + "a" * 32, "number": "+491701234568"})
            self.assertTrue(result["accepted"])
            self.assertEqual(ari.call_args.args[2], "channels")
            body = ari.call_args.args[3]
            self.assertEqual(body["endpoint"], "PJSIP/friday-owner")
            self.assertEqual(body["extension"], "491701234568")
            with self.assertRaises(ValueError):
                runner.originate({"callId": "call_" + "b" * 32, "number": "sip:attacker@example.test"})
            self.assertEqual(ari.call_count, 1)


if __name__ == "__main__":
    unittest.main()
