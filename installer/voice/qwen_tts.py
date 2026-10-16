"""Local Qwen3-TTS synthesis with an explicitly supplied speaker recording."""

import os
import subprocess
import tempfile
import threading
import time

import soundfile as sf


def synthesize(text: str, cfg: dict, stop: threading.Event | None = None):
    executable = cfg["tts_qwen_executable"]
    model = cfg["tts_qwen_model"]
    projector = cfg["tts_qwen_projector"]
    reference = cfg["tts_reference"]
    for path in (executable, model, projector, reference):
        if not os.path.isfile(path):
            raise FileNotFoundError(f"Qwen3-TTS-Datei fehlt: {path}")
    output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(model))), "run")
    os.makedirs(output_dir, exist_ok=True)
    handle, output_path = tempfile.mkstemp(prefix="friday-tts-", suffix=".wav", dir=output_dir)
    os.close(handle)
    command = [executable, "-m", model, "-mm", projector, "-p", text,
               "--tts-lang", "de", "--tts-speaker-file", reference,
               "-ngl", str(cfg.get("tts_gpu_layers", 0)), "-c", "2048", "-n", "1024",
               "-o", output_path]
    process = None
    try:
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        deadline = time.monotonic() + 90
        while process.poll() is None:
            if stop is not None and stop.is_set():
                process.kill()
                process.communicate()
                return None
            if time.monotonic() >= deadline:
                process.kill()
                process.communicate()
                raise TimeoutError("Qwen3-TTS hat die Antwortzeit überschritten")
            time.sleep(0.1)
        _, errors = process.communicate()
        if process.returncode != 0:
            raise RuntimeError(f"Qwen3-TTS fehlgeschlagen (Exit {process.returncode}): {errors[-300:].decode('utf-8', 'replace')}")
        audio, rate = sf.read(output_path, dtype="float32", always_2d=False)
        if len(audio) == 0:
            raise RuntimeError("Qwen3-TTS lieferte eine leere WAV-Datei")
        return audio, rate
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            process.communicate()
        try:
            os.unlink(output_path)
        except FileNotFoundError:
            pass
