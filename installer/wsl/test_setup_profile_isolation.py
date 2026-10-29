"""Prueft die harte Bereichstrennung der Domain-Agenten ueber eigene Linux-Benutzer."""

import os
import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("setup_profile_isolation.sh")
PROFILES = ("tasks", "communication", "calendar", "automations", "research", "alerts", "audit")
IS_ROOT = hasattr(os, "geteuid") and os.geteuid() == 0


def run_script(*args, port=None):
    """Ruft das Skript mit bash auf und liefert das abgeschlossene Ergebnis."""
    env = dict(os.environ)
    if port is not None:
        env["FRIDAY_AGENT_SSH_PORT"] = port
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


@unittest.skipUnless(shutil.which("bash") and os.name != "nt", "braucht bash unter Linux")
class SetupProfileIsolationTest(unittest.TestCase):
    """Prueft Rendering, Validierung und Aufrufschutz des Isolationsskripts."""

    def test_render_sshd_hardens_the_agent_port(self):
        result = run_script("render-sshd", port="2299")
        self.assertEqual(result.returncode, 0, result.stderr)
        for fragment in (
            "Port 2299",
            "ListenAddress 127.0.0.1",
            "PasswordAuthentication no",
            "PermitRootLogin no",
            "AllowTcpForwarding no",
        ):
            self.assertIn(fragment, result.stdout)

    def test_render_sshd_allows_exactly_the_agent_users(self):
        result = run_script("render-sshd")
        self.assertEqual(result.returncode, 0, result.stderr)
        allow_lines = [line for line in result.stdout.splitlines() if line.startswith("AllowUsers")]
        self.assertEqual(len(allow_lines), 1)
        self.assertEqual(allow_lines[0].split()[1:], [f"friday-{name}" for name in PROFILES])

    def test_invalid_port_is_rejected(self):
        for port in ("22", "abc"):
            with self.subTest(port=port):
                result = run_script("render-sshd", port=port)
                self.assertEqual(result.returncode, 2)
                self.assertIn("invalid_port", result.stderr)

    @unittest.skipIf(IS_ROOT, "apply muss als Nicht-root geprueft werden")
    def test_apply_requires_root(self):
        result = run_script("apply")
        self.assertEqual(result.returncode, 2)
        self.assertIn("root_required", result.stderr)

    def test_unknown_mode_is_rejected(self):
        result = run_script("destroy")
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid_mode", result.stderr)

    def test_script_parses_with_bash(self):
        result = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_script_uses_lf_line_endings(self):
        self.assertNotIn(b"\r", SCRIPT.read_bytes())
