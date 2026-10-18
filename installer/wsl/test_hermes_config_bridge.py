import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("hermes_config_bridge", Path(__file__).with_name("hermes_config_bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        (self.home / ".hermes" / "hermes-agent" / "skills" / "sample").mkdir(parents=True)
        (self.home / ".hermes" / "hermes-agent" / "skills" / "sample" / "SKILL.md").write_text("synthetic")
        (self.home / ".hermes" / "plugins" / "example").mkdir(parents=True)
        (self.home / ".hermes" / "plugins" / "example" / "plugin.yaml").write_text("name: example\n")
        (self.home / ".local" / "bin").mkdir(parents=True)
        (self.home / ".local" / "bin" / "hermes").write_text("synthetic")
        self.config = self.home / ".hermes" / "config.yaml"
        self.config.write_text("model:\n  api_key: CANARY-PRIVATE\nagent:\n  max_turns: 500\n")
        self.values = {"agent.max_turns": 500, "agent.gateway_timeout": 1800, "agent.api_max_retries": 3,
                       "session.terminal_continue": True, "max_live_sessions": 16,
                       "skills.disabled": [], "plugins.enabled": ["example"], "plugins.disabled": []}
        self.calls = []

    def run_command(self, command, **_kwargs):
        self.calls.append(command)
        if command[0] == "git":
            return subprocess.CompletedProcess(command, 0, "d923a5eb487a17c0a68801bba9ef0f56c81040a8\n", "")
        args = command[2:]
        if args == ["path"]:
            output = str(self.config)
        elif args[0] == "get":
            output = json.dumps(self.values[args[1]])
        elif args[0] == "set":
            self.values[args[1]] = int(args[2])
            self.config.write_text(self.config.read_text() + f"\n# synthetic revision {args[2]}\n")
            output = "saved"
        else:
            raise AssertionError(args)
        return subprocess.CompletedProcess(command, 0, output, "")

    def invoke(self, request=None):
        out = io.StringIO()
        with patch.object(bridge.Path, "home", return_value=self.home), patch.object(bridge.subprocess, "run", side_effect=self.run_command), \
             patch.object(sys, "argv", ["bridge", "update" if request else "status"]), \
             patch.object(sys, "stdin", io.StringIO(json.dumps(request) if request else "")), contextlib.redirect_stdout(out):
            code = bridge.main()
        return code, json.loads(out.getvalue())

    def test_status_is_effective_and_redacted(self):
        code, result = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(result["values"]["agent.max_turns"], 500)
        self.assertEqual(result["skills"], [{"id": "sample", "installed": True, "enabled": True}])
        self.assertTrue(result["plugins"][0]["enabled"])
        self.assertNotIn("CANARY-PRIVATE", json.dumps(result))

    def test_revision_conflict_never_calls_set(self):
        code, result = self.invoke({"key": "agent.max_turns", "value": 600, "revision": 1})
        self.assertEqual(code, 4)
        self.assertEqual(result["error"], "revision_conflict")
        self.assertFalse(any(command[2:3] == ["set"] for command in self.calls))

    def test_one_typed_write_has_readback_without_apply_claim(self):
        revision = bridge.revision(self.config)
        code, result = self.invoke({"key": "agent.max_turns", "value": 600, "revision": revision})
        self.assertEqual(code, 0)
        self.assertEqual(result["write"], {"key": "agent.max_turns", "persisted": True})
        self.assertEqual(len([command for command in self.calls if command[2:3] == ["set"]]), 1)


if __name__ == "__main__":
    unittest.main()
