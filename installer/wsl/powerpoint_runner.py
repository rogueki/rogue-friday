#!/usr/bin/env python3
"""Run Hermes' bundled PowerPoint creator with a bounded Friday deck spec."""
import base64
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main():
    payload = json.load(sys.stdin)
    home = Path.home()
    script = home / ".hermes/skills/productivity/powerpoint/scripts/pptx_create.py"
    if not script.is_file():
        raise RuntimeError("Hermes PowerPoint skill is missing")
    python = home / ".local/share/friday/powerpoint-venv/bin/python"
    if not python.is_file():
        python = Path(shutil.which("python") or "/usr/bin/python3")
    with tempfile.TemporaryDirectory(prefix="friday-pptx-") as directory:
        spec = Path(directory) / "deck.json"
        output = Path(directory) / "deck.pptx"
        spec.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        result = subprocess.run([str(python), str(script), str(spec), str(output)],
                                capture_output=True, text=True, timeout=20, check=False,
                                cwd=directory)
        if result.returncode != 0 or not output.is_file():
            raise RuntimeError("Hermes PowerPoint creation failed")
        if output.stat().st_size > 4_000_000:
            raise RuntimeError("PowerPoint output exceeds limit")
        print(json.dumps({"pptx": base64.b64encode(output.read_bytes()).decode("ascii")}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(4)
