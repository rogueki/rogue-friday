import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from research_hermes_synthesis import child, run_bounded_child


class ResearchHermesSynthesisTest(unittest.TestCase):
    @unittest.skipUnless(os.name == "posix", "Hermes helper runs under WSL/Linux")
    def test_bounded_child_rejects_oversized_output(self):
        with self.assertRaisesRegex(ValueError, "model_output_too_large"):
            run_bounded_child([sys.executable, "-c", "import sys; sys.stdout.write('x'*20000)"], b"{}")

    @unittest.skipUnless(os.name == "posix", "Hermes helper runs under WSL/Linux")
    def test_bounded_child_handles_early_exit(self):
        with self.assertRaisesRegex(ValueError, "model_unavailable"):
            run_bounded_child([sys.executable, "-c", "import sys; sys.exit(2)"], b"x" * 10000)

    @unittest.skipUnless(os.name == "posix", "Hermes helper runs under WSL/Linux")
    def test_bounded_child_enforces_deadline(self):
        with self.assertRaisesRegex(ValueError, "model_timeout"):
            run_bounded_child([sys.executable, "-c", "import time; time.sleep(10)"], b"{}",
                              timeout_seconds=0.1)

    def test_uses_existing_route_with_no_tools_context_or_retries(self):
        captured = {}

        class FakeCli:
            def _init_session_store(self):
                raise AssertionError("session store must not be opened")

            def __init__(self, **kwargs):
                captured["cli"] = kwargs
                self.model = "fixture-model"
                self.reasoning_config = {"effort": "none"}

            def _ensure_runtime_credentials(self):
                return True

            def _resolve_turn_agent_config(self, _prompt):
                return {"model": "fixture-model", "runtime": {
                    "provider": "fixture", "requested_provider": "fixture", "api_key": "test-key",
                    "base_url": "https://fixture.invalid", "api_mode": "chat_completions",
                }}

        class FakeAgent:
            def __init__(self, **kwargs):
                captured["agent"] = kwargs
                self.tools = []

            def run_conversation(self, **kwargs):
                captured["retries"] = self._api_max_retries
                captured["recovery"] = self._auto_recovery_cycles
                captured["turn"] = kwargs
                return {"final_response": '{"observations":[]}', "failed": False}

        modules = {
            "cli": types.ModuleType("cli"),
            "run_agent": types.ModuleType("run_agent"),
            "toolsets": types.ModuleType("toolsets"),
            "hermes_cli": types.ModuleType("hermes_cli"),
            "hermes_cli.left_core_migration": types.ModuleType("hermes_cli.left_core_migration"),
            "hermes_cli.plugins": types.ModuleType("hermes_cli.plugins"),
        }
        modules["hermes_cli"].__path__ = []
        modules["hermes_cli.left_core_migration"].recover_at_startup = lambda **_kwargs: None
        modules["hermes_cli.plugins"].discover_plugins = lambda: None
        modules["cli"].HermesCLI = FakeCli
        modules["run_agent"].AIAgent = FakeAgent
        modules["toolsets"].TOOLSETS = {"bot_room": {"tools": [], "includes": []}}
        with patch.dict(sys.modules, modules):
            output = child({"prompt": "untrusted page fixture"})

        self.assertEqual(output["output"], '{"observations":[]}')
        self.assertEqual(captured["cli"]["toolsets"], ["bot_room"])
        self.assertEqual(captured["cli"]["max_turns"], 1)
        self.assertTrue(captured["cli"]["ignore_rules"])
        self.assertEqual(captured["agent"]["enabled_toolsets"], ["bot_room"])
        self.assertEqual(captured["agent"]["max_tokens"], 700)
        self.assertEqual(captured["agent"]["max_iterations"], 1)
        self.assertTrue(captured["agent"]["skip_context_files"])
        self.assertTrue(captured["agent"]["skip_memory"])
        self.assertTrue(captured["agent"]["skip_background_review"])
        self.assertIsNone(captured["agent"]["fallback_model"])
        self.assertEqual(captured["retries"], 1)
        self.assertEqual(captured["recovery"], 0)
        self.assertEqual(captured["turn"]["conversation_history"], [])

    def test_rejects_changed_toolset(self):
        modules = {"cli": types.ModuleType("cli"), "run_agent": types.ModuleType("run_agent"),
                   "toolsets": types.ModuleType("toolsets")}
        modules["cli"].HermesCLI = object
        modules["run_agent"].AIAgent = object
        modules["toolsets"].TOOLSETS = {"bot_room": {"tools": ["terminal"], "includes": []}}
        with patch.dict(sys.modules, modules):
            with self.assertRaisesRegex(ValueError, "tool_free_toolset_changed"):
                child({"prompt": "fixture"})

    def test_rejects_effective_tool_injection(self):
        class FakeCli:
            model = "fixture"
            reasoning_config = None

            def _init_session_store(self):
                raise AssertionError("session store must not be opened")

            def __init__(self, **_kwargs):
                pass

            def _ensure_runtime_credentials(self):
                return True

            def _resolve_turn_agent_config(self, _prompt):
                return {"model": "fixture", "runtime": {"api_key": "fixture", "base_url": "http://127.0.0.1:9"}}

        class FakeAgent:
            def __init__(self, **_kwargs):
                self.tools = [{"function": {"name": "terminal"}}]

        modules = {name: types.ModuleType(name) for name in (
            "cli", "run_agent", "toolsets", "hermes_cli", "hermes_cli.left_core_migration", "hermes_cli.plugins")}
        modules["hermes_cli"].__path__ = []
        modules["cli"].HermesCLI = FakeCli
        modules["run_agent"].AIAgent = FakeAgent
        modules["toolsets"].TOOLSETS = {"bot_room": {"tools": [], "includes": []}}
        modules["hermes_cli.left_core_migration"].recover_at_startup = lambda **_kwargs: None
        modules["hermes_cli.plugins"].discover_plugins = lambda: None
        with patch.dict(sys.modules, modules):
            with self.assertRaisesRegex(ValueError, "tool_surface_not_empty"):
                child({"prompt": "fixture"})


if __name__ == "__main__":
    unittest.main()
