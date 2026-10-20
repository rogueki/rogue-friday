"""The cached updater and WSL installer must ship the same runtime helpers."""

import re
import unittest
from pathlib import Path


INSTALLER = Path(__file__).resolve().parents[1]
REQUIRED = {
    "installer/wsl/hermes_config_bridge.py",
    "installer/wsl/hermes_model_credential_apply.py",
    "installer/wsl/hermes_model_catalog.py",
    "installer/wsl/hermes_plugin_activation.py",
    "installer/wsl/hermes_mcp_http_apply.py",
    "installer/wsl/hermes_mcp_protocol_probe.py",
    "installer/wsl/hermes_mcp_bearer_apply.py",
    "installer/wsl/hermes_mcp_auth_probe.py",
    "installer/wsl/patch_hermes_run_stop.py",
    "installer/wsl/setup_hermes.sh",
    "installer/wsl/hermes_mcp_oauth_transport.py",
    "installer/wsl/hermes_mcp_oauth_worker.py",
    "installer/scripts/recover-friday.ps1",
    "installer/wsl/configure_messenger_inbound_bridge.py",
    "installer/wsl/setup_messenger_inbound_bridge.sh",
    "installer/wsl/setup_searxng.sh",
    "installer/wsl/research_searxng_settings.py",
}


class WslUpdateDependencyClosureTest(unittest.TestCase):
    def test_runtime_helpers_are_in_both_verified_payloads(self):
        updater = (INSTALLER / "scripts" / "update-dashboard-github.ps1").read_text(encoding="utf-8-sig")
        helper = (INSTALLER / "scripts" / "update-memory-bridge.ps1").read_text(encoding="utf-8-sig")
        source = updater.split("function Get-WslBridgeSourcePaths {", 1)[1].split("function Get-VoiceSourcePaths", 1)[0]
        source_paths = {path.replace("\\", "/") for path in re.findall(r"'([^']+)'", source)
                        if path.startswith("installer/")}
        memory_paths = {path.replace("\\", "/") for path in re.findall(r"'([^']+)'", helper.split("$paths = @(", 1)[1].split(")", 1)[0])
                        if path.startswith(("installer\\wsl\\", "installer\\scripts\\recover-friday.ps1"))}
        self.assertTrue(REQUIRED <= source_paths)
        self.assertTrue(REQUIRED <= memory_paths)
        self.assertTrue(source_paths <= memory_paths)


if __name__ == "__main__":
    unittest.main()
