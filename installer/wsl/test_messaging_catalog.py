import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("messaging_catalog", Path(__file__).with_name("messaging_catalog.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CatalogTest(unittest.TestCase):
    def test_pinned_source_inventory_does_not_return_secret_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "hermes-agent"
            plugin = root / "plugins" / "platforms" / "slack"
            plugin.mkdir(parents=True)
            (plugin / "plugin.yaml").write_text("""name: slack-platform
kind: platform
requires_env:
  - name: SLACK_BOT_TOKEN
    password: true
  - name: SLACK_APP_TOKEN
    password: true
optional_env:
  - name: SLACK_ALLOWED_USERS
    password: false
""")

            modules = {"hermes_cli": types.ModuleType("hermes_cli"),
                       "hermes_cli._launchers": types.ModuleType("hermes_cli._launchers")}
            modules["hermes_cli._launchers"].runtime_command = lambda *_args, **_kwargs: ["hermes-runtime"]

            def runner(argv, **kwargs):
                if argv[0] == "git":
                    return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
                if argv[0] == "systemctl":
                    return subprocess.CompletedProcess(argv, 0, "active\n", "")
                fields = json.loads(kwargs["input"])["fields"]
                return subprocess.CompletedProcess(argv, 0, json.dumps({"state": "available", "configured": ["slack"],
                    "present": {field: field in {"SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"} for field in fields}}), "")

            with patch.object(bridge, "ROOT", root), patch.object(bridge, "HOME", root.parent), \
                    patch.object(bridge, "platform_state", return_value="unknown"), \
                    patch.dict(sys.modules, modules):
                result = bridge.catalog(runner)
            self.assertEqual(result["state"], "available")
            self.assertEqual(len(result["items"]), 7)  # one plugin fixture and six built-in transports
            slack = next(item for item in result["items"] if item["platform"] == "slack")
            self.assertTrue(slack["configured"])
            self.assertTrue(slack["gatewayRunning"])
            self.assertEqual(slack["connectionState"], "unknown")
            self.assertTrue(slack["fields"][0]["present"])
            self.assertNotIn("synthetic-secret-never-print", json.dumps(result))

    def test_wrong_source_pin_fails_closed(self):
        def runner(argv, **_kwargs):
            return subprocess.CompletedProcess(argv, 0, "wrong-pin\n", "")
        self.assertEqual(bridge.catalog(runner)["reason"], "hermes_version_changed")


if __name__ == "__main__":
    unittest.main()
