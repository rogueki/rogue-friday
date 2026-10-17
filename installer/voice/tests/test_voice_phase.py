"""Tests fuer die Orb-Phasen im Status-JSON (`phase`, `tts_active`, `input_audio`/`output_audio`) und die Baender.

Ausfuehren: python3 -m pytest installer/voice/tests/test_voice_phase.py
"""
import os
import sys
import threading
import types

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = os.path.dirname(HERE)
for path in (VOICE, HERE):
    if path not in sys.path:
        sys.path.insert(0, path)

import audio_level as al  # noqa: E402
import test_personal_wake as helpers  # noqa: E402


def tone(frequency: float, amplitude: float = 0.3, rate: int = 16000, n: int = 1280) -> np.ndarray:
    t = np.arange(n) / rate
    return (amplitude * np.sin(2 * np.pi * frequency * t)).astype(np.float32)


# ---------------------------------------------------------------------------------------------------- Baender

def test_bands_follow_frequency():
    low = al.band_levels(tone(120))
    mid = al.band_levels(tone(800))
    high = al.band_levels(tone(4000))
    assert low["low"] > low["mid"] and low["low"] > low["high"]
    assert mid["mid"] > mid["low"] and mid["mid"] > mid["high"]
    assert high["high"] > high["low"] and high["high"] > high["mid"]
    assert all(0.0 <= v <= 1.0 for band in (low, mid, high) for v in band.values())


def test_bands_depend_on_sample_rate():
    # 3 kHz ist bei 16 kHz "high"; bei 48 kHz mit gleicher Blocklaenge bleibt es "high", 600 Hz bleibt "mid".
    assert al.band_levels(tone(3000, rate=48000, n=2048), 48000)["high"] > 0.2
    assert al.band_levels(tone(600, rate=48000, n=2048), 48000)["mid"] > 0.2


def test_silence_empty_and_nan_give_zero_bands():
    zero = {"low": 0.0, "mid": 0.0, "high": 0.0}
    assert al.band_levels(np.zeros(1280, dtype=np.float32)) == zero
    assert al.band_levels(np.array([], dtype=np.float32)) == zero
    assert al.band_levels(np.full(1280, np.nan, dtype=np.float32)) == zero


def test_peak_at_least_rms_and_decays():
    wave = tone(440, 0.4)
    assert al.normalized_peak(wave) >= al.normalized_rms(wave)
    meter = al.LevelMeter(lambda: 1.0)
    meter.update(wave)
    first = meter.snapshot()["peak"]
    meter.update(np.zeros(1280, dtype=np.float32))
    assert 0.0 < meter.snapshot()["peak"] < first


def test_snapshot_stale_and_reset():
    now = [10.0]
    meter = al.LevelMeter(lambda: now[0])
    meter.update(tone(300, 0.5))
    snap = meter.snapshot()
    assert set(snap) == {"level", "peak", "low", "mid", "high"}
    assert snap["level"] == meter.value() > 0
    now[0] += al.STALE_S + 0.1
    assert set(meter.snapshot().values()) == {0.0}
    meter.update(tone(300, 0.5))
    meter.reset()
    assert set(meter.snapshot().values()) == {0.0}


# ---------------------------------------------------------------------------------------------------- Phase

def make_service():
    jv = helpers.load_voice_module()
    svc = helpers.make_service(jv, {})
    svc.tts = types.SimpleNamespace(speaking=threading.Event(), level=al.LevelMeter())
    svc.input_level = al.LevelMeter()
    svc.audio_transport = "device"
    svc.processing = None
    return svc


def test_phase_table():
    svc = make_service()
    for state, processing, speaking, expected in [
        ("starting", None, False, "idle"),
        ("waiting_audio", None, False, "idle"),
        ("listening", None, False, "idle"),
        ("paused", None, False, "idle"),
        ("command", None, False, "listening"),
        ("followup", None, False, "listening"),
        ("command", "transcribing", False, "transcribing"),
        ("command", "thinking", False, "thinking"),
        ("command", "thinking", True, "speaking"),  # Quittung ("Moment.") waehrend der Wartezeit
        ("speaking", None, False, "speaking"),
        ("followup", None, True, "speaking"),
    ]:
        svc.status["state"] = state
        svc.processing = processing
        svc.tts.speaking.set() if speaking else svc.tts.speaking.clear()
        assert svc.voice_phase() == expected, (state, processing, speaking)


def test_status_payload_is_additive_and_backward_compatible():
    svc = make_service()
    svc.status["state"] = "command"
    svc.processing = "thinking"
    svc.tts.level.update(tone(200, 0.5, rate=22050), 22050)
    payload = svc.status_payload()
    for key in ("state", "started", "last_event", "wake_count", "rejected_speaker", "commands"):
        if key in svc.status:
            assert payload[key] == svc.status[key]
    assert payload["state"] == "command"  # bisheriger Wert unveraendert
    assert payload["phase"] == "thinking"
    assert payload["tts_active"] is False and payload["speaking"] is False
    assert payload["input_level"] == 0.0
    assert payload["output_level"] > 0
    assert set(payload["output_audio"]) == {"level", "peak", "low", "mid", "high"}
    assert payload["output_audio"]["low"] > payload["output_audio"]["high"]
    assert payload["audio_transport"] == "device"
    # Datenschutz: weder Text noch Audio im Status
    assert not any(isinstance(v, (bytes, bytearray, np.ndarray)) for v in payload.values())
    assert "text" not in payload and "transcript" not in payload


def test_handle_command_sets_transcribing_then_thinking(monkeypatch):
    jv = helpers.load_voice_module()
    svc = helpers.make_service(jv, {})
    seen = []
    svc.processing = None
    svc.control_generation = 0
    svc.cfg.update({"speaker_threshold": 0.4, "trusted_session_s": 15})
    svc.verifier = types.SimpleNamespace(score=lambda audio: 0.9)

    def transcribe(audio):
        seen.append(svc.processing)
        return "ruf an"

    def cloudtalk(text):
        seen.append(svc.processing)  # Routing hat begonnen: die Wartephase ist "thinking"
        return "Antwort"

    svc._transcribe = transcribe
    svc.cloudtalk_voice = types.SimpleNamespace(handle=cloudtalk, pending=None)
    for name in ("powerpoint_voice", "calendar_voice", "coding_voice", "content_studio_voice", "skills_onboarding_voice"):
        setattr(svc, name, types.SimpleNamespace(pending=None))
    svc._say_if_current = lambda text, generation: True
    svc.history = []
    monkeypatch.setattr(jv, "log_event", lambda **kwargs: None)
    svc._handle_command(np.ones(jv.SR, dtype=np.float32), None)
    assert seen == ["transcribing", "thinking"]
    assert svc.processing == "thinking"  # _session setzt danach zurueck
