"""Persona-Altdaten und SOUL.md-Pfade/Ports aus dem Installationslauf."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


COMMON = Path(__file__).resolve().parents[2] / "common"
sys.path.insert(0, str(COMMON))
import persona


class PersonaSoulTest(unittest.TestCase):
    def test_legacy_persona_without_wake_phrase_gets_derived_phrase(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "persona.json"
            # Windows schreibt die Datei mit BOM; das Fehlen von wake_phrase darf load() nicht stoeren.
            path.write_text(json.dumps({"assistant_name": "Friday"}), encoding="utf-8-sig")
            p = persona.load(str(path))
            self.assertEqual(p["wake_phrase"], persona.wake_phrase(p["assistant_name"]))
            self.assertEqual(p["address"], "sir")

    def test_soul_uses_install_root_and_friday_ports(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            json_path = root / "persona.json"
            json_path.write_text(json.dumps({"assistant_name": "Friday"}), encoding="utf-8")
            out = root / "SOUL.md"
            subprocess.run([sys.executable, str(COMMON / "persona.py"), str(json_path), str(out),
                            "/mnt/d/Kali/Friday", "43792", "43791"], check=True)
            soul = out.read_text(encoding="utf-8")
            self.assertIn("/mnt/d/Kali/Friday/exchange", soul)
            self.assertIn("127.0.0.1:43792", soul)
            self.assertIn("127.0.0.1:43791", soul)
            self.assertNotIn("/mnt/c/Friday", soul)
            self.assertNotIn("43691", soul)
            self.assertNotIn("43692", soul)

    def test_setup_hermes_passes_root_and_ports(self):
        setup = COMMON.parent / "wsl" / "setup_hermes.sh"
        line = 'python3 "$INST/common/persona.py" "$CFG/persona.json" "$H/SOUL.md" "$ROOT" "$QWEN_PORT" "$DASH_PORT"'
        self.assertIn(line, setup.read_text(encoding="utf-8").splitlines())


if __name__ == "__main__":
    unittest.main()
