import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from research_hermes_synthesis import child


class ResearchHermesSynthesisTest(unittest.TestCase):
    def test_uses_existing_route_with_no_tools_context_or_retries(self):
        captured = {}

        class FakeCli:
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

            def run_conversation(self, **kwargs):
                captured["retries"] = self._api_max_retries
                captured["recovery"] = self._auto_recovery_cycles
                captured["turn"] = kwargs
                return {"final_response": '{"observations":[]}', "failed": False}

        modules = {
            "cli": types.ModuleType("cli"),
            "run_agent": types.ModuleType("run_agent"),
            "toolsets": types.ModuleType("toolsets"),
        }
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


if __name__ == "__main__":
    unittest.main()
