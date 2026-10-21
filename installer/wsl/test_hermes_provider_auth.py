import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

SPEC = Path(__file__).with_name("hermes_provider_auth.py")
spec = importlib.util.spec_from_file_location("hermes_provider_auth", SPEC)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def provider(auth_type, env_vars=(), base_url_env="", name=""):
    return types.SimpleNamespace(auth_type=auth_type, api_key_env_vars=tuple(env_vars),
                                 base_url_env_var=base_url_env, name=name)


class ProviderAuthTest(unittest.TestCase):
    def setUp(self):
        definitions = {
            "openai-api": provider("api_key", ("OPENAI_API_KEY",), "OPENAI_BASE_URL", "OpenAI"),
            "anthropic": provider("api_key", ("ANTHROPIC_API_KEY",), "", "Anthropic"),
            "openai-codex": provider("oauth_external", (), "", "ChatGPT or Codex Subscription"),
            "kimi-coding": provider("api_key", (), "KIMI_BASE_URL", "kimi-for-coding"),
        }
        offered = [("openai-api", "OpenAI API"), ("anthropic", "Anthropic"),
                   ("openai-codex", "ChatGPT or Codex Subscription"), ("custom", "Custom endpoint"),
                   ("kimi-coding", "Kimi / Kimi Coding Plan")]
        aliases = {"openai": "openrouter", "openai-api": "openai-api", "anthropic": "anthropic",
                   "openai-codex": "openai-codex", "kimi-coding": "kimi-for-coding", "custom": "custom"}

        package = types.ModuleType("hermes_cli")
        providers = types.ModuleType("hermes_cli.providers")
        static = types.ModuleType("hermes_cli.models_catalog_static")
        auth = types.ModuleType("hermes_cli.auth")

        providers.get_provider = lambda name, allow_network=True: definitions.get(name)
        providers.normalize_provider = lambda name: aliases.get(name, name)
        static.listed_canonical_providers = lambda: [
            types.SimpleNamespace(slug=slug, label=label) for slug, label in offered
        ]
        auth.KNOWN_PROVIDER_KEY_PREFIXES = {"openrouter": ("sk-or-",)}

        self.module_patch = patch.dict(sys.modules, {
            "hermes_cli": package, "hermes_cli.providers": providers,
            "hermes_cli.models_catalog_static": static, "hermes_cli.auth": auth,
        })
        self.module_patch.start()
        self.addCleanup(self.module_patch.stop)

    def test_picker_id_survives_runtime_alias_normalisation(self):
        # "openai" normalises to an aggregator at runtime; the picker entry must stay "openai-api".
        result = probe.capabilities(["openai-api"])
        self.assertEqual(result["providers"], [{
            "requested": "openai-api", "id": "openai-api", "label": "OpenAI API", "authType": "api_key",
            "apiKeyEnvVars": ["OPENAI_API_KEY"], "baseUrlEnvVar": "OPENAI_BASE_URL", "offered": True,
            "runtimeAlias": "openai-api",
        }])

    def test_runtime_alias_is_reported_without_replacing_the_picker_id(self):
        entry = probe.capabilities(["kimi-coding"])["providers"][0]
        self.assertEqual((entry["id"], entry["runtimeAlias"], entry["offered"]),
                         ("kimi-coding", "kimi-for-coding", True))
        self.assertEqual(entry["apiKeyEnvVars"], [])
        self.assertEqual(entry["baseUrlEnvVar"], "KIMI_BASE_URL")

    def test_custom_endpoint_has_no_resolver_entry_but_is_offered(self):
        entry = probe.capabilities(["custom"])["providers"][0]
        self.assertEqual((entry["authType"], entry["offered"]), ("custom_endpoint", True))

    def test_oauth_provider_is_reported_as_such(self):
        entry = probe.capabilities(["openai-codex"])["providers"][0]
        self.assertEqual(entry["authType"], "oauth_external")

    def test_key_prefixes_come_from_the_installed_version(self):
        self.assertEqual(probe.capabilities(["anthropic"])["keyPrefixes"], {"openrouter": ["sk-or-"]})

    def test_unknown_and_known_aliases_are_not_silently_accepted(self):
        with self.assertRaisesRegex(ValueError, "unknown_provider"):
            probe.capabilities(["openai"])
        with self.assertRaisesRegex(ValueError, "unknown_provider"):
            probe.capabilities(["moonshot-legacy"])

    def test_malformed_request_fails_before_any_hermes_import(self):
        for payload in ('{"names": []}', '{"name": ["openai"]}', '{"names": ["openai", 3]}',
                        '{"names": ["../etc/passwd"]}', '[]'):
            result = subprocess.run([sys.executable, str(SPEC)], input=payload, capture_output=True, text=True,
                                    timeout=60)
            self.assertEqual(result.returncode, 5, payload)
            self.assertEqual(json.loads(result.stdout), {"error": "invalid_request"}, payload)


if __name__ == "__main__":
    unittest.main()