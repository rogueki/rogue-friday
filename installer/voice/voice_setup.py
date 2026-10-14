"""JARVIS-Installer: Sprachmodelle laden, GPU/CPU fuer Whisper ermitteln, config/voice.json schreiben.

Aufruf: python voice_setup.py <C:\\Jarvis>
"""
import json
import os
import shutil
import sys
import time

ROOT = sys.argv[1] if len(sys.argv) > 1 else r"C:\Jarvis"
VOICE = os.path.join(ROOT, "voice")
MODELS = os.path.join(ROOT, "models")
CONFIG = os.path.join(ROOT, "config")
sys.path.insert(0, VOICE)
sys.path.insert(0, os.path.join(ROOT, "installer", "common"))
os.environ.setdefault("HF_HOME", os.path.join(ROOT, "cache", "huggingface"))

import cuda_dlls  # noqa: E402

cuda_dlls.register()
import numpy as np  # noqa: E402
import persona  # noqa: E402


def step(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


step("Wake-Word-Modelle (openWakeWord, enthaelt 'Hey Jarvis')")
import openwakeword  # noqa: E402

oww = os.path.join(MODELS, "openwakeword")
openwakeword.utils.download_models(target_directory=oww)
assert os.path.exists(os.path.join(oww, "hey_jarvis_v0.1.onnx")), "hey_jarvis-Modell fehlt"

step("Sprechererkennung (SpeechBrain ECAPA)")
from speechbrain.inference.speaker import EncoderClassifier  # noqa: E402
from speechbrain.utils.fetching import LocalStrategy  # noqa: E402

EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb", savedir=os.path.join(MODELS, "ecapa"),
                               local_strategy=LocalStrategy.COPY)
from silero_vad import load_silero_vad  # noqa: E402

load_silero_vad(onnx=True)

step("Spracherkennung (faster-whisper): GPU-Test")
from faster_whisper import WhisperModel  # noqa: E402

whisper = {"whisper_model": "base", "whisper_device": "cpu", "whisper_compute_type": "int8"}
try:
    m = WhisperModel("small", device="cuda", compute_type="int8", download_root=os.path.join(MODELS, "whisper"))
    m.transcribe(np.zeros(16000, dtype=np.float32), language="de")
    t = time.perf_counter()
    list(m.transcribe(np.zeros(16000 * 3, dtype=np.float32), language="de", beam_size=1)[0])
    print(f"   GPU ok ({(time.perf_counter() - t) * 1000:.0f} ms fuer 3 s Audio) -> small auf GPU")
    whisper = {"whisper_model": "small", "whisper_device": "cuda", "whisper_compute_type": "int8"}
    del m
except Exception as exc:  # Pascal/zu alte Treiber/kein NVIDIA: CPU ist langsamer, aber stabil
    print(f"   GPU nicht nutzbar ({str(exc)[:120]}) -> base auf CPU")
    WhisperModel("base", device="cpu", compute_type="int8", download_root=os.path.join(MODELS, "whisper"))

step("Stimme (Piper)")
from huggingface_hub import hf_hub_download  # noqa: E402

tts = os.path.join(MODELS, "tts")
os.makedirs(tts, exist_ok=True)
custom = os.path.join(ROOT, "installer", "voice_models", "jarvis_de.onnx")
if os.path.exists(custom):
    for ext in ("", ".json"):
        shutil.copy(custom + ext, os.path.join(tts, "jarvis_de.onnx" + ext))
    voice = os.path.join(tts, "jarvis_de.onnx")
    print("   eigene JARVIS-Stimme gefunden")
else:
    name = "de_DE-thorsten-medium"
    for ext in (".onnx", ".onnx.json"):
        dst = os.path.join(tts, name + ext)
        if not os.path.exists(dst):
            shutil.copy(hf_hub_download("rhasspy/piper-voices", f"de/de_DE/thorsten/medium/{name}{ext}"), dst)
    voice = os.path.join(tts, name + ".onnx")
    print("   Standardstimme Thorsten (maennlich) + JARVIS-Filmfilter")

step("config/voice.json schreiben")
p = persona.load(os.path.join(CONFIG, "persona.json"))
cfg = {
    **persona.voice_settings(p),
    "wake_model": os.path.join(oww, "hey_jarvis_v0.1.onnx"),
    "wake_verifier": os.path.join(oww, "hey_jarvis_owner_verifier.joblib"),
    "wake_threshold": 0.5,
    "wake_verifier_threshold": 0.3,
    "speaker_profile": os.path.join(VOICE, "profiles", "owner", "embeddings", "owner_ecapa.npy"),
    "speaker_threshold": 0.4,
    "vad_threshold": 0.5,
    "command_start_timeout_s": 5.0,
    "command_end_silence_s": 0.7,
    "command_max_s": 12.0,
    "followup_window_s": 8.0,
    "trusted_session_s": 90,
    **whisper,
    "qwen_url": "http://127.0.0.1:43692/v1/chat/completions",
    "hermes_url": "http://127.0.0.1:43693/v1/chat/completions",
    "hermes_model": "jarvis",
    "hermes_key_file": os.path.join(CONFIG, "hermes_api.key"),
    "tts_url": None,
    "tts_voice": voice,
    "tts_film_filter": True,
    "health_port": 43694,
    "game_processes": [],
    "game_check_s": 10,
    "input_device": None,
    "output_device": None,
}
with open(os.path.join(CONFIG, "voice.json"), "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
print(f"   whisper={whisper['whisper_model']}/{whisper['whisper_device']}")
print("VOICE_SETUP_DONE")
