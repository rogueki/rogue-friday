import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class McpAuthProbeTest(unittest.TestCase):
    def setUp(self):
        self.token = "CANARY-MCP-PRIVATE"
        self.entry = {"url": "https://example.org/mcp", "enabled": True,
                      "headers": {"Authorization": "Bearer ${MCP_EXAMPLE_API_KEY}"}}
        self.revision = 123
        config = types.ModuleType("hermes_cli.config")
        config.get_env_value = lambda key: self.token if key == "MCP_EXAMPLE_API_KEY" else None
        mcp = types.ModuleType("hermes_cli.mcp_config")
        mcp._env_key_for_server = lambda name: "MCP_" + name.upper() + "_API_KEY"
        mcp._bearer_auth_headers = lambda name: {"Authorization": "Bearer ${" + mcp._env_key_for_server(name) + "}"}
        mcp._get_mcp_servers = lambda: {"example": self.entry}
        bridge = types.ModuleType("hermes_config_bridge")
        bridge.revision = lambda path: self.revision
        self.probed = []
        protocol = types.ModuleType("hermes_mcp_protocol_probe")
        protocol.ProbeFailure = type("ProbeFailure", (Exception,), {})
        protocol.probe = lambda url, token: self.probed.append((url, token)) or {
            "connected": True, "toolCount": 2, "toolCountComplete": True, "failureClass": None}
        self.modules = {"hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli.config": config,
                        "hermes_cli.mcp_config": mcp, "hermes_config_bridge": bridge,
                        "hermes_mcp_protocol_probe": protocol}
        self.spec = importlib.util.spec_from_file_location("hermes_mcp_auth_probe",
            Path(__file__).with_name("hermes_mcp_auth_probe.py"))

    def invoke(self):
        module = importlib.util.module_from_spec(self.spec)
        request = {"name": "example", "url": "https://example.org/mcp", "revision": 123,
                   "configPath": "/synthetic/config.yaml"}
        output = io.StringIO()
        with patch.dict(sys.modules, self.modules), patch.object(sys, "stdin", io.StringIO(json.dumps(request))), \
             contextlib.redirect_stdout(output):
            self.spec.loader.exec_module(module)
            module.main()
        return json.loads(output.getvalue())

    def test_native_token_never_leaves_probe_receipt(self):
        response = self.invoke()
        self.assertEqual(response["toolCount"], 2)
        self.assertEqual(self.probed, [("https://example.org/mcp", self.token)])
        self.assertNotIn(self.token, json.dumps(response))
        self.assertNotIn("/mcp", json.dumps(response))

    def test_stale_revision_or_foreign_entry_never_sends_token(self):
        self.revision = 999
        with self.assertRaisesRegex(ValueError, "revision_conflict"):
            self.invoke()
        self.revision = 123
        self.entry["headers"] = {"Authorization": "Bearer FOREIGN"}
        with self.assertRaisesRegex(ValueError, "managed_entry_conflict"):
            self.invoke()
        self.assertEqual(self.probed, [])


if __name__ == "__main__":
    unittest.main()
