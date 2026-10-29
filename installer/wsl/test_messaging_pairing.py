import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest


SCRIPT = Path(__file__).with_name("messaging_pairing.py")


class PairingBridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = Path(self.tmp.name)
        bridge = home / ".hermes/hermes-agent/scripts/whatsapp-bridge"
        bridge.mkdir(parents=True)
        (bridge / "node_modules").mkdir()
        (bridge / "bridge.js").write_text("// fake upstream bridge\n", encoding="utf-8")
        fake_bin = home / "bin"
        fake_bin.mkdir()
        git = fake_bin / "git"
        git.write_text("#!/bin/sh\necho d923a5eb\n", encoding="utf-8")
        git.chmod(0o755)
        node = fake_bin / "fake-node"
        node.write_text("#!/bin/sh\ncase \"$1\" in *whatsapp_logout.mjs) if [ \"$FAKE_LOGOUT_FAIL\" = 1 ]; then echo '{\"loggedOut\":false}'; exit 1; fi; echo '{\"loggedOut\":true}'; exit 0;; esac\n"
                        "printf '%s\\n' '{\"event\":\"qr\",\"qr\":\"FAKE_SECRET_QR\"}'\nsleep 120\n", encoding="utf-8")
        node.chmod(0o755)
        for command in ("systemctl",):
            fake = fake_bin / command
            fake.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            fake.chmod(0o755)
        cli = home / ".local/bin/hermes"
        cli.parent.mkdir(parents=True)
        cli.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        cli.chmod(0o755)
        (home / ".hermes/hermes-agent/hermes_constants.py").write_text(
            f"def find_node_executable(command): return {str(node)!r}\n"
            "def with_hermes_node_path():\n    import os\n    return os.environ.copy()\n", encoding="utf-8")
        self.env = {**os.environ, "HOME": str(home), "PATH": f"{fake_bin}:{os.environ['PATH']}"}

    def call(self, *args):
        proc = subprocess.run(["python3", str(SCRIPT), *args], env=self.env,
                              capture_output=True, text=True, timeout=10, check=False)
        return proc.returncode, json.loads(proc.stdout)

    def test_qr_refresh_cancel_and_expiry_without_real_connector(self):
        code, first = self.call("start", "bot")
        self.assertEqual(code, 0, first)
        self.assertEqual(first["state"], "starting")
        for _ in range(30):
            time.sleep(0.1)
            _, current = self.call("status")
            if current["state"] == "waiting":
                break
        self.assertEqual(current["state"], "waiting")
        self.assertEqual(current["qr"], "FAKE_SECRET_QR")
        self.assertNotIn("FAKE_SECRET_QR", (Path(self.tmp.name) / ".hermes/friday-whatsapp-pairing/lock").read_text())
        state_file = Path(self.tmp.name) / ".hermes/friday-whatsapp-pairing/state.json"
        self.assertEqual(state_file.stat().st_mode & 0o777, 0o600)
        raw = json.loads(state_file.read_text())
        raw["qrAt"] = time.time() - 61
        state_file.write_text(json.dumps(raw))
        _, expired = self.call("status")
        self.assertEqual(expired["state"], "qr_expired")
        self.assertIsNone(expired["qr"])
        self.assertNotIn("FAKE_SECRET_QR", state_file.read_text())
        _, refreshed = self.call("refresh", "self-chat")
        self.assertNotEqual(refreshed["id"], first["id"])
        self.assertEqual(refreshed["mode"], "self-chat")
        _, cancelled = self.call("cancel")
        self.assertEqual(cancelled["state"], "cancelled")
        self.assertIsNone(cancelled["qr"])

    def test_pairing_never_starts_over_a_linked_session(self):
        session = Path(self.tmp.name) / ".hermes/platforms/whatsapp/session"
        session.mkdir(parents=True)
        creds = session / "creds.json"
        original = '{"me":{"id":"491701234567@s.whatsapp.net"}}'
        creds.write_text(original)
        for action, mode in (("start", "bot"), ("refresh", "self-chat")):
            code, result = self.call(action, mode)
            self.assertEqual((code, result), (4, {"error": "linked_session_present"}))
        _, status = self.call("status")
        self.assertEqual(status["state"], "idle")
        self.assertEqual(status["linkedIdentity"], "491701234567@s.whatsapp.net")
        self.assertEqual(creds.read_text(), original)

    def test_logout_only_after_fake_remote_confirmation(self):
        session = Path(self.tmp.name) / ".hermes/platforms/whatsapp/session"
        session.mkdir(parents=True)
        (session / "creds.json").write_text('{"me":{"id":"491701234567@s.whatsapp.net"}}')
        env = Path(self.tmp.name) / ".hermes/.env"
        env.write_text('WHATSAPP_ENABLED="true"\nWHATSAPP_MODE="bot"\n')
        code, result = self.call("logout")
        self.assertEqual(code, 0, result)
        self.assertEqual(result["state"], "idle")
        self.assertFalse(session.exists())
        self.assertIn('WHATSAPP_ENABLED="false"', env.read_text())

    def test_failed_remote_logout_keeps_local_credentials(self):
        session = Path(self.tmp.name) / ".hermes/platforms/whatsapp/session"
        session.mkdir(parents=True)
        creds = session / "creds.json"
        creds.write_text('{"me":{"id":"491701234567@s.whatsapp.net"}}')
        self.env["FAKE_LOGOUT_FAIL"] = "1"
        code, result = self.call("logout")
        self.assertEqual((code, result["error"]), (5, "remote_logout_unconfirmed"))
        self.assertTrue(creds.exists())


if __name__ == "__main__":
    unittest.main()
