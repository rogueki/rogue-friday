"""Tests fuer den Gespraechsmodus 'qwen' im Sprachdienst (LG-1.03b): Auswahl, Rueckfall und Ergebnisansage."""

import collections
import importlib.util
import sys
import threading
import types
from pathlib import Path

import numpy as np
import pytest

VOICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(VOICE))

_module = None


def voice_module():
    """friday_voice ueber die isolierten Abhaengigkeits-Stubs der bestehenden Sprachtests laden."""
    global _module
    if _module is None:
        source = VOICE / "tests" / "test_personal_wake.py"
        spec = importlib.util.spec_from_file_location("isolated_voice_test_helpers", source)
        helpers = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helpers)
        _module = helpers.load_voice_module()
    return _module


class Reached(Exception):
    """Marker: der lokale Weg wurde trotz Qwen-Modus erreicht."""


def make_service(jv):
    svc = jv.VoiceService.__new__(jv.VoiceService)
    svc.cfg = {"speaker_verification_required": True, "speaker_threshold": 0.5, "trusted_session_s": 60}
    svc.status = {"rejected_speaker": 0, "commands": 0}
    svc.control_cancel = threading.Event()
    svc.control_generation = 0
    svc.manual_start_lock = threading.Lock()
    svc.memory_dialog_id = None
    svc.history = []
    svc.processing = None
    svc.latency = {name: collections.deque() for name in ("speaker", "stt", "router", "model")}
    svc.tts = types.SimpleNamespace(said=[], answer_clock=None)
    svc.tts.say = svc.tts.said.append
    svc.verifier = types.SimpleNamespace(score=lambda audio: 0.9)
    svc.transcribe_lock = threading.Lock()
    svc.background_jobs = set()
    svc.conversation = None
    svc.qwen_dialog = None
    return svc


def test_conversation_backend_defaults_to_local():
    jv = voice_module()
    assert jv.conversation_backend({}) == "local"
    assert jv.conversation_backend({"conversation_backend": "qwen"}) == "qwen"
    with pytest.raises(SystemExit):
        jv.conversation_backend({"conversation_backend": "cloud"})


def test_watched_tasks_watch_every_new_job():
    jv = voice_module()
    created = []
    watched_jobs = []

    class Tasks:
        def create(self, text, domain):
            job = {"taskId": "task_1", "text": text, "domain": domain}
            created.append(job)
            return job

        def pending(self):
            return list(created)

    watched = jv.WatchedTasks(Tasks(), watched_jobs.append)
    job = watched.create("Recherchiere Strompreise", "research")
    assert job["taskId"] == "task_1"
    assert created == [job]
    assert watched_jobs == [job]
    assert watched.pending() == [job]


def test_qwen_turn_speaks_and_records_history(monkeypatch):
    jv = voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **fields: None)
    svc = make_service(jv)
    audio = np.zeros(1600, dtype=np.float32)
    seen = {}

    class Dialog:
        def turn(self, pcm, say, cancelled):
            seen["pcm"] = pcm
            say("Guten Tag.")
            say("Erledigt.")
            return "Guten Tag. Erledigt."

    svc.qwen_dialog = Dialog()
    assert svc._qwen_turn(audio, svc.control_generation) is True
    assert len(seen["pcm"]) == 2 * len(audio)
    assert np.frombuffer(seen["pcm"], dtype="<i2").size == len(audio)
    assert svc.tts.said == ["Guten Tag.", "Erledigt."]
    assert svc.history[-1] == {"role": "assistant", "content": "Guten Tag. Erledigt."}
    assert svc.status["commands"] == 1
    assert svc.status["qwen_error"] is None


def test_qwen_turn_reports_realtime_error(monkeypatch):
    jv = voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **fields: None)
    svc = make_service(jv)

    class Dialog:
        def turn(self, pcm, say, cancelled):
            raise jv.qwen_realtime.RealtimeError("quota", "leer")

    svc.qwen_dialog = Dialog()
    assert svc._qwen_turn(np.zeros(800, dtype=np.float32), svc.control_generation) is False
    assert svc.status["qwen_error"] == "quota"
    assert svc.history == []


def test_handle_command_uses_qwen_for_verified_owner(monkeypatch):
    jv = voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **fields: None)
    svc = make_service(jv)
    svc.qwen_dialog = types.SimpleNamespace()
    svc._qwen_turn = lambda audio, generation: True

    def transcribe(audio):
        raise AssertionError("Whisper darf im Qwen-Modus nicht laufen")

    svc._transcribe = transcribe
    svc._handle_command(np.zeros(16000, dtype=np.float32), None)


def test_handle_command_falls_back_to_local_way(monkeypatch):
    jv = voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **fields: None)
    svc = make_service(jv)
    svc.qwen_dialog = types.SimpleNamespace()
    svc._qwen_turn = lambda audio, generation: False

    def transcribe(audio):
        raise Reached()

    svc._transcribe = transcribe
    with pytest.raises(Reached):
        svc._handle_command(np.zeros(16000, dtype=np.float32), None)


def test_guest_audio_never_reaches_qwen(monkeypatch):
    jv = voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **fields: None)
    svc = make_service(jv)
    svc.cfg["speaker_verification_required"] = False
    svc.qwen_dialog = types.SimpleNamespace()

    def qwen_turn(audio, generation):
        raise AssertionError("unbestaetigtes Audio darf nicht an Qwen gehen")

    def transcribe(audio):
        raise Reached()

    svc._qwen_turn = qwen_turn
    svc._transcribe = transcribe
    with pytest.raises(Reached):
        svc._handle_command(np.zeros(16000, dtype=np.float32), None)


def test_announcement_text_without_conversation_uses_bundle():
    jv = voice_module()
    svc = make_service(jv)
    jobs = [{"taskId": "task_x", "domain": "research", "status": "done",
             "resultSummary": "Drei Anbieter gefunden.", "title": "Strompreise"}]
    assert svc._announcement_text(jobs) == jv.bundle_text(jobs)


def test_announcement_text_with_conversation_uses_orchestrator():
    jv = voice_module()
    svc = make_service(jv)
    forgotten = []

    class Tasks:
        def pending(self):
            return []

        def forget(self, task_id):
            forgotten.append(task_id)

    svc.conversation = jv.ConversationOrchestrator(Tasks())
    job = {"taskId": "task_x", "domain": "research", "status": "done",
           "resultSummary": "Drei Anbieter gefunden.", "title": "Strompreise"}
    text = svc._announcement_text([job])
    assert "Drei Anbieter gefunden." in text
    assert "Recherche" in text


def test_watch_domain_task_starts_background_watcher():
    jv = voice_module()
    svc = make_service(jv)
    seen = {}
    done = threading.Event()

    def background(task_id, watcher, generation):
        seen.update(task_id=task_id, watcher=watcher, generation=generation)
        done.set()

    svc._background_domain = background
    svc._watch_domain_task({"taskId": "task_y"})
    assert done.wait(5)
    assert seen["task_id"] == "task_y"
    assert svc.background_jobs == {seen["watcher"]}
