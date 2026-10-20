"""Keep the pinned incremental voice payload aligned with local runtime imports."""

import ast
import collections
import re
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]
VOICE = REPO / "installer" / "voice"


def local_import_closure() -> set[str]:
    sources = {path.stem: path for path in VOICE.glob("*.py")}
    pending = collections.deque(["friday_voice"])
    found: set[str] = set()
    while pending:
        name = pending.popleft()
        if name in found:
            continue
        found.add(name)
        tree = ast.parse(sources[name].read_text(encoding="utf-8-sig"))
        for node in ast.walk(tree):
            modules = []
            if isinstance(node, ast.Import):
                modules = [alias.name.split(".")[0] for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                modules = [node.module.split(".")[0]]
            pending.extend(module for module in modules if module in sources and module not in found)
    return found


class VoiceUpdateDependencyClosureTest(unittest.TestCase):
    def test_old_install_with_missing_mail_module_gets_complete_pinned_payload(self):
        expected = local_import_closure() | {"prepare_voice_pairs", "build_personal_wake", "enroll_record", "negative_texts"}
        updater = (REPO / "installer" / "scripts" / "update-dashboard-github.ps1").read_text(encoding="utf-8-sig")
        helper = (REPO / "installer" / "scripts" / "update-voice-personas.ps1").read_text(encoding="utf-8-sig")
        source_function = updater.split("function Get-VoiceSourcePaths {", 1)[1].split("function Assert-VerifiedVoiceSources", 1)[0]
        pinned = set(re.findall(r"installer/voice/([\w]+)\.py", source_function))
        installed = set(re.findall(r"'voice\\([\w]+)\.py'", helper.split("$files = @(", 1)[1].split("\n)", 1)[0]))
        self.assertEqual(pinned, expected)
        self.assertEqual(installed, expected)
        with tempfile.TemporaryDirectory() as directory:
            old_runtime = Path(directory) / "voice"
            old_runtime.mkdir()
            (old_runtime / "friday_voice.py").write_bytes((VOICE / "friday_voice.py").read_bytes())
            self.assertFalse((old_runtime / "mail_voice.py").exists())
            self.assertFalse((old_runtime / "research_voice.py").exists())
            for name in installed:
                (old_runtime / f"{name}.py").write_bytes((VOICE / f"{name}.py").read_bytes())
            for name in local_import_closure():
                compile((old_runtime / f"{name}.py").read_bytes(), str(old_runtime / f"{name}.py"), "exec")


if __name__ == "__main__":
    unittest.main()
