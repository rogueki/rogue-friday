import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
import subprocess
import sys
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("bridge_health", Path(__file__).with_name("wsl-recovery-bridge-health.py"))
assert SPEC and SPEC.loader
bridge_health = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge_health)


class Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return b'{"contractVersion":"1.0.0","data":{"items":[]}}'


class BridgeHealthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.hermes = self.home / ".hermes"
        self.hermes.mkdir(mode=0o700)
        self.request = {"port": 3100, "memoryDbPath": "/mnt/c/fixture/dashboard/data/memory/outbox.sqlite", "keyDigests": {}}
        for bridge in bridge_health.BRIDGES:
            key = bytes([len(bridge)]) * 32
            self.request["keyDigests"][bridge] = hashlib.sha256(key).hexdigest()
            key_path = self.hermes / f"friday-{bridge}-bridge.key"
            key_path.write_text(base64.b64encode(key).decode() + "\n")
            key_path.chmod(0o600)
            config = {"port": 3100}
            if bridge == "messenger":
                config["hermesHome"] = str(self.hermes.resolve())
                config["accountId"] = "default"
            if bridge in ("memory", "messenger"):
                config["settingsDb"] = self.request["memoryDbPath"]
            if bridge == "memory":
                config["ownerCli"] = True
            config_path = self.hermes / f"friday-{bridge}-bridge.json"
            config_path.write_text(json.dumps(config) + "\n")
            config_path.chmod(0o600)
        plugin = self.hermes / "plugins/friday-memory/__init__.py"
        plugin.parent.mkdir(parents=True)
        plugin.write_text("def _pre(): pass\ndef _messenger_admitted(): pass\n")
        plugin.chmod(0o600)
        config = self.hermes / "config.yaml"
        config.write_text("plugins:\n  enabled:\n    - friday-memory\n    - friday-dashboard-calendar\n    - friday-dashboard-mail\n")
        config.chmod(0o600)
        marker = self.hermes / "friday-messenger-bridge-applied.sha256"
        marker.write_text(hashlib.sha256((self.hermes / "friday-messenger-bridge.key").read_bytes() +
                                         (self.hermes / "friday-messenger-bridge.json").read_bytes()).hexdigest())
        marker.chmod(0o600)

    def test_recovered_keys_and_scoped_read(self):
        with patch.object(bridge_health, "urlopen", return_value=Response()) as call:
            result = bridge_health.check(self.request, self.home)
        self.assertEqual(result["state"], "ready")
        self.assertEqual(result["readOnlyProbes"], ["memory-search"])
        self.assertEqual(call.call_args.args[0].get_method(), "GET")

    def test_key_mismatch_fails_before_http(self):
        self.request["keyDigests"]["mail"] = "0" * 64
        with patch.object(bridge_health, "urlopen") as call:
            with self.assertRaisesRegex(ValueError, "mail bridge credential"):
                bridge_health.check(self.request, self.home)
        call.assert_not_called()

    def test_private_files_and_apply_marker_required(self):
        (self.hermes / "friday-calendar-bridge.key").chmod(0o644)
        with self.assertRaisesRegex(ValueError, "accessible to other users"):
            bridge_health.check(self.request, self.home)
        (self.hermes / "friday-calendar-bridge.key").chmod(0o600)
        (self.hermes / "friday-messenger-bridge-applied.sha256").write_text("0" * 64)
        with self.assertRaisesRegex(ValueError, "not been applied"):
            bridge_health.check(self.request, self.home)

    def test_stale_policy_database_and_disabled_plugin_fail_before_http(self):
        config_path = self.hermes / "friday-memory-bridge.json"
        config = json.loads(config_path.read_text())
        config["settingsDb"] = "/mnt/c/old-install/dashboard/data/memory/outbox.sqlite"
        config_path.write_text(json.dumps(config))
        with patch.object(bridge_health, "urlopen") as call:
            with self.assertRaisesRegex(ValueError, "another memory policy database"):
                bridge_health.check(self.request, self.home)
        call.assert_not_called()
        config["settingsDb"] = self.request["memoryDbPath"]
        config_path.write_text(json.dumps(config))
        (self.hermes / "config.yaml").write_text("plugins:\n  enabled:\n    - friday-memory\n")
        with self.assertRaisesRegex(ValueError, "plugins are not enabled"):
            bridge_health.check(self.request, self.home)

    def test_api_rejects_key(self):
        from urllib.error import HTTPError
        with patch.object(bridge_health, "urlopen", side_effect=HTTPError("", 401, "unauthorized", {}, None)):
            with self.assertRaises(HTTPError):
                bridge_health.check(self.request, self.home)

    def test_real_helper_reads_scoped_loopback_api_in_synthetic_home(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                expected = (self.server.key_path).read_text().strip()
                if (self.headers.get("Authorization") != f"Bearer {expected}" or
                        not self.path.startswith("/api/v1/integrations/memory/search?")):
                    self.send_error(401)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"contractVersion":"1.0.0","data":{"items":[]}}')

            def log_message(self, *_args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        server.key_path = self.hermes / "friday-memory-bridge.key"
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            self.request["port"] = server.server_port
            for bridge in bridge_health.BRIDGES:
                config_path = self.hermes / f"friday-{bridge}-bridge.json"
                config = json.loads(config_path.read_text())
                config["port"] = server.server_port
                config_path.write_text(json.dumps(config))
            marker = self.hermes / "friday-messenger-bridge-applied.sha256"
            marker.write_text(hashlib.sha256((self.hermes / "friday-messenger-bridge.key").read_bytes() +
                                             (self.hermes / "friday-messenger-bridge.json").read_bytes()).hexdigest())
            env = {**os.environ, "HOME": str(self.home)}
            result = subprocess.run([sys.executable, str(Path(bridge_health.__file__))], input=json.dumps(self.request),
                                    text=True, capture_output=True, env=env, timeout=8, check=True)
            self.assertEqual(json.loads(result.stdout)["state"], "ready")
        finally:
            server.shutdown()
            worker.join(timeout=2)
            server.server_close()


if __name__ == "__main__":
    unittest.main()
