import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("configure_messaging_provider", Path(__file__).with_name("configure_messaging_provider.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
apply_spec = importlib.util.spec_from_file_location("messaging_provider_apply_probe", Path(__file__).with_name("messaging_provider_apply_probe.py"))
apply_bridge = importlib.util.module_from_spec(apply_spec)
apply_spec.loader.exec_module(apply_bridge)


class ProviderConfigTest(unittest.TestCase):
    def test_snapshot_is_fixed_and_excludes_broad_admission(self):
        fields = bridge.specs()
        self.assertEqual(len(fields), 21)
        self.assertIn("MATRIX_ACCESS_TOKEN", fields["matrix"])
        self.assertFalse(any(name.endswith("_ALLOW_ALL_USERS") for provider in fields.values() for name in provider))
        self.assertFalse(any(name in {"BUZZ_CLI_PATH", "BUZZ_CREDENTIALS_FILE"} for provider in fields.values() for name in provider))

    def test_validation_rejects_unknown_fields_and_unsafe_values(self):
        fields = bridge.specs()
        with self.assertRaises(ValueError):
            bridge.validate_values("matrix", {"HERMES_UNSCOPED": "x"}, fields)
        with self.assertRaises(ValueError):
            bridge.validate_values("bluebubbles", {"BLUEBUBBLES_SERVER_URL": "https://user:pass@example.org"}, fields)
        with self.assertRaises(ValueError):
            bridge.validate_values("bluebubbles", {"BLUEBUBBLES_PASSWORD": "line\nsecret"}, fields)

    def test_stale_revision_never_invokes_credential_runtime(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge, "HOME", Path(directory)), \
                patch.object(bridge, "LOCK", Path(directory) / ".friday-config.lock"), \
                patch.object(bridge, "KEY", Path(directory) / "revision.key"), \
                patch.object(bridge, "source_ok", return_value=True):
            current = bridge.operation("matrix", "status")
            invoked = []
            def forbidden_runtime(*args, **kwargs):
                invoked.append((args, kwargs))
                raise AssertionError("credential runtime was invoked")
            with patch.object(bridge, "revision", return_value=current["revision"]), \
                    patch.dict("sys.modules", {"hermes_cli": None}):
                result = bridge.operation("matrix", "update", {"revision": "0" * 64,
                    "values": {"MATRIX_ACCESS_TOKEN": "synthetic"}}, forbidden_runtime)
            self.assertEqual(result["state"], "conflict")
            self.assertEqual(invoked, [])

    def test_revision_changes_without_leaking_secret(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge, "HOME", Path(directory)), \
                patch.object(bridge, "KEY", Path(directory) / "revision.key"):
            first = bridge.revision("matrix")
            (Path(directory) / ".env").write_text("MATRIX_ACCESS_TOKEN=synthetic-secret")
            second = bridge.revision("matrix")
            self.assertNotEqual(first, second)
            self.assertEqual(len(second), 64)
            self.assertNotIn("synthetic-secret", second)

    def test_save_runs_pinned_credential_lifecycle_and_redacts_response(self):
        launcher = types.ModuleType("hermes_cli._launchers")
        launcher.runtime_command = lambda *_args, **_kwargs: ["fake-runtime"]
        package = types.ModuleType("hermes_cli")
        calls = []
        def runner(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, json.dumps({"state": "saved", "appliedFields": 1}), "")
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge, "HOME", Path(directory)), \
                patch.object(bridge, "LOCK", Path(directory) / ".friday-config.lock"), \
                patch.object(bridge, "ROOT", Path(directory) / "hermes-agent"), \
                patch.object(bridge, "source_ok", return_value=True), \
                patch.object(bridge, "revision", side_effect=["a" * 64, "b" * 64]), \
                patch.dict(sys.modules, {"hermes_cli": package, "hermes_cli._launchers": launcher}):
            result = bridge.operation("matrix", "update", {"revision": "a" * 64,
                "values": {"MATRIX_ACCESS_TOKEN": "synthetic-secret"}}, runner)
        self.assertEqual(result["state"], "saved")
        self.assertFalse(result["gatewayRestarted"])
        self.assertEqual(calls[0][0], ["fake-runtime"])
        self.assertNotIn("synthetic-secret", json.dumps(result))

    def test_credential_error_after_first_attempt_is_uncertain(self):
        credentials = types.ModuleType("hermes_cli.credential_lifecycle")
        def fails_after_write(*_args):
            raise OSError("synthetic failure after env write")
        credentials.save_provider_env_credential = fails_after_write
        credentials.remove_provider_env_credential = fails_after_write
        with patch.dict(sys.modules, {"hermes_cli": types.ModuleType("hermes_cli"),
                "hermes_cli.credential_lifecycle": credentials}):
            result = apply_bridge.apply({"values": {"MATRIX_ACCESS_TOKEN": "synthetic-secret"}})
        self.assertEqual(result, {"state": "uncertain", "appliedFields": 0})


if __name__ == "__main__":
    unittest.main()
