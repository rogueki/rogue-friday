"""Sprecherprofil-Zusammenfassung im Dienststatus (DASH-12.03): echte Messwerte nur bei passender Pruefsumme.

Ausfuehren: python3 -m pytest installer/voice/tests/test_speaker_profile_summary.py
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = os.path.dirname(HERE)
for path in (VOICE, HERE):
    if path not in sys.path:
        sys.path.insert(0, path)

from test_voice_phase import make_service  # noqa: E402

MEASURED = {"sample_count": 42, "quality": 0.61, "calibrated_at": "2026-10-30T08:00:00Z"}


def _service_with_profile(tmp_path, meta=None, matching=True):
    embeddings = tmp_path / "embeddings"
    embeddings.mkdir()
    npy = embeddings / "owner_ecapa.npy"
    npy.write_bytes(b"embedding-bytes")
    if meta is not None:
        digest = hashlib.sha256(b"embedding-bytes" if matching else b"other").hexdigest()
        (embeddings / "owner_profile.json").write_text(json.dumps({"format": 1, "profile_sha256": digest, **meta}), encoding="utf-8")
    svc = make_service()
    svc.cfg.update({"speaker_profile": str(npy), "speaker_threshold": 0.4})
    return svc


def test_no_profile_file_reports_none(tmp_path):
    svc = make_service()
    svc.cfg.update({"speaker_profile": str(tmp_path / "missing.npy"), "speaker_threshold": 0.4})
    assert svc.speaker_profile_summary() is None


def test_matching_metadata_is_reported(tmp_path):
    summary = _service_with_profile(tmp_path, MEASURED).speaker_profile_summary()
    assert summary["sample_count"] == 42 and summary["quality"] == 0.61
    assert summary["calibrated_at"] == "2026-10-30T08:00:00Z" and summary["threshold"] == 0.4
    assert summary["updated_at"].endswith("Z")
    assert set(summary) == {"updated_at", "threshold", "sample_count", "quality", "calibrated_at"}


def test_metadata_of_another_embedding_is_ignored(tmp_path):
    summary = _service_with_profile(tmp_path, MEASURED, matching=False).speaker_profile_summary()
    assert summary["sample_count"] is None and summary["quality"] is None and summary["calibrated_at"] is None


def test_legacy_profile_without_metadata_and_broken_json(tmp_path):
    svc = _service_with_profile(tmp_path)
    assert svc.speaker_profile_summary()["quality"] is None
    (tmp_path / "embeddings" / "owner_profile.json").write_text("{kaputt", encoding="utf-8")
    svc._speaker_profile_cache = None
    assert svc.speaker_profile_summary()["sample_count"] is None


def test_status_payload_carries_the_summary(tmp_path):
    svc = _service_with_profile(tmp_path, {**MEASURED, "sample_count": 3})
    assert svc.status_payload()["speaker_profile"]["sample_count"] == 3
