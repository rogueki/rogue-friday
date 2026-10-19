import contextlib
import importlib.util
import io
import json
import os
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
        (self.home / ".hermes" / "hermes-agent").mkdir(parents=True)
        (self.home / ".hermes" / "skills" / "sample").mkdir(parents=True)
        (self.home / ".hermes" / "skills" / "sample" / "SKILL.md").write_text("synthetic")
        (self.home / ".hermes" / "plugins" / "example").mkdir(parents=True)
        (self.home / ".hermes" / "plugins" / "example" / "plugin.yaml").write_text("name: example\n")
        (self.home / ".local" / "bin").mkdir(parents=True)
        (self.home / ".local" / "bin" / "hermes").write_text("synthetic")
        self.config = self.home / ".hermes" / "config.yaml"
        self.config.write_text("model:\n  api_key: CANARY-PRIVATE\nagent:\n  max_turns: 500\n")
        self.values = {"model.provider": "openrouter", "model.default": "example/model", "agent.reasoning_effort": "medium",
                       "fallback.min_switch_reset_seconds": 0, "fallback_model": [],
                       "agent.max_turns": 500, "agent.gateway_timeout": 1800, "agent.api_max_retries": 3,
                       "session.terminal_continue": True, "max_live_sessions": 16,
                       "skills.disabled": [], "skills.create_dir": "", "skills.external_dirs": []}
        self.calls = []

    def run_command(self, command, **_kwargs):
        self.calls.append(command)
        if command[0] == "git":
            return subprocess.CompletedProcess(command, 0, "d923a5eb487a17c0a68801bba9ef0f56c81040a8\n", "")
        if command[1:] == ["plugins", "list", "--json", "--user"]:
            return subprocess.CompletedProcess(command, 0, '[{"name":"example","status":"enabled"}]', "")
        args = command[2:]
        if args == ["path"]:
            output = str(self.config)
        elif args[0] == "get":
            output = json.dumps(self.values[args[1]])
        elif args[0] == "set":
            self.values[args[1]] = json.loads(args[2]) if args[1] == "fallback_model" else \
                int(args[2]) if args[1] == "agent.max_turns" else args[2]
            if args[1] == "agent.max_turns":
                self.config.write_text(self.config.read_text().replace("max_turns: 500", f"max_turns: {args[2]}"))
            else:
                self.config.write_text(self.config.read_text() + f"\n# synthetic {args[1]} write\n")
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
        self.assertTrue(result["inventory"]["skillsComplete"])
        self.assertTrue(result["inventory"]["pluginsComplete"])
        self.assertEqual(result["modelProviders"], [{"id": "openrouter", "configFileSet": False,
                                                       "authenticated": None, "available": None}])
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
        self.assertEqual(result["revision"], bridge.revision(self.config))
        self.assertEqual(result["values"]["agent.max_turns"], 600)
        self.assertEqual(len([command for command in self.calls if command[2:3] == ["set"]]), 1)

    def test_disabled_skills_error_is_unknown(self):
        original = self.run_command
        def failing(command, **kwargs):
            if command[2:] == ["get", "skills.disabled", "--json"]:
                return subprocess.CompletedProcess(command, 1, "", "error")
            return original(command, **kwargs)
        with patch.object(self, "run_command", side_effect=failing):
            code, result = self.invoke()
        self.assertEqual(code, 0)
        self.assertIsNone(result["skills"][0]["enabled"])
        self.assertFalse(result["inventory"]["skillsComplete"])
        self.assertIn("skill_activation_unknown", result["inventory"]["reasons"])

    def test_fallback_chain_is_typed_and_secret_free(self):
        chain = [{"provider": "openrouter", "model": "example/model"}]
        code, result = self.invoke({"key": "fallback_model", "value": chain, "revision": bridge.revision(self.config)})
        self.assertEqual(code, 0)
        self.assertEqual(result["values"]["fallback_model"], chain)
        self.assertTrue(result["write"]["persisted"])
        self.assertNotIn("CANARY-PRIVATE", json.dumps(result))
        self.assertEqual(bridge.valid_field_value("fallback_model", [{"provider": "evil;cmd", "model": "id"}],
                                                       bridge.FIELDS["fallback_model"]), False)

    def test_model_provider_write_is_allowlisted(self):
        code, result = self.invoke({"key": "model.provider", "value": "openai-api",
                                    "revision": bridge.revision(self.config)})
        self.assertEqual(code, 0)
        self.assertEqual(result["values"]["model.provider"], "openai-api")
        self.assertTrue(result["write"]["persisted"])
        self.assertFalse(bridge.valid_field_value("model.provider", "openai; rm -rf /",
                                                   bridge.FIELDS["model.provider"]))

    def test_two_real_processes_same_revision_only_one_writes(self):
        tools = self.home / "fake-bin"
        tools.mkdir()
        git = tools / "git"
        git.write_text("#!/bin/sh\nprintf 'd923a5eb487a17c0a68801bba9ef0f56c81040a8\\n'\n")
        git.chmod(0o755)
        cli = self.home / ".local" / "bin" / "hermes"
        cli.write_text("""#!/usr/bin/env python3
import json, pathlib, sys, time
p = pathlib.Path.home() / '.hermes' / 'config.yaml'
a = sys.argv[1:]
if a == ['config', 'path']: print(p)
elif a[:2] == ['config', 'get']:
    d = {'model.provider': 'openrouter', 'model.default': 'example/model',
         'agent.reasoning_effort': 'medium', 'fallback.min_switch_reset_seconds': 0, 'fallback_model': [],
         'agent.max_turns': int(p.read_text().split('max_turns: ')[1].splitlines()[0]),
         'agent.gateway_timeout': 1800, 'agent.api_max_retries': 3,
         'session.terminal_continue': True, 'max_live_sessions': 16,
         'skills.disabled': [], 'skills.create_dir': '', 'skills.external_dirs': []}
    print(json.dumps(d[a[2]]))
elif a[:2] == ['config', 'set']:
    time.sleep(.4)
    p.write_text(p.read_text().replace('max_turns: 500', 'max_turns: ' + a[3]))
    print('saved')
elif a == ['plugins', 'list', '--json', '--user']: print('[]')
else: sys.exit(1)
""")
        cli.chmod(0o755)
        env = dict(os.environ, HOME=str(self.home), PATH=f"{tools}:{os.environ['PATH']}")
        expected = bridge.revision(self.config)
        script = str(Path(__file__).with_name("hermes_config_bridge.py"))
        requests = [json.dumps({"key": "agent.max_turns", "value": value, "revision": expected})
                    for value in (600, 700)]
        processes = [subprocess.Popen([sys.executable, script, "update"], stdin=subprocess.PIPE,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env) for _ in requests]
        outcomes = [p.communicate(request)[0] for p, request in zip(processes, requests)]
        self.assertEqual(sorted(p.returncode for p in processes), [0, 4], outcomes)
        self.assertEqual([json.loads(line)["error"] for line, p in zip(outcomes, processes) if p.returncode == 4],
                         ["revision_conflict"])
        self.assertIn(int(self.config.read_text().split('max_turns: ')[1].splitlines()[0]), (600, 700))


if __name__ == "__main__":
    unittest.main()
