"""Latenzfenster des Sprachdienstes (DASH-16.05): p95 nach Nearest-Rank, Antwortbeginn bis zum ersten Audio."""
import collections
import os
import sys
import threading
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = os.path.dirname(HERE)
for path in (VOICE, HERE):
    if path not in sys.path:
        sys.path.insert(0, path)

import test_personal_wake as helpers  # noqa: E402

jv = helpers.load_voice_module()


def test_summary_without_samples_reports_no_data():
    assert jv.latency_summary([]) == {"current_ms": None, "avg_ms": None, "p95_ms": None, "count": 0}


def test_summary_uses_nearest_rank_and_keeps_the_latest_value_current():
    summary = jv.latency_summary(range(1, 101))
    assert summary == {"current_ms": 100, "avg_ms": 50, "p95_ms": 95, "count": 100}
    assert jv.latency_summary([1800.4])["p95_ms"] == 1800
    assert jv.latency_summary([10, 20, 3000])["p95_ms"] == 3000


def bare_speaker():
    speaker = object.__new__(jv.Speaker)
    speaker.echo_reference = collections.deque()
    speaker.echo_lock = threading.Lock()
    speaker.answer_clock = None
    speaker.answer_start_ms = collections.deque(maxlen=jv.LATENCY_WINDOW)
    return speaker


def test_first_output_stops_the_answer_clock_once():
    speaker = bare_speaker()
    speaker.answer_clock = time.monotonic() - 0.5
    speaker._note_output(np.zeros(1600, dtype=np.float32), jv.SR)
    speaker._note_output(np.zeros(1600, dtype=np.float32), jv.SR)
    assert len(speaker.answer_start_ms) == 1
    assert 400 <= speaker.answer_start_ms[0] <= 5000
    assert speaker.answer_clock is None


def test_stale_answer_clock_is_dropped():
    speaker = bare_speaker()
    speaker.answer_clock = time.monotonic() - jv.ANSWER_START_MAX_S - 5
    speaker._note_output(np.zeros(1600, dtype=np.float32), jv.SR)
    assert len(speaker.answer_start_ms) == 0


def test_payload_reports_each_window_and_tolerates_a_bare_service():
    svc = object.__new__(jv.VoiceService)
    assert jv.VoiceService.latency_payload(svc)["stt"]["count"] == 0
    svc.latency = {name: collections.deque(maxlen=jv.LATENCY_WINDOW) for name in ("speaker", "stt", "router", "model")}
    svc.tts = bare_speaker()
    for value in (300, 500, 700):
        jv.record_latency(svc, "stt", value)
    svc.tts.answer_start_ms.extend([900, 1200])
    payload = jv.VoiceService.latency_payload(svc)
    assert set(payload) == {"speaker", "stt", "router", "model", "answer_start"}
    assert payload["stt"] == {"current_ms": 700, "avg_ms": 500, "p95_ms": 700, "count": 3}
    assert payload["answer_start"]["count"] == 2
    assert payload["model"]["count"] == 0
