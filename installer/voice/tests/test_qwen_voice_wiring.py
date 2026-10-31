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
    assert svc.tts.said == [jv.QWEN_FALLBACK_NOTICE["quota"]]
    assert svc.history == []


def test_fallback_notice_is_spoken_once_per_kind(monkeypatch):
    jv = voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **fields: None)
    svc = make_service(jv)
    calls = {"count": 0}

    class Dialog:
        def turn(self, pcm, say, cancelled):
            calls["count"] += 1
            if calls["count"] in (1, 2, 5):
                raise jv.qwen_realtime.RealtimeError("network", "x")
            if calls["count"] == 3:
                raise jv.qwen_realtime.RealtimeError("auth", "y")
            say("Wieder da.")
            return "Wieder da."

    svc.qwen_dialog = Dialog()
    audio = np.zeros(800, dtype=np.float32)
    assert svc._qwen_turn(audio, svc.control_generation) is False
    assert svc._qwen_turn(audio, svc.control_generation) is False
    assert svc._qwen_turn(audio, svc.control_generation) is False
    assert svc.tts.said == [jv.QWEN_UNREACHABLE_NOTICE, jv.QWEN_FALLBACK_NOTICE["auth"]]
    assert svc._qwen_turn(audio, svc.control_generation) is True
    assert svc.status["qwen_error"] is None
    assert svc._qwen_turn(audio, svc.control_generation) is False
    assert svc.tts.said.count(jv.QWEN_UNREACHABLE_NOTICE) == 2


def test_handle_command_uses_qwen_for_verified_owner(monkeypatch):
    jv = voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **fields: None)
    svc = make_service(jv)
    svc.qwen_dialog = types.SimpleNamespace()
    svc._qwen_turn = lambda audio, generation: True

    def transcribe(audio):
        raise AssertionError("Whisper darf im Qwen-Modus nicht laufen")

    svc._transcribe = transcribe
    svc._handle_command(np.zeros(32000, dtype=np.float32), None)


def test_short_stop_word_cancels_instead_of_reaching_qwen(monkeypatch):
    jv = voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **fields: None)
    svc = make_service(jv)
    svc.qwen_dialog = types.SimpleNamespace()
    cancelled = []
    svc.cancel_active_interaction = lambda: cancelled.append(True)

    def qwen_turn(audio, generation):
        raise AssertionError("Stoppwort darf nicht an Qwen gehen")

    svc._qwen_turn = qwen_turn
    svc._transcribe = lambda audio: "Stopp."
    svc._handle_command(np.zeros(16000, dtype=np.float32), None)
    assert cancelled == [True]

    reached = []
    svc._qwen_turn = lambda audio, generation: reached.append(True) or True
    svc._transcribe = lambda audio: "Wie spaet ist es"
    svc._handle_command(np.zeros(16000, dtype=np.float32), None)
    assert reached == [True] and cancelled == [True]


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


def test_switch_hands_unspoken_results_to_the_new_mode():
    jv = voice_module()
    svc = make_service(jv)
    collected = []
    svc.domain_tasks = types.SimpleNamespace(collect=collected.append)
    job = {"taskId": "task_x", "domain": "research", "status": "done", "title": "Strompreise"}
    svc.conversation = types.SimpleNamespace(drain_announcements=lambda: [job])
    closed = threading.Event()
    svc.qwen_dialog = types.SimpleNamespace(close=closed.set)
    svc._use_conversation(None)
    assert svc.conversation is None and svc.qwen_dialog is None
    assert collected == [job]
    assert closed.wait(2)


def test_announced_question_keeps_the_task_registered():
    jv = voice_module()
    svc = make_service(jv)
    forgotten = []
    svc.domain_tasks = types.SimpleNamespace(forget=forgotten.append)
    svc._forget_announced([{"taskId": "task_done", "status": "done"},
                           {"taskId": "task_wait", "status": "waiting", "question": "Welche Region?"}])
    assert forgotten == ["task_done"]


class _QuietTasks:
    def __init__(self, state):
        self.state = state
        self.notices = []

    def quiet_state(self):
        return dict(self.state)

    def quiet_notice(self, klass, title, text=""):
        self.notices.append((klass, title))
        return {"recorded": True, "delivery": "skipped", "reason": None}

    def pending(self):
        return []

    def forget(self, task_id):
        pass

    def set_quiet(self, until, level=None):
        self.notices.append(("set", until, level))
        return {"active": True, "until": until, "level": level or "silent"}


def _classic_quiet_service(jv, state):
    svc = make_service(jv)
    svc.domain_tasks = _QuietTasks(state)
    svc.quiet_gate = jv.QuietGate(svc.domain_tasks.quiet_state)
    svc.announcer = jv.ConversationOrchestrator(svc.domain_tasks, quiet_gate=svc.quiet_gate)
    return svc


def test_classic_flow_holds_results_while_quiet_and_reports_them():
    jv = voice_module()
    svc = _classic_quiet_service(jv, {"active": True, "source": "temporary", "level": "silent"})
    jobs = [{"taskId": "task_x", "domain": "research", "status": "done",
             "resultSummary": "Drei Anbieter gefunden.", "title": "Strompreise"}]
    assert svc._announcement_text(jobs) is None
    assert svc._has_held_announcements()
    assert svc.domain_tasks.notices == [("task_results", "Strompreise")]
    svc.domain_tasks.state = {"active": False}
    svc.quiet_gate.invalidate()
    text = svc.announcer.take_announcement()
    assert "Drei Anbieter gefunden." in text


def test_local_router_answers_quiet_orders_before_the_model():
    jv = voice_module()
    svc = _classic_quiet_service(jv, {"active": False})
    decision = svc._route("Ruhemodus für zwei Stunden, nur Stimme aus")
    assert decision["route"] == "local" and decision["intent"] == "local_command"
    assert decision["answer"].startswith("Ruhemodus bis ")
    assert svc.domain_tasks.notices[-1][0] == "set" and svc.domain_tasks.notices[-1][2] == "voice_off"


def test_local_router_leaves_other_questions_to_the_model():
    jv = voice_module()
    svc = _classic_quiet_service(jv, {"active": False})
    assert svc._local_command("Wie wird das Wetter morgen?") is None
    assert svc._local_command("Sei still") is None


def test_classic_flow_without_quiet_speaks_the_bundle():
    jv = voice_module()
    svc = _classic_quiet_service(jv, {"active": False})
    jobs = [{"taskId": "task_x", "domain": "research", "status": "done",
             "resultSummary": "Drei Anbieter gefunden.", "title": "Strompreise"}]
    assert svc._announcement_text(jobs) == jv.bundle_text(jobs)


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
