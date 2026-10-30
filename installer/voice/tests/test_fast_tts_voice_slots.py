"""install_wsl.sh / update_personas.sh with stubbed systemctl and curl: the own voice pair is optional."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

FAST_TTS = Path(__file__).resolve().parents[2] / "fast_tts"
RUN_ID = "0" * 32

CURL_STUB = """#!/usr/bin/env bash
python3 - "$HOME" <<'PY'
import json, os, sys
voices = sorted(name[:-4] for name in os.listdir(os.path.join(sys.argv[1], "friday-tts", "voices")) if name.endswith(".wav"))
print(json.dumps({"ok": True, "ready": True, "voices": voices}))
PY
"""


class FastTtsVoiceSlots(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.home, self.bin, self.src = base / "home", base / "bin", base / "src"
        for folder in (self.home, self.bin, self.src):
            folder.mkdir()
        self.stub("systemctl", "#!/usr/bin/env bash\nexit 0\n")
        self.stub("curl", CURL_STUB)
        self.root = self.home / "friday-tts"
        self.unit = self.home / ".config" / "systemd" / "user" / "friday-tts.service"

    def tearDown(self):
        self.tmp.cleanup()

    def stub(self, name, body):
        path = self.bin / name
        path.write_text(body, encoding="utf-8")
        path.chmod(0o755)

    def source(self, name, text):
        path = self.src / name
        path.write_text(text, encoding="utf-8")
        return str(path)

    def pairs(self, with_custom):
        files = [self.source("friday.wav", "F"), self.source("friday.txt", "Hallo"),
                 self.source("classic.wav", "C"), self.source("classic.txt", "Guten Tag")]
        if with_custom:
            files += [self.source("custom.wav", "O"), self.source("custom.txt", "Eigene Stimme")]
        return files

    def run_script(self, name, *args):
        env = {**os.environ, "HOME": str(self.home), "PATH": f"{self.bin}:{os.environ['PATH']}"}
        return subprocess.run(["bash", str(FAST_TTS / name), *args], env=env, capture_output=True, text=True, timeout=120)

    def install(self, *voice_files):
        # A present venv skips the package download; the stubs replace systemd.
        venv = self.root / ".venv-fast" / "bin"
        venv.mkdir(parents=True, exist_ok=True)
        (venv / "python").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
        (venv / "python").chmod(0o755)
        return self.run_script("install_wsl.sh", self.source("ref.wav", "R"), self.source("ref.txt", "Referenz"), "8123", *voice_files)

    def test_install_places_the_own_pair_only_when_given(self):
        result = self.install(*self.pairs(with_custom=True))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(path.name for path in (self.root / "voices").iterdir()),
                         ["classic.txt", "classic.wav", "custom.txt", "custom.wav", "friday-female.txt", "friday-female.wav"])
        self.assertIn(f"--voice-dir {self.root}/voices", self.unit.read_text(encoding="utf-8"))

    def test_install_keeps_two_pairs_and_refuses_a_partial_pair(self):
        result = self.install(*self.pairs(with_custom=False))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / "voices" / "custom.wav").exists())
        self.assertEqual(self.install(*self.pairs(with_custom=True)[:5]).returncode, 2)

    def test_update_applies_two_or_three_pairs_and_rejects_other_counts(self):
        self.assertEqual(self.install(*self.pairs(with_custom=False)).returncode, 0)
        server = self.source("server.py", "# new\n")
        two = self.run_script("update_personas.sh", "Apply", RUN_ID, server, *self.pairs(with_custom=False))
        self.assertEqual(two.returncode, 0, two.stderr)
        self.assertIn("applied", two.stdout)
        three = self.run_script("update_personas.sh", "Apply", "1" * 32, server, *self.pairs(with_custom=True))
        self.assertEqual(three.returncode, 0, three.stderr)
        self.assertEqual((self.root / "voices" / "custom.txt").read_text(encoding="utf-8"), "Eigene Stimme")
        self.assertEqual((self.root / "server.py").read_text(encoding="utf-8"), "# new\n")
        partial = self.run_script("update_personas.sh", "Apply", "2" * 32, server, *self.pairs(with_custom=True)[:5])
        self.assertEqual(partial.returncode, 2)

    def test_rollback_restores_the_state_before_the_own_pair(self):
        self.assertEqual(self.install(*self.pairs(with_custom=False)).returncode, 0)
        run_id = "3" * 32
        applied = self.run_script("update_personas.sh", "Apply", run_id, self.source("server.py", "# new\n"), *self.pairs(with_custom=True))
        self.assertEqual(applied.returncode, 0, applied.stderr)
        rolled = self.run_script("update_personas.sh", "Rollback", run_id)
        self.assertEqual(rolled.returncode, 0, rolled.stderr)
        self.assertFalse((self.root / "voices" / "custom.wav").exists())
        self.assertNotEqual((self.root / "server.py").read_text(encoding="utf-8"), "# new\n")


if __name__ == "__main__":
    unittest.main()
