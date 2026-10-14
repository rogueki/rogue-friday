"""Installer: Sprachmodelle laden, GPU/CPU fuer Whisper ermitteln, config/voice.json schreiben.

Aufruf: python voice_setup.py <C:\\Jarvis>
Assistentenname und Wake-Phrase kommen aus config/persona.json (assistant_name, Standard Friday). Wake-Engine:
"openwakeword" nur fuer Jarvis (vortrainiertes hey_jarvis + Owner-Verifier), sonst "personal" (siehe personal_wake.py).
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
import personal_wake  # noqa: E402


def step(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


p = persona.load(os.path.join(CONFIG, "persona.json"))
NAME = p["assistant_name"]
ENGINE = persona.wake_engine(NAME)
PHRASE = persona.wake_phrase(NAME)
print(f"   Assistent: {NAME} | Wake Word: {PHRASE} | Engine: {ENGINE}")

step("Wake-Word-Modelle (openWakeWord: Audio-Features, enthaelt 'Hey Jarvis')")
import openwakeword  # noqa: E402

oww = os.path.join(MODELS, "openwakeword")
openwakeword.utils.download_models(target_directory=oww)
for needed in ("melspectrogram.onnx", "embedding_model.onnx"):
    assert os.path.exists(os.path.join(oww, needed)), f"{needed} fehlt"
if ENGINE == "openwakeword":
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
    print("   eigene Assistenten-Stimme gefunden")
else:
    name = "de_DE-thorsten-medium"
    for ext in (".onnx", ".onnx.json"):
        dst = os.path.join(tts, name + ext)
        if not os.path.exists(dst):
            shutil.copy(hf_hub_download("rhasspy/piper-voices", f"de/de_DE/thorsten/medium/{name}{ext}"), dst)
    voice = os.path.join(tts, name + ".onnx")
    print("   Standardstimme Thorsten (maennlich) + Filmfilter")

step("config/voice.json schreiben")
cfg = {
    **persona.voice_settings(p),
    # Jarvis-Weg (wake_engine "openwakeword"): vortrainiertes Modell + Owner-Verifier, unveraendert
    "wake_model": os.path.join(oww, "hey_jarvis_v0.1.onnx"),
    "wake_verifier": os.path.join(oww, "hey_jarvis_owner_verifier.joblib"),
    "wake_threshold": 0.5,
    "wake_verifier_threshold": 0.3,
    # Persoenlicher Weg (wake_engine "personal"): Fenstermodell aus den Enrollment-Aufnahmen (build_personal_wake.py);
    # die Schwelle steht in personal_wake_meta (kalibriert), "personal_wake_threshold" ueberschreibt sie.
    "personal_wake_model": os.path.join(oww, "personal_wake.npz"),
    "personal_wake_meta": os.path.join(oww, "personal_wake.json"),
    "personal_wake_threshold": None,
    # Stufe 2 (nur persoenlicher Weg): Whisper-Namenscheck auf dem ~2-s-Fenster nach Stufe 1
    "wake_confirm": True,
    "wake_confirm_languages": ["de", "en"],
    "wake_aliases": personal_wake.default_aliases(NAME),
    "wake_reject_words": personal_wake.default_reject_words(NAME),
    "wake_match_max_dist": None,
    "wake_refractory_s": 1.0,
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
print(f"   assistant_name={NAME} wake_phrase={PHRASE} wake_engine={ENGINE}")
print("VOICE_SETUP_DONE")
