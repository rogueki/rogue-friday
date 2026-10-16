"""Begruessung nach der Installation: der Assistent spricht einen Satz (prueft Lautsprecher + Stimme + Filmfilter).

Aufruf: say_hello.py [ROOT] [TEXT]. Ohne TEXT wird der Assistentenname aus voice.json verwendet."""
import json
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else r"C:\Friday"
sys.path.insert(0, os.path.join(ROOT, "voice"))
import numpy as np  # noqa: E402
import sounddevice as sd  # noqa: E402
from film_filter import FilmFilter  # noqa: E402
from piper import PiperVoice, SynthesisConfig  # noqa: E402
from audio_output import for_output_device  # noqa: E402

cfg = json.load(open(os.path.join(ROOT, "config", "voice.json"), encoding="utf-8-sig"))
name = cfg.get("assistant_name")
default_text = f"Guten Tag. {name} ist installiert und einsatzbereit." if name else "Guten Tag. Der Assistent ist installiert und einsatzbereit."
text = sys.argv[2] if len(sys.argv) > 2 else default_text
if cfg.get("tts_backend") == "qwen3":
    import qwen_tts
    audio, rate = qwen_tts.synthesize(text, cfg)
else:
    voice = PiperVoice.load(cfg["tts_voice"])
    fx = FilmFilter(voice.config.sample_rate, cfg.get("tts_film_filter", True))
    audio = np.concatenate([fx.process(c.audio_float_array) for c in voice.synthesize(
        text, syn_config=SynthesisConfig(speaker_id=cfg.get("tts_speaker_id")))] + [fx.flush()])
    rate = voice.config.sample_rate
audio, rate = for_output_device(audio, rate, cfg.get("output_device"))
sd.play(audio, rate, device=cfg.get("output_device"))
sd.wait()
