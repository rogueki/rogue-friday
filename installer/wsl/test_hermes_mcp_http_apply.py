import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("hermes_mcp_http_apply", Path(__file__).with_name("hermes_mcp_http_apply.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class McpHttpApplyTest(unittest.TestCase):
    def setUp(self):
        self.entries = {}
        config = types.ModuleType("hermes_cli.mcp_config")
        config._get_mcp_servers = lambda: dict(self.entries)
        config._save_mcp_server = lambda name, entry: self.entries.__setitem__(name, entry) or True
        config._remove_mcp_server = lambda name: self.entries.pop(name, None) is not None
        security = types.ModuleType("hermes_cli.mcp_security")
        security.validate_mcp_server_entry = lambda name, entry: []
        self.modules = {"hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli.mcp_config": config,
                        "hermes_cli.mcp_security": security}

    def invoke(self, request):
        output = io.StringIO()
        with patch.dict(sys.modules, self.modules), patch.object(sys, "stdin", io.StringIO(json.dumps(request))), \
             contextlib.redirect_stdout(output):
            module.main()
        return json.loads(output.getvalue())

    def test_native_save_readback_disable_and_remove(self):
        request = {"name": "example", "url": "https://example.org/mcp", "enabled": True}
        self.assertEqual(self.invoke(request), {"saved": True})
        self.assertEqual(self.entries["example"], {"url": request["url"], "enabled": True})
        self.assertEqual(self.invoke({**request, "enabled": False}), {"saved": True})
        self.assertFalse(self.entries["example"]["enabled"])
        self.assertEqual(self.invoke({"name": "example", "url": None, "enabled": False}), {"saved": True})
        self.assertNotIn("example", self.entries)

    def test_rejects_credentials_shell_and_unmanaged_overwrite(self):
        for url in ("http://example.org/mcp", "https://user:secret@example.org/mcp",
                    "https://example.org/mcp?token=secret", "https://127.0.0.1/mcp"):
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "invalid_request"):
                self.invoke({"name": "example", "url": url, "enabled": True})
        self.entries["example"] = {"command": "python", "args": ["sensitive.py"]}
        with self.assertRaisesRegex(ValueError, "managed_entry_conflict"):
            self.invoke({"name": "example", "url": "https://example.org/mcp", "enabled": True})


if __name__ == "__main__":
    unittest.main()
