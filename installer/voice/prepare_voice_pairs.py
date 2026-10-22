"""Prepare the two installed, local Qwen reference pairs without exporting private audio."""

import argparse
import json
import math
import os
import hashlib
import shutil
from pathlib import Path


BUNDLED_REFERENCES = {"friday-female": "friday_ref", "classic": "jarvis_ref"}


def reference_sources(reference_dir: Path, package: Path) -> dict[str, list[Path]]:
    """Referenzkandidaten je Stimmplatz. Der eigene Platz hat bewusst keine Paket-Referenz: er entsteht nur
    aus der Aufnahme des Nutzers, damit ein fehlendes Update nie eine fremde Stimme unterschiebt."""
    return {
        "friday-female": [reference_dir / "friday-female-reference.wav",
                          reference_dir / "friday-female-reference.mp3",
                          reference_dir / "female-reference.mp3",
                          package / "voice_models" / "friday_ref.wav"],
        "classic": [reference_dir / "classic-reference.wav",
                    reference_dir / "classic-reference.mp3",
                    package / "voice_models" / "jarvis_ref.wav"],
        "custom": [reference_dir / "custom-reference.wav",
                   reference_dir / "custom-reference.mp3"],
    }


def bundled_reference(package: Path, choice: str) -> Path | None:
    name = BUNDLED_REFERENCES.get(choice)
    return package / "voice_models" / name if name else None

def prepare(root: Path, package: Path) -> dict[str, bool]:
    import soundfile as sf
    from scipy.signal import resample_poly
    from huggingface_hub import hf_hub_download

    tts_dir = root / "models" / "tts"
    tts_dir.mkdir(parents=True, exist_ok=True)
    for name, folder in (("de_DE-kerstin-low", "de/de_DE/kerstin/low"),
                         ("de_DE-thorsten-medium", "de/de_DE/thorsten/medium")):
        for extension in (".onnx", ".onnx.json"):
            target = tts_dir / f"{name}{extension}"
            if not target.is_file():
                shutil.copy2(hf_hub_download("rhasspy/piper-voices", f"{folder}/{name}{extension}"), target)

    reference_dir = root / "config" / "voice-references"
    reference_dir.mkdir(parents=True, exist_ok=True)
    sources = reference_sources(reference_dir, package)
    transcriber = None
    available = {}
    for choice, candidates in sources.items():
        source = next((path for path in candidates if path.is_file()), None)
        if source is None:
            available[choice] = False
            continue
        canonical = reference_dir / f"{choice}-reference.wav"
        if source.parent == package / "voice_models" and not canonical.is_file():
            shutil.copy2(source, canonical)
            source = canonical
        audio, rate = sf.read(source, dtype="float32")
        duration = len(audio) / rate
        if not 3 <= duration <= 30:
            raise ValueError(f"Ungültige Referenzdauer für {choice}")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if rate != 24000:
            divisor = math.gcd(rate, 24000)
            audio = resample_poly(audio, 24000 // divisor, rate // divisor)
        wav = reference_dir / f"{choice}-streaming.wav"
        txt = reference_dir / f"{choice}-reference.txt"
        sf.write(wav, audio, 24000, subtype="PCM_16")
        if not txt.is_file() or not txt.read_text(encoding="utf-8").strip():
            bundled = bundled_reference(package, choice)
            bundled_wav = bundled.with_suffix(".wav") if bundled else None
            bundled_txt = bundled.with_suffix(".txt") if bundled else None
            if bundled_wav and bundled_txt and bundled_wav.is_file() and bundled_txt.is_file() and hashlib.sha256(source.read_bytes()).digest() == hashlib.sha256(bundled_wav.read_bytes()).digest():
                words = bundled_txt.read_text(encoding="utf-8").strip()
            else:
                if transcriber is None:
                    # Nur bei Bedarf importieren: liegt ein Referenztext vor, wird kein Whisper gebraucht.
                    from faster_whisper import WhisperModel
                    transcriber = WhisperModel("small", device="cpu", compute_type="int8",
                                                download_root=str(root / "models" / "whisper"))
                segments, _ = transcriber.transcribe(str(wav), beam_size=5, vad_filter=True)
                words = " ".join(segment.text.strip() for segment in segments).strip()
            if not words:
                raise ValueError(f"Stimmreferenz {choice} enthält keine erkennbaren Worte")
            txt.write_text(words + "\n", encoding="utf-8")
        available[choice] = True
    return available


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("package", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(prepare(arguments.root, arguments.package)))
