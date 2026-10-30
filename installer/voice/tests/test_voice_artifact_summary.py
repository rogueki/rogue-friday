"""Wake-Kalibrierung und Ausgabestimme als eigene Artefakte im Dienststatus (DASH-12.02): nur Metadaten.

Ausfuehren: python3 -m pytest installer/voice/tests/test_voice_artifact_summary.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = os.path.dirname(HERE)
for path in (VOICE, HERE):
    if path not in sys.path:
        sys.path.insert(0, path)

from test_voice_phase import make_service  # noqa: E402
import test_personal_wake as helpers  # noqa: E402

META = {"wake_phrase": "Hey Friday", "engine": "personal", "threshold": 2.4, "quality": "gut",
        "calibration": {"frr_cv": 0.05, "threshold": 2.4}, "clips": {"hey": 12, "bare": 8, "negatives": 20, "speech": 6},
        "created": "2026-10-30T09:00:00"}


def test_personal_wake_reports_calibration_without_model_data(tmp_path):
    meta_path = tmp_path / "personal_wake.json"
    meta_path.write_text(json.dumps(META), encoding="utf-8")
    svc = make_service()
    svc.engine, svc.wake_threshold = "personal", 2.4
    svc.cfg["personal_wake_meta"] = str(meta_path)
    summary = svc.wake_calibration_summary()
    assert summary["engine"] == "personal"
    assert summary["threshold"] == 2.4
    assert summary["quality"] == "good"
    assert summary["hit_rate"] == 0.95
    assert summary["own_clips"] == 20
    assert summary["calibrated_at"].endswith("Z")
    assert set(summary) == {"engine", "threshold", "quality", "hit_rate", "own_clips", "calibrated_at"}


def test_personal_wake_with_broken_meta_keeps_engine_and_threshold(tmp_path):
    meta_path = tmp_path / "personal_wake.json"
    meta_path.write_text("{kaputt", encoding="utf-8")
    svc = make_service()
    svc.engine, svc.wake_threshold = "personal", 1.7
    svc.cfg["personal_wake_meta"] = str(meta_path)
    summary = svc.wake_calibration_summary()
    assert summary["threshold"] == 1.7
    assert summary["quality"] is None and summary["hit_rate"] is None and summary["own_clips"] is None


def test_builtin_wake_model_has_no_personal_calibration():
    svc = make_service()
    svc.engine, svc.wake_threshold = "openwakeword", 0.5
    summary = svc.wake_calibration_summary()
    assert summary == {"engine": "openwakeword", "threshold": 0.5, "quality": None, "hit_rate": None,
                       "own_clips": None, "calibrated_at": None}


def test_output_voice_names_clone_and_available_slots_without_paths(tmp_path, monkeypatch):
    jv = helpers.load_voice_module()
    references = tmp_path / "config" / "voice-references"
    references.mkdir(parents=True)
    (references / "friday-female-reference.wav").write_bytes(b"F")
    (references / "custom-reference.mp3").write_bytes(b"O")
    streaming = references / "friday-female-streaming.wav"
    streaming.write_bytes(b"S")
    monkeypatch.setattr(jv, "INSTALL_ROOT", str(tmp_path))
    svc = make_service()
    svc.cfg.update({"tts_voice_choice": "friday-female", "voice_mode": "local", "tts_backend": "streaming_qwen",
                    "tts_reference": str(streaming)})
    summary = jv.VoiceService.output_voice_summary(svc)
    assert summary["choice"] == "friday-female"
    assert summary["kind"] == "clone"
    assert summary["available"] == ["friday-female", "custom"]
    assert summary["reference_updated_at"].endswith("Z")
    assert str(tmp_path) not in json.dumps(summary)


def test_output_voice_without_clone_is_a_preset(tmp_path, monkeypatch):
    jv = helpers.load_voice_module()
    monkeypatch.setattr(jv, "INSTALL_ROOT", str(tmp_path))
    svc = make_service()
    svc.cfg.update({"tts_voice_choice": "classic", "voice_mode": "local", "tts_backend": "piper"})
    summary = jv.VoiceService.output_voice_summary(svc)
    assert summary == {"choice": "classic", "kind": "preset", "available": [], "reference_updated_at": None}
