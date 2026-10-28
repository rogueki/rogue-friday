"""Prueft, dass setup_hermes.sh fuer eigene Anbieter model.base_url setzt."""

import os
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "setup_hermes.sh"


@unittest.skipUnless(shutil.which("bash") and os.name != "nt", "braucht bash unter Linux")
class SetupHermesBaseUrlTest(unittest.TestCase):
    """Fuehrt den Anbieter-Block des Skripts gegen ein Fake-hermes aus."""

    def provider_block(self):
        """Liefert den Block von der Key-Zeile bis zur ANBIETER-Ausgabe."""
        lines = SCRIPT.read_text(encoding="utf-8").splitlines()
        start_marker = 'sed -i "/^${KEY_VAR}=/d"'
        end_marker = "printf 'ANBIETER="
        start = next((i for i, line in enumerate(lines) if line.startswith(start_marker)), None)
        self.assertIsNotNone(start, f"Blockstart {start_marker} fehlt")
        end = next((i for i, line in enumerate(lines) if i > start and line.startswith(end_marker)), None)
        self.assertIsNotNone(end, f"Blockende {end_marker} fehlt")
        return "\n".join(lines[start:end + 1])

    def run_provider_block(self, provider, base_url, key_var):
        """Laesst den herausgeschnittenen Block mit einem Fake-Home laufen."""
        block = self.provider_block()
        with tempfile.TemporaryDirectory() as tmp:
            hermes_dir = Path(tmp) / "home" / ".hermes"
            hermes_dir.mkdir(parents=True)
            (hermes_dir / ".env").write_text("", encoding="utf-8")
            bin_dir = Path(tmp) / "bin"
            bin_dir.mkdir()
            hermes = bin_dir / "hermes"
            hermes.write_text('#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HERMES_LOG"\n', encoding="utf-8")
            hermes.chmod(0o755)
            log = Path(tmp) / "hermes.log"
            script = "\n".join([
                "set -euo pipefail",
                f"H={shlex.quote(str(hermes_dir))}",
                f"PROVIDER={shlex.quote(provider)}",
                "MODEL=m1",
                f"BASE_URL={shlex.quote(base_url)}",
                f"KEY_VAR={shlex.quote(key_var)}",
                "KEY=secret-test",
                block,
                "",
            ])
            env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "HERMES_LOG": str(log)}
            subprocess.run(["bash", "-c", script], env=env, check=True, capture_output=True, text=True)
            log_lines = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
            env_text = (hermes_dir / ".env").read_text(encoding="utf-8")
        return log_lines, env_text

    def test_custom_sets_config_base_url_and_env_binding(self):
        log_lines, env_text = self.run_provider_block("custom", "https://llm.example.test/v1", "OPENAI_API_KEY")
        self.assertIn("config set model.base_url https://llm.example.test/v1", log_lines)
        env_lines = env_text.splitlines()
        self.assertIn("OPENAI_BASE_URL=https://llm.example.test/v1", env_lines)
        self.assertIn("OPENAI_API_KEY=secret-test", env_lines)

    def test_named_provider_does_not_set_base_url(self):
        log_lines, env_text = self.run_provider_block("openai-api", "", "OPENAI_API_KEY")
        self.assertFalse([line for line in log_lines if "model.base_url" in line])
        self.assertFalse([line for line in env_text.splitlines() if line.startswith("OPENAI_BASE_URL=")])

    def test_bridge_path_uses_inst_default(self):
        self.assertNotIn("$FRIDAY_INSTALLER/wsl/hermes_config_bridge.py", SCRIPT.read_text(encoding="utf-8"))

