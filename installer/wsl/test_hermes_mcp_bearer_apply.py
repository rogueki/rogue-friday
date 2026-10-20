import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("hermes_mcp_bearer_apply", Path(__file__).with_name("hermes_mcp_bearer_apply.py"))


class McpBearerApplyTest(unittest.TestCase):
    def setUp(self):
        self.entries = {"example": {"url": "https://example.org/mcp", "enabled": True}}
        self.env = {}
        config = types.ModuleType("hermes_cli.config")
        config.get_env_value = lambda key: self.env.get(key)
        config.remove_env_value = lambda key: self.env.pop(key, None)
        mcp = types.ModuleType("hermes_cli.mcp_config")
        mcp._env_key_for_server = lambda name: "MCP_" + name.upper() + "_API_KEY"
        mcp._bearer_auth_headers = lambda name: {"Authorization": "Bearer ${" + mcp._env_key_for_server(name) + "}"}
        mcp._get_mcp_servers = lambda: dict(self.entries)
        mcp._save_mcp_server = lambda name, entry: self.entries.__setitem__(name, entry) or True
        def save(name, token):
            self.env[mcp._env_key_for_server(name)] = token
            return mcp._bearer_auth_headers(name)
        mcp._save_bearer_auth_token = save
        mcp._strip_bearer_prefix = lambda token: token
        self.mcp = mcp
        security = types.ModuleType("hermes_cli.mcp_security")
        security.validate_mcp_server_entry = lambda name, entry: []
        bridge = types.ModuleType("hermes_config_bridge")
        bridge.revision = lambda path: 123
        self.bridge = bridge
        self.modules = {"hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli.config": config,
                        "hermes_cli.mcp_config": mcp, "hermes_cli.mcp_security": security,
                        "hermes_config_bridge": bridge}

    def invoke(self, request):
        request = {"expectedUrl": "https://example.org/mcp", "expectedRevision": 123,
                   "configPath": "/synthetic/config.yaml", **request}
        module = importlib.util.module_from_spec(spec)
        output = io.StringIO()
        with patch.dict(sys.modules, self.modules), patch.object(sys, "stdin", io.StringIO(json.dumps(request))), \
             contextlib.redirect_stdout(output):
            spec.loader.exec_module(module)
            module.main()
        return json.loads(output.getvalue())

    def test_native_bearer_save_rotation_and_remove_without_leak(self):
        self.assertEqual(self.invoke({"name": "example", "token": "CANARY-ONE"}), {"saved": True})
        self.assertEqual(self.entries["example"]["headers"],
                         {"Authorization": "Bearer ${MCP_EXAMPLE_API_KEY}"})
        self.assertEqual(self.env["MCP_EXAMPLE_API_KEY"], "CANARY-ONE")
        self.assertEqual(self.invoke({"name": "example", "token": "CANARY-TWO"}), {"saved": True})
        self.assertEqual(self.invoke({"name": "example", "token": None}), {"saved": True})
        self.assertNotIn("MCP_EXAMPLE_API_KEY", self.env)
        self.assertNotIn("headers", self.entries["example"])

    def test_rejects_foreign_credential_and_key_collision(self):
        self.env["MCP_EXAMPLE_API_KEY"] = "FOREIGN"
        with self.assertRaisesRegex(ValueError, "credential_name_conflict"):
            self.invoke({"name": "example", "token": "CANARY"})
        self.env.clear()
        self.entries["EXAMPLE"] = {"url": "https://other.example.org/mcp"}
        with self.assertRaisesRegex(ValueError, "credential_name_conflict"):
            self.invoke({"name": "example", "token": "CANARY"})
        self.entries.pop("EXAMPLE")
        self.entries["example"]["headers"] = {"Authorization": "Bearer CANARY-FOREIGN"}
        with self.assertRaisesRegex(ValueError, "managed_entry_conflict"):
            self.invoke({"name": "example", "token": None})

    def test_partial_writes_leave_no_new_secret_at_a_changed_endpoint(self):
        self.mcp._save_mcp_server = lambda name, entry: False
        with self.assertRaisesRegex(ValueError, "config_rejected"):
            self.invoke({"name": "example", "token": "CANARY-NEW"})
        self.assertNotIn("MCP_EXAMPLE_API_KEY", self.env)
        self.assertNotIn("headers", self.entries["example"])

        self.mcp._save_mcp_server = lambda name, entry: self.entries.__setitem__(name, entry) or True
        self.invoke({"name": "example", "token": "CANARY-OLD"})
        self.mcp._save_mcp_server = lambda name, entry: False
        with self.assertRaisesRegex(ValueError, "config_rejected"):
            self.invoke({"name": "example", "token": None})
        self.assertNotIn("MCP_EXAMPLE_API_KEY", self.env)
        self.assertIn("headers", self.entries["example"])

    def test_rejects_stale_revision_and_revokes_own_token_after_foreign_config_change(self):
        self.bridge.revision = lambda path: 999
        with self.assertRaisesRegex(ValueError, "revision_conflict"):
            self.invoke({"name": "example", "token": "CANARY-NEW"})
        self.assertNotIn("MCP_EXAMPLE_API_KEY", self.env)
        self.bridge.revision = lambda path: 123
        def concurrent_save(name, token):
            self.env["MCP_EXAMPLE_API_KEY"] = token
            self.entries[name] = {"url": "https://different.example.org/mcp", "enabled": True,
                                  "headers": {"Authorization": "Bearer ${MCP_EXAMPLE_API_KEY}"}}
            return {"Authorization": "Bearer ${MCP_EXAMPLE_API_KEY}"}
        self.mcp._save_bearer_auth_token = concurrent_save
        with self.assertRaisesRegex(ValueError, "concurrent_config_change"):
            self.invoke({"name": "example", "token": "CANARY-NEW"})
        self.assertNotIn("MCP_EXAMPLE_API_KEY", self.env)
        self.assertEqual(self.entries["example"]["url"], "https://different.example.org/mcp")


if __name__ == "__main__":
    unittest.main()
