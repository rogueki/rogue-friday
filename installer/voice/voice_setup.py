"""Installer: lokale Sprachmodelle oder ElevenLabs-Cloudmodus einrichten und voice.json schreiben.

Aufruf: python voice_setup.py <C:\\Friday>
Assistentenname und Wake-Phrase kommen aus config/persona.json (assistant_name, Standard Friday; wake_phrase, frei
waehlbar, Standard "Hey <Name>"). Wake-Engine: "openwakeword" nur fuer die Phrase "Hey Jarvis" (vortrainiertes
hey_jarvis + Owner-Verifier), sonst "personal" (siehe personal_wake.py).
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time

args = argparse.ArgumentParser()
args.add_argument("root", nargs="?", default=r"C:\Friday")
args.add_argument("--voice-mode", choices=("local", "elevenlabs"), default="local")
args.add_argument("--elevenlabs-voice-id", default="21m00Tcm4TlvDq8ikWAM")
args.add_argument("--voice-choice", choices=("friday-female", "classic", "custom"), default="classic")
args.add_argument("--voice-reference", default="")
args.add_argument("--fast-tts", action="store_true")
args.add_argument("--fast-tts-port", type=int, default=43795)
args.add_argument("--qwen-port", type=int)
args.add_argument("--hermes-port", type=int)
args.add_argument("--voice-port", type=int)
args.add_argument("--conversation-backend", choices=("local", "qwen"), default="local")
args.add_argument("--qwen-consent", action="store_true")
args.add_argument("--qwen-region", choices=("ap-southeast-1", "cn-beijing"), default="ap-southeast-1")
options = args.parse_args()
for port in (options.qwen_port, options.hermes_port, options.voice_port):
    if port is not None and not 1 <= port <= 65535:
        args.error("service ports must be between 1 and 65535")
ROOT = options.root
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
PHRASE = p["wake_phrase"]
ENGINE = persona.wake_engine(PHRASE)
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

if options.voice_mode == "elevenlabs":
    whisper = {"whisper_model": None, "whisper_device": None, "whisper_compute_type": None}
    voice = None
    film_filter = False
    qwen_settings = {"tts_backend": "elevenlabs", "tts_reference": None, "tts_url": None,
                     "tts_reference_text_file": None, "tts_qwen_executable": None,
                     "tts_qwen_model": None, "tts_qwen_projector": None, "tts_gpu_layers": 0}
    print("   ElevenLabs Cloud: Scribe v2 STT + Flash v2.5 TTS; kein lokales Whisper/Piper/Qwen-TTS")
else:
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
    except Exception as exc:
        raise RuntimeError("Lokaler Sprachmodus benoetigt eine nutzbare NVIDIA-GPU mit mindestens 6 GB VRAM; "
                           "ElevenLabs Cloud waehlen, wenn CUDA nicht funktioniert") from exc

    step("Ausgabestimme")
    from huggingface_hub import hf_hub_download  # noqa: E402

    tts = os.path.join(MODELS, "tts")
    os.makedirs(tts, exist_ok=True)
    custom = os.path.join(ROOT, "installer", "voice_models", "jarvis_de.onnx")
    if options.voice_choice in ("friday-female", "custom"):
        name, folder = "de_DE-kerstin-low", "de/de_DE/kerstin/low"
        film_filter = False
        if options.voice_choice == "custom":
            print("   Eigene Stimme: Kerstin als lokale Ausfallstimme, Referenz kommt aus der Aufnahme")
        else:
            print("   F.R.I.D.A.Y.: Kerstin als lokale Ausfallstimme (weiblich, Deutsch)")
    elif os.path.exists(custom):
        if not os.path.exists(custom + ".json"):
            raise FileNotFoundError("jarvis_de.onnx.json fehlt neben der eigenen J.A.R.V.I.S.-Stimme")
        for ext in ("", ".json"):
            shutil.copy(custom + ext, os.path.join(tts, "jarvis_de.onnx" + ext))
        voice = os.path.join(tts, "jarvis_de.onnx")
        film_filter = True
        print("   eigene J.A.R.V.I.S.-Stimme gefunden")
    else:
        name, folder = "de_DE-thorsten-medium", "de/de_DE/thorsten/medium"
        film_filter = True
        if options.voice_reference:
            print("   Klassisch: eigene Referenz mit Qwen3-TTS; Thorsten als Ausfallstimme")
        else:
            print("   Klassisch: Thorsten (maennlich) mit Filmfilter; keine eigene J.A.R.V.I.S.-Datei vorhanden")
    if options.voice_choice in ("friday-female", "custom") or not os.path.exists(custom):
        for ext in (".onnx", ".onnx.json"):
            dst = os.path.join(tts, name + ext)
            if not os.path.exists(dst):
                shutil.copy(hf_hub_download("rhasspy/piper-voices", f"{folder}/{name}{ext}"), dst)
        voice = os.path.join(tts, name + ".onnx")
    # Both dashboard personas need their own local fallback if Qwen temporarily fails.
    for fallback_name, fallback_folder in (("de_DE-kerstin-low", "de/de_DE/kerstin/low"),
                                           ("de_DE-thorsten-medium", "de/de_DE/thorsten/medium")):
        for ext in (".onnx", ".onnx.json"):
            dst = os.path.join(tts, fallback_name + ext)
            if not os.path.exists(dst):
                shutil.copy(hf_hub_download("rhasspy/piper-voices", f"{fallback_folder}/{fallback_name}{ext}"), dst)

    qwen_settings = {"tts_backend": "piper", "tts_reference": None, "tts_url": None,
                     "tts_reference_text_file": None,
                     "tts_qwen_executable": None, "tts_qwen_model": None,
                     "tts_qwen_projector": None, "tts_gpu_layers": 0}
    if options.voice_reference:
        reference = os.path.abspath(options.voice_reference)
        if not os.path.isfile(reference) or os.path.splitext(reference)[1].lower() not in (".mp3", ".wav"):
            raise FileNotFoundError("Die Stimmreferenz muss eine vorhandene MP3- oder WAV-Datei sein")
        import soundfile as sf  # noqa: E402
        duration = sf.info(reference).duration
        if not 3 <= duration <= 30:
            raise ValueError("Die Stimmreferenz muss zwischen 3 und 30 Sekunden lang sein")
        local_reference = os.path.join(CONFIG, "voice-references", options.voice_choice + "-reference" + os.path.splitext(reference)[1].lower())
        os.makedirs(os.path.dirname(local_reference), exist_ok=True)
        if os.path.normcase(reference) != os.path.normcase(local_reference):
            shutil.copy2(reference, local_reference)
        if options.fast_tts and whisper["whisper_device"] == "cuda":
            import math
            from scipy.signal import resample_poly

            audio, source_rate = sf.read(local_reference, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            target_rate = 24000
            if source_rate != target_rate:
                common = math.gcd(source_rate, target_rate)
                audio = resample_poly(audio, target_rate // common, source_rate // common)
            local_wav = os.path.join(CONFIG, "voice-references", options.voice_choice + "-reference.wav")
            sf.write(local_wav, audio, target_rate, subtype="PCM_16")
            transcript_file = os.path.splitext(local_wav)[0] + ".txt"
            transcriber = WhisperModel(whisper["whisper_model"], device="cpu", compute_type="int8",
                                       download_root=os.path.join(MODELS, "whisper"))
            segments, _ = transcriber.transcribe(local_wav, beam_size=5, vad_filter=True)
            transcript = " ".join(segment.text.strip() for segment in segments).strip()
            if not transcript:
                raise ValueError("Stimmreferenz enthaelt keine erkennbaren gesprochenen Worte")
            with open(transcript_file, "w", encoding="utf-8") as target:
                target.write(transcript + "\n")
            qwen_settings = {**qwen_settings, "tts_backend": "streaming_qwen",
                             "tts_reference": local_wav, "tts_reference_text_file": transcript_file,
                             "tts_url": f"http://127.0.0.1:{options.fast_tts_port}/tts/stream"}
            print("   Lokale Qwen3-TTS-0.6B-Stimme vorbereitet (dauerhaft geladener WSL-Dienst)")
        else:
            model_dir = os.path.join(MODELS, "tts-qwen")
            os.makedirs(model_dir, exist_ok=True)
            repo = "ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF"
            files = {
                "Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf": "8d18c94acb2addd042f97da63c98be144eafa76d0d9495177eab65130cf85129",
                "mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf": "6fd65188839bcd6ecc91b277ad471e22a0edfada4699a0fe82f1165c18cfcce2",
            }
            for filename, expected_hash in files.items():
                target = os.path.join(model_dir, filename)
                if not os.path.isfile(target):
                    shutil.copy2(hf_hub_download(repo_id=repo, filename=filename), target)
                with open(target, "rb") as source:
                    digest = hashlib.file_digest(source, "sha256").hexdigest()
                if digest != expected_hash:
                    raise ValueError(f"Prüfsumme des Qwen3-TTS-Modells stimmt nicht: {filename}")
            executable = os.path.join(ROOT, "llama.cpp", "llama-tts.exe")
            if not os.path.isfile(executable):
                raise FileNotFoundError("llama-tts.exe fehlt; zuerst Qwen/llama.cpp installieren")
            qwen_settings = {**qwen_settings, "tts_backend": "qwen3", "tts_reference": local_reference,
                             "tts_qwen_executable": executable,
                             "tts_qwen_model": os.path.join(model_dir, "Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf"),
                             "tts_qwen_projector": os.path.join(model_dir, "mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf"),
                             "tts_gpu_layers": 99 if whisper["whisper_device"] == "cuda" else 0}
            print("   Lokale Qwen3-TTS-Stimme mit eigener Referenz (keine Cloud-Sprachausgabe)")

step("config/voice.json schreiben")
voice_config_path = os.path.join(CONFIG, "voice.json")
previous = {}
if os.path.exists(voice_config_path):
    try:
        with open(voice_config_path, encoding="utf-8-sig") as source:
            loaded = json.load(source)
        if isinstance(loaded, dict):
            previous = loaded
    except (OSError, ValueError):
        print("   Vorhandene voice.json ist ungültig; Standardwerte werden verwendet")
cfg = {
    **persona.voice_settings(p),
    # Weg "Hey Jarvis" (wake_engine "openwakeword"): vortrainiertes Modell + Owner-Verifier, unveraendert
    "wake_model": os.path.join(oww, "hey_jarvis_v0.1.onnx"),
    "wake_verifier": os.path.join(oww, "hey_jarvis_owner_verifier.joblib"),
    "wake_threshold": 0.5,
    "wake_verifier_threshold": 0.3,
    # Persoenlicher Weg (wake_engine "personal"): Fenstermodell aus den Enrollment-Aufnahmen (build_personal_wake.py);
    # die Schwelle steht in personal_wake_meta (kalibriert), "personal_wake_threshold" ueberschreibt sie.
    "personal_wake_model": os.path.join(oww, "personal_wake.npz"),
    "personal_wake_meta": os.path.join(oww, "personal_wake.json"),
    "personal_wake_threshold": None,
    # Stufe 2 (nur persoenlicher Weg): Whisper-Abgleich mit der Wake Phrase auf dem ~2-s-Fenster nach Stufe 1
    "wake_confirm": True,
    "wake_confirm_languages": ["de", "en"],
    "wake_aliases": personal_wake.default_aliases(PHRASE),
    "wake_reject_words": personal_wake.default_reject_words(PHRASE),
    "wake_match_max_dist": None,
    "wake_refractory_s": 1.0,
    "speaker_profile": os.path.join(VOICE, "profiles", "owner", "embeddings", "owner_ecapa.npy"),
    "speaker_threshold": 0.4,
    "vad_threshold": 0.5,
    "command_start_timeout_s": 5.0,
    "command_end_silence_s": 0.7,
    "command_max_s": 12.0,
    "followup_window_s": 20.0,
    "trusted_session_s": 90,
    **whisper,
    "voice_mode": options.voice_mode,
    "elevenlabs_key_file": os.path.join(CONFIG, "elevenlabs_api.key.dpapi"),
    "elevenlabs_voice_id": options.elevenlabs_voice_id,
    "qwen_url": "http://127.0.0.1:43692/v1/chat/completions",
    "hermes_url": "http://127.0.0.1:43693/v1/chat/completions",
    "hermes_model": "friday",
    "cloud_provider": "kimi-coding",
    "cloud_models": {"cloud_low": "kimi-for-coding", "cloud_high": "k3", "cloud_max": "k3"},
    "hermes_key_file": os.path.join(CONFIG, "hermes_api.key"),
    "tts_url": None,
    "tts_voice": voice,
    "tts_film_filter": film_filter,
    "tts_voice_choice": options.voice_choice,
    "health_port": 43694,
    "game_processes": [],
    "game_check_s": 10,
    "input_device": None,
    "output_device": None,
}
# A voice change must not reset the user's microphone, local service ports,
# calibrated wake threshold or other tuning from the running installation.
cfg.update(previous)
# The conversation window starts after playback. Upgrade old eight- and fifteen-second installs.
if cfg.get("followup_window_s") in (8.0, 15.0):
    cfg["followup_window_s"] = 20.0
cfg.update(persona.voice_settings(p))
cfg.update({"voice_mode": options.voice_mode, "elevenlabs_voice_id": options.elevenlabs_voice_id,
            "elevenlabs_key_file": os.path.join(CONFIG, "elevenlabs_api.key.dpapi"),
            "conversation_backend": options.conversation_backend, "qwen_region": options.qwen_region,
            "qwen_key_file": os.path.join(CONFIG, "alibaba_tokenplan.key.dpapi"),
            "tts_voice": voice, "tts_film_filter": film_filter,
            "tts_voice_choice": options.voice_choice, "tts_speaker_id": None, **qwen_settings})
if options.qwen_consent:
    cfg["qwen_consent"] = True
if options.voice_mode == "elevenlabs":
    saved_ids = cfg.get("elevenlabs_voice_ids")
    ids = dict(saved_ids) if isinstance(saved_ids, dict) else {}
    ids[options.voice_choice] = options.elevenlabs_voice_id
    cfg["elevenlabs_voice_ids"] = ids
if options.qwen_port is not None:
    cfg["qwen_url"] = f"http://127.0.0.1:{options.qwen_port}/v1/chat/completions"
if options.hermes_port is not None:
    cfg["hermes_url"] = f"http://127.0.0.1:{options.hermes_port}/v1/chat/completions"
if options.voice_port is not None:
    cfg["health_port"] = options.voice_port
with open(voice_config_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
print(f"   whisper={whisper['whisper_model']}/{whisper['whisper_device']}")
print(f"   assistant_name={NAME} wake_phrase={PHRASE} wake_engine={ENGINE}")
print("VOICE_SETUP_DONE")
