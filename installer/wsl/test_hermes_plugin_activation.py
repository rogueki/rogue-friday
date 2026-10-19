import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("hermes_plugin_activation", Path(__file__).with_name("hermes_plugin_activation.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PluginActivationTest(unittest.TestCase):
    def test_native_admission_is_called_with_exact_installed_id_and_result_is_projected(self):
        calls = []
        package = types.ModuleType("hermes_cli")
        native = types.ModuleType("hermes_cli.plugins_cmd")
        native.dashboard_set_agent_plugin_enabled = lambda name, *, enabled: (
            calls.append((name, enabled)) or {"ok": True, "name": name, "restart_required": True,
                                          "secret": "CANARY-PRIVATE"})
        output = io.StringIO()
        with patch.dict(sys.modules, {"hermes_cli": package, "hermes_cli.plugins_cmd": native}), \
             patch.object(sys, "stdin", io.StringIO('{"pluginId":"web/example","enabled":true}')), \
             contextlib.redirect_stdout(output):
            module.main()
        self.assertEqual(calls, [("web/example", True)])
        self.assertEqual(json.loads(output.getvalue()), {"ok": True, "name": "web/example", "restartRequired": True})
        self.assertNotIn("CANARY-PRIVATE", output.getvalue())

    def test_rejects_path_traversal_before_native_call(self):
        with patch.object(sys, "stdin", io.StringIO('{"pluginId":"../bad","enabled":true}')):
            with self.assertRaisesRegex(ValueError, "invalid_request"):
                module.main()


if __name__ == "__main__":
    unittest.main()
