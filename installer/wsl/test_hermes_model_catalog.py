import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("hermes_model_catalog", Path(__file__).with_name("hermes_model_catalog.py"))
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        package = types.ModuleType("hermes_cli")
        models = types.ModuleType("hermes_cli.models")
        static = types.ModuleType("hermes_cli.models_catalog_static")

        class CuratedFallbackModels(list):
            pass

        static.CuratedFallbackModels = CuratedFallbackModels
        static._PROVIDER_MODELS = {"anthropic": ["curated-claude"], "openai-api": ["curated-gpt"],
                                   "openrouter": ["curated-openrouter"]}
        static.listed_canonical_providers = lambda: [
            types.SimpleNamespace(slug="openai-api", label="OpenAI API"),
            types.SimpleNamespace(slug="anthropic", label="Anthropic"),
            types.SimpleNamespace(slug="openrouter", label="OpenRouter"),
        ]
        models._openai_catalog = lambda provider, force: self.calls.append((provider, force)) or ["gpt-test"]
        models._anthropic_catalog = lambda provider, force: self.calls.append((provider, force)) or CuratedFallbackModels(["curated-claude"])
        self.module_patch = patch.dict(sys.modules, {"hermes_cli": package, "hermes_cli.models": models,
                                                     "hermes_cli.models_catalog_static": static})
        self.module_patch.start()
        self.addCleanup(self.module_patch.stop)

    def test_provider_list_never_issues_network_probe(self):
        result = catalog.catalog()
        self.assertEqual(self.calls, [])
        self.assertIsNone(result["selected"])
        self.assertEqual([provider["id"] for provider in result["providers"]],
                         ["openai-api", "anthropic", "openrouter", "custom"])

    def test_explicit_openai_probe_is_endpoint_confirmed_but_not_model_access(self):
        selected = catalog.catalog("openai-api")["selected"]
        self.assertEqual(self.calls, [("openai-api", True)])
        self.assertEqual(selected, {"id": "openai-api", "models": ["gpt-test"],
                                    "origin": "endpoint_confirmed_picker", "probeStatus": "succeeded",
                                    "modelAccess": None})

    def test_curated_fallback_does_not_claim_anthropic_probe_success(self):
        selected = catalog.catalog("anthropic")["selected"]
        self.assertEqual(selected["probeStatus"], "failed")
        self.assertEqual(selected["origin"], "curated")
        self.assertIsNone(selected["modelAccess"])

    def test_unsupported_probe_is_curated_and_unknown_id_is_rejected(self):
        selected = catalog.catalog("openrouter")["selected"]
        self.assertEqual(selected["probeStatus"], "unsupported")
        self.assertEqual(selected["models"], ["curated-openrouter"])
        self.assertEqual(self.calls, [])
        with self.assertRaisesRegex(ValueError, "unknown_provider"):
            catalog.catalog("forged-provider")


if __name__ == "__main__":
    unittest.main()
