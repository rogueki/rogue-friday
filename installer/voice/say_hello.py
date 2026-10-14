"""Begruessung nach der Installation: JARVIS spricht einen Satz (prueft Lautsprecher + Stimme + Filmfilter)."""
import json
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else r"C:\Jarvis"
sys.path.insert(0, os.path.join(ROOT, "voice"))
import numpy as np  # noqa: E402
import sounddevice as sd  # noqa: E402
from film_filter import FilmFilter  # noqa: E402
from piper import PiperVoice  # noqa: E402

cfg = json.load(open(os.path.join(ROOT, "config", "voice.json"), encoding="utf-8-sig"))
text = sys.argv[2] if len(sys.argv) > 2 else "Guten Tag. JARVIS ist installiert und einsatzbereit."
voice = PiperVoice.load(cfg["tts_voice"])
fx = FilmFilter(voice.config.sample_rate, cfg.get("tts_film_filter", True))
audio = np.concatenate([fx.process(c.audio_float_array) for c in voice.synthesize(text)] + [fx.flush()])
sd.play(audio, voice.config.sample_rate)
sd.wait()
