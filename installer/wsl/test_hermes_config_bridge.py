import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import Mock, patch


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
                       "agent.auto_recovery_cycles": 5, "agent.agent_cache.max_size": 128,
                       "agent.run_budget_seconds": None, "agent.budget_warning_ratio": None,
                       "max_concurrent_sessions": None, "context_file_max_chars": None,
                       "compression.enabled": True, "compression.threshold": 0.5,
                       "compression.target_ratio": 0.2, "compression.tail_mode": "lean",
                       "compression.protect_last_n": 20,
                       "agent.max_turns": 500, "agent.gateway_timeout": 1800, "agent.api_max_retries": 3,
                       "session.terminal_continue": True, "max_live_sessions": 16,
                       "skills.disabled": [], "skills.create_dir": "", "skills.external_dirs": []}
        self.calls = []

    def run_command(self, command, **_kwargs):
        self.calls.append(command)
        if command[0] == "credential-worker":
            request = json.loads(_kwargs["input"])
            env_path = self.home / ".hermes" / ".env"
            env_path.write_text(f"{request['key']}={request['value']}\n" if request["value"] is not None else "")
            return subprocess.CompletedProcess(command, 0, '{"saved":true}', "")
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
            try:
                self.values[args[1]] = json.loads(args[2])
            except ValueError:
                self.values[args[1]] = args[2]
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
        bootstrap = types.ModuleType("hermes_bootstrap")
        hermes_cli = types.ModuleType("hermes_cli")
        config = types.ModuleType("hermes_cli.config")
        lifecycle = types.ModuleType("hermes_cli.credential_lifecycle")
        launchers = types.ModuleType("hermes_cli._launchers")
        launchers.runtime_command = lambda *args, **kwargs: ["credential-worker"]
        env_path = self.home / ".hermes" / ".env"
        def load_env():
            return dict(line.split("=", 1) for line in env_path.read_text().splitlines()) if env_path.exists() else {}
        def save(key, value):
            env_path.write_text(f"{key}={value}\n")
            return {"ok": True}
        def remove(key):
            env_path.write_text("")
            return {"ok": True}
        config.load_env = load_env
        lifecycle.save_provider_env_credential = save
        lifecycle.remove_provider_env_credential = remove
        with patch.object(bridge.Path, "home", return_value=self.home), patch.object(bridge.subprocess, "run", side_effect=self.run_command), \
             patch.object(bridge, "run_runtime_child", side_effect=lambda command, request, timeout: self.run_command(command, input=request)), \
             patch.dict(sys.modules, {"hermes_bootstrap": bootstrap, "hermes_cli": hermes_cli,
                                      "hermes_cli.config": config, "hermes_cli.credential_lifecycle": lifecycle,
                                      "hermes_cli._launchers": launchers}), \
             patch.object(sys, "path", sys.path.copy()), \
             patch.object(sys, "argv", ["bridge", "credential-update" if request and request["key"] in bridge.MODEL_CREDENTIALS else "update" if request else "status"]), \
             patch.object(sys, "stdin", io.StringIO(json.dumps(request) if request else "")), contextlib.redirect_stdout(out):
            code = bridge.main()
        return code, json.loads(out.getvalue())

    def test_model_credential_uses_stdin_lifecycle_and_redacted_readback(self):
        secret = "CANARY-MODEL-PRIVATE"
        code, result = self.invoke({"key": "OPENROUTER_API_KEY", "value": secret,
                                    "revision": bridge.revision(self.config)})
        self.assertEqual(code, 0)
        self.assertEqual(result["write"], {"key": "OPENROUTER_API_KEY", "persisted": True})
        self.assertTrue(result["secrets"]["OPENROUTER_API_KEY"])
        self.assertNotIn(secret, json.dumps(result))
        self.assertFalse(any(secret in " ".join(map(str, command)) for command in self.calls))
        old_revision = result["revision"]
        code, result = self.invoke({"key": "OPENROUTER_API_KEY", "value": None,
                                    "revision": old_revision})
        self.assertEqual(code, 0)
        self.assertFalse(result["secrets"]["OPENROUTER_API_KEY"])

    def test_model_credential_revision_conflict_and_bad_value_do_not_write(self):
        code, result = self.invoke({"key": "OPENROUTER_API_KEY", "value": "CANARY-PRIVATE", "revision": 1})
        self.assertEqual(code, 4)
        self.assertEqual(result["error"], "revision_conflict")
        with self.assertRaisesRegex(ValueError, "unsupported_field"):
            self.invoke({"key": "OPENROUTER_API_KEY", "value": "line\nbreak",
                         "revision": bridge.revision(self.config)})
        self.assertFalse((self.home / ".hermes" / ".env").exists())

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "killpg"), "POSIX process groups required")
    def test_runtime_timeout_kills_descendants_before_lock_release(self):
        marker = self.home / "late-write"
        ready = self.home / "descendant-started"
        grandchild = "import pathlib,sys,time; pathlib.Path(sys.argv[2]).write_text('ready'); time.sleep(2); pathlib.Path(sys.argv[1]).write_text('late')"
        parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2],sys.argv[3]]); time.sleep(4)"
        with self.assertRaises(subprocess.TimeoutExpired):
            bridge.run_runtime_child([sys.executable, "-c", parent, grandchild, str(marker), str(ready)], "", 1)
        self.assertTrue(ready.exists(), "descendant did not start before timeout")
        time.sleep(2.1)
        self.assertFalse(marker.exists())

    def test_status_is_effective_and_redacted(self):
        code, result = self.invoke()
        self.assertEqual(code, 0)
        self.assertEqual(result["values"]["agent.max_turns"], 500)
        self.assertEqual(result["skills"], [{"id": "sample", "installed": True, "enabled": True}])
        self.assertTrue(result["plugins"][0]["enabled"])
        self.assertTrue(result["inventory"]["skillsComplete"])
        self.assertTrue(result["inventory"]["pluginsComplete"])
        self.assertFalse(result["inventory"]["modelProvidersComplete"])
        self.assertIn("provider_catalog_not_enumerated", result["inventory"]["reasons"])
        self.assertEqual(result["modelProviders"], [{"id": "openrouter", "configFileSet": False,
                                                       "authenticated": None, "available": None}])
        self.assertNotIn("CANARY-PRIVATE", json.dumps(result))

    def test_model_catalog_only_passes_allowlisted_provider_and_projects_child_response(self):
        out = io.StringIO()
        probe = Mock(return_value=subprocess.CompletedProcess(
            ["catalog-worker"], 0, json.dumps({
                "providers": [{"id": "openai-api", "label": "OpenAI API"}],
                "selected": {"id": "openai-api", "models": ["gpt-test"],
                             "origin": "endpoint_confirmed_picker", "probeStatus": "succeeded", "modelAccess": None},
                "secret": "CANARY-DO-NOT-RETURN",
            }), ""))
        launchers = types.ModuleType("hermes_cli._launchers")
        launchers.runtime_command = lambda *args, **kwargs: ["catalog-worker"]
        with patch.object(bridge.Path, "home", return_value=self.home), \
             patch.object(bridge.subprocess, "run", side_effect=self.run_command), \
             patch.object(bridge, "run_runtime_child", probe), \
             patch.dict(sys.modules, {"hermes_cli": types.ModuleType("hermes_cli"),
                                      "hermes_cli._launchers": launchers}), \
             patch.object(sys, "argv", ["bridge", "model-catalog"]), \
             patch.object(sys, "stdin", io.StringIO('{"providerId":"openai-api"}')), \
             contextlib.redirect_stdout(out):
            self.assertEqual(bridge.main(), 0)
        result = json.loads(out.getvalue())
        self.assertEqual(result["selected"]["models"], ["gpt-test"])
        self.assertNotIn("CANARY-DO-NOT-RETURN", out.getvalue())
        self.assertEqual(json.loads(probe.call_args.args[1]), {"providerId": "openai-api"})

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

    def test_unset_optional_hermes_key_is_null_not_unavailable(self):
        original = self.run_command
        def unset(command, **kwargs):
            if command[2:] == ["get", "fallback_model", "--json"]:
                return subprocess.CompletedProcess(command, 1, "", "Config key not set: fallback_model\n")
            return original(command, **kwargs)
        with patch.object(self, "run_command", side_effect=unset):
            code, result = self.invoke()
        self.assertEqual(code, 0)
        self.assertIsNone(result["values"]["fallback_model"])

    def test_unset_disabled_skills_uses_hermes_empty_default(self):
        original = self.run_command
        def unset(command, **kwargs):
            if command[2:] == ["get", "skills.disabled", "--json"]:
                return subprocess.CompletedProcess(command, 1, "", "Config key not set: skills.disabled\n")
            return original(command, **kwargs)
        with patch.object(self, "run_command", side_effect=unset):
            code, result = self.invoke()
        self.assertEqual(code, 0)
        self.assertTrue(result["skills"][0]["enabled"])
        self.assertTrue(result["inventory"]["skillsComplete"])

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

    def test_compression_ratio_write_is_bounded(self):
        code, result = self.invoke({"key": "compression.threshold", "value": 0.7,
                                    "revision": bridge.revision(self.config)})
        self.assertEqual(code, 0)
        self.assertEqual(result["values"]["compression.threshold"], 0.7)
        self.assertTrue(result["write"]["persisted"])
        self.assertFalse(bridge.valid_field_value("compression.threshold", 1.1,
                                                   bridge.FIELDS["compression.threshold"]))

    def test_optional_budget_can_be_cleared(self):
        self.values["agent.run_budget_seconds"] = 3600
        code, result = self.invoke({"key": "agent.run_budget_seconds", "value": None,
                                    "revision": bridge.revision(self.config)})
        self.assertEqual(code, 0)
        self.assertIsNone(result["values"]["agent.run_budget_seconds"])
        self.assertTrue(result["write"]["persisted"])

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
         'agent.auto_recovery_cycles': 5, 'agent.agent_cache.max_size': 128,
         'agent.run_budget_seconds': None, 'agent.budget_warning_ratio': None,
         'max_concurrent_sessions': None, 'context_file_max_chars': None,
         'compression.enabled': True, 'compression.threshold': 0.5,
         'compression.target_ratio': 0.2, 'compression.tail_mode': 'lean',
         'compression.protect_last_n': 20,
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
        source = self.home / ".hermes" / "hermes-agent"
        (source / "hermes_bootstrap.py").write_text("")
        (source / "hermes_cli").mkdir()
        (source / "hermes_cli" / "__init__.py").write_text("")
        (source / "hermes_cli" / "config.py").write_text("def load_env(): return {}\n")
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
