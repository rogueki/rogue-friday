import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
import types
import unittest
import urllib.error
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("hermes_model_credential_apply.py")


class ModelCredentialApplyTest(unittest.TestCase):
    def setUp(self):
        self.store = {}
        self.calls = []
        config = types.ModuleType("hermes_cli.config")
        lifecycle = types.ModuleType("hermes_cli.credential_lifecycle")
        config.load_env = lambda: self.store.copy()
        config.save_env_value = lambda key, value: self.store.__setitem__(key, value)
        config.remove_env_value = lambda key: self.store.pop(key, None) is not None
        config.require_env_writable = lambda key, action: None
        def save(key, value):
            self.calls.append(("save", key, value))
            self.store[key] = value
            return {"ok": True}
        def remove(key):
            self.calls.append(("remove", key))
            self.store.pop(key, None)
            return {"ok": True}
        lifecycle.save_provider_env_credential = save
        lifecycle.remove_provider_env_credential = remove
        self.modules = {"hermes_cli": types.ModuleType("hermes_cli"),
                        "hermes_cli.config": config, "hermes_cli.credential_lifecycle": lifecycle}
        self.verify = []
        self.verify_status = 200
        def fake_open(opener, request, timeout=None):
            self.verify.append((request.full_url, dict(request.header_items())))
            if self.verify_status != 200:
                raise urllib.error.HTTPError(request.full_url, self.verify_status, "denied", {}, None)
            return contextlib.nullcontext(types.SimpleNamespace(status=200))
        opener = patch("urllib.request.OpenerDirector.open", fake_open)
        opener.start()
        self.addCleanup(opener.stop)

    def invoke(self, key, value):
        out = io.StringIO()
        with patch.dict(sys.modules, self.modules), patch.object(sys, "stdin", io.StringIO(json.dumps({
            "key": key, "value": value,
        }))), contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as stopped:
                runpy.run_path(str(SCRIPT), run_name="__main__")
        return stopped.exception.code, json.loads(out.getvalue()) if out.getvalue() else None

    def test_set_and_remove_are_redacted_and_read_back(self):
        secret = "CANARY-PRIVATE-MODEL-KEY"
        code, result = self.invoke("OPENROUTER_API_KEY", secret)
        self.assertEqual((code, result), (0, {"saved": True, "configured": True}))
        self.assertEqual(self.calls[-1], ("save", "OPENROUTER_API_KEY", secret))
        self.assertNotIn(secret, json.dumps(result))
        code, result = self.invoke("OPENROUTER_API_KEY", None)
        self.assertEqual((code, result), (0, {"saved": True, "configured": False}))
        self.assertEqual(self.calls[-1], ("remove", "OPENROUTER_API_KEY"))

    def test_base_url_is_written_without_credential_lifecycle(self):
        url = "https://llm.example.test/v1"
        code, result = self.invoke("OPENAI_BASE_URL", url)
        self.assertEqual((code, result), (0, {"saved": True, "configured": True}))
        self.assertEqual(self.store["OPENAI_BASE_URL"], url)
        self.assertEqual(self.calls, [])
        code, result = self.invoke("OPENAI_BASE_URL", "https://a b")
        self.assertEqual(code, 2)
        self.assertEqual(self.store["OPENAI_BASE_URL"], url)

    def test_base_url_binding_can_be_removed(self):
        url = "https://llm.example.test/v1"
        code, result = self.invoke("OPENAI_BASE_URL", url)
        self.assertEqual((code, result), (0, {"saved": True, "configured": True}))
        self.assertEqual(self.store["OPENAI_BASE_URL"], url)
        code, result = self.invoke("OPENAI_BASE_URL", None)
        self.assertEqual((code, result), (0, {"saved": True, "configured": False}))
        self.assertNotIn("OPENAI_BASE_URL", self.store)
        self.assertFalse(any(call[0] == "remove" for call in self.calls))

    def test_rejects_unknown_or_multiline_secret_without_mutation(self):
        self.assertEqual(self.invoke("EXA_API_KEY", "CANARY")[0], 2)
        self.assertEqual(self.invoke("OPENAI_API_KEY", "bad\nvalue")[0], 2)
        self.assertEqual(self.calls, [])

    def test_rejected_new_key_keeps_the_working_key(self):
        self.store["OPENAI_API_KEY"] = "WORKING-KEY"
        self.verify_status = 401
        code, result = self.invoke("OPENAI_API_KEY", "CANARY-TYPO-KEY")
        self.assertEqual((code, result), (6, {"saved": False, "configured": None, "error": "credential_rejected"}))
        self.assertEqual(self.store["OPENAI_API_KEY"], "WORKING-KEY")
        self.assertEqual(self.calls, [])
        self.assertNotIn("CANARY-TYPO-KEY", json.dumps(result))

    def test_unreachable_provider_keeps_the_working_key(self):
        self.store["ANTHROPIC_API_KEY"] = "WORKING-KEY"
        self.verify_status = 503
        code, result = self.invoke("ANTHROPIC_API_KEY", "CANARY-NEW-KEY")
        self.assertEqual((code, result["error"]), (6, "credential_unverified"))
        self.assertEqual(self.store["ANTHROPIC_API_KEY"], "WORKING-KEY")

    def test_key_is_verified_only_against_its_own_provider_host(self):
        self.invoke("ANTHROPIC_API_KEY", "CANARY-A")
        self.invoke("OPENROUTER_API_KEY", "CANARY-B")
        self.store["OPENAI_BASE_URL"] = "https://llm.example.test/v1/"
        self.invoke("OPENAI_API_KEY", "CANARY-C")
        urls = [url for url, _ in self.verify]
        self.assertEqual(urls, ["https://api.anthropic.com/v1/models", "https://openrouter.ai/api/v1/key",
                                "https://llm.example.test/v1/models"])
        self.store["OPENAI_BASE_URL"] = "http://llm.example.test/v1"
        code, result = self.invoke("OPENAI_API_KEY", "CANARY-D")
        self.assertEqual((code, result["error"]), (6, "credential_unverified"))
        self.assertEqual(len(self.verify), 3)

    def test_removal_needs_no_provider_check(self):
        self.store["OPENAI_API_KEY"] = "OLD"
        self.verify_status = 401
        code, result = self.invoke("OPENAI_API_KEY", None)
        self.assertEqual((code, result), (0, {"saved": True, "configured": False}))
        self.assertEqual(self.verify, [])


if __name__ == "__main__":
    unittest.main()
