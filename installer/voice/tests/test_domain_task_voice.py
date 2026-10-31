import base64
import io
import json
import os
import sys
import urllib.error

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import domain_task_voice
from domain_task_voice import DomainTaskVoice, classify_domain, result_text


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FRIDAY_DATA_DIR", str(tmp_path / "data"))


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return io.BytesIO(json.dumps(self.payload).encode("utf-8"))

    def __exit__(self, *exc_info):
        return False


class FakeOpener:
    def __init__(self, payload):
        self.payloads = list(payload) if isinstance(payload, list) else [payload]
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        payload = self.payloads.pop(0) if len(self.payloads) > 1 else self.payloads[0]
        return FakeResponse(payload)


def write_key(root):
    path = domain_task_voice.voice_bridge_key_path(root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="ascii") as target:
        target.write(base64.b64encode(bytes(32)).decode())


def test_classify_domain():
    assert classify_domain("Recherchiere Strompreise") == "research"
    assert classify_domain("Pruefe die Backups") == "audit"
    assert classify_domain("Ueberwache den Speicher") == "alerts"
    assert classify_domain("Plane meinen Umzug") == "tasks"
    assert classify_domain("Überprüfe die Zertifikate") == "audit"
    assert classify_domain("Besuche den Kunden") == "tasks"


def test_result_text():
    assert result_text({"status": "done", "resultSummary": " 21 Cent pro Kilowattstunde "}) == "21 Cent pro Kilowattstunde"
    assert "Dashboard" in result_text({"status": "done", "resultSummary": None})
    assert result_text({"status": "failed", "error": "Zeitueberschreitung"}) == (
        "Die Aufgabe ist fehlgeschlagen: Zeitueberschreitung.")
    assert result_text({"status": "failed", "error": None}) == "Die Aufgabe ist fehlgeschlagen."
    assert result_text({"status": "cancelled"}) == "Die Aufgabe wurde abgebrochen."


def test_create_posts_domain_task(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    opener = FakeOpener({"data": {"taskId": "11111111-1111-4111-8111-111111111111", "domain": "research",
                                   "agentName": "Recherche-Agent", "status": "triage",
                                   "resultSummary": None, "error": None}})
    voice = DomainTaskVoice(str(tmp_path), opener=opener)
    job = voice.create("Recherchiere Strompreise", "research")
    assert job["taskId"] == "11111111-1111-4111-8111-111111111111"
    request = opener.requests[0]
    assert request.full_url.endswith("/api/v1/voice/tasks")
    assert request.get_method() == "POST"
    assert request.get_header("Authorization").startswith("Bearer ")
    assert request.get_header("Idempotency-key").startswith("voice-task-")
    body = json.loads(request.data.decode("utf-8"))
    assert body["domain"] == "research"
    assert body["text"] == "Recherchiere Strompreise"


def test_read_posts_voice_read_and_truncates_text(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    payload = {"kind": "weather.current", "status": "answered", "answer": "Berlin: 14 °C"}
    opener = FakeOpener({"data": payload})
    voice = DomainTaskVoice(str(tmp_path), opener=opener)
    assert voice.read("Wie ist das Wetter?") == payload
    request = opener.requests[0]
    assert request.full_url.endswith("/api/v1/voice/read")
    assert request.get_method() == "POST"
    body = json.loads(request.data.decode("utf-8"))
    assert body == {"text": "Wie ist das Wetter?"}
    voice.read("x" * 600)
    body = json.loads(opener.requests[1].data.decode("utf-8"))
    assert body["text"] == "x" * 500


def test_quiet_mode_requests_use_the_right_methods(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    payload = {"active": True, "source": "temporary", "until": "2026-10-31T15:00:00+01:00",
               "temporaryUntil": "2026-10-31T15:00:00+01:00"}
    opener = FakeOpener([{"data": payload}, {"data": payload}, {"data": payload}])
    voice = DomainTaskVoice(str(tmp_path), opener=opener)
    assert voice.quiet_state() == payload
    assert voice.set_quiet("2026-10-31T15:00:00+01:00") == payload
    assert voice.clear_quiet() == payload
    requests = opener.requests
    assert [request.get_method() for request in requests] == ["GET", "PUT", "DELETE"]
    assert all(request.full_url.endswith("/api/v1/quiet-mode") for request in requests)
    assert requests[0].data is None
    assert json.loads(requests[1].data.decode("utf-8")) == {"until": "2026-10-31T15:00:00+01:00"}
    assert requests[2].data is None


def test_quiet_mode_set_with_level_and_schedule(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    payload = {"active": True, "source": "schedule", "until": None, "level": "voice_off"}
    opener = FakeOpener([{"data": payload}, {"data": payload}])
    voice = DomainTaskVoice(str(tmp_path), opener=opener)
    assert voice.set_quiet("2026-10-31T15:00:00+01:00", "voice_off") == payload
    assert voice.set_quiet_hours(True, "22:30", "06:45") == payload
    requests = opener.requests
    assert [request.get_method() for request in requests] == ["PUT", "PUT"]
    assert requests[0].full_url.endswith("/api/v1/quiet-mode")
    assert json.loads(requests[0].data.decode("utf-8")) == {"until": "2026-10-31T15:00:00+01:00",
                                                            "level": "voice_off"}
    assert requests[1].full_url.endswith("/api/v1/quiet-mode/schedule")
    assert json.loads(requests[1].data.decode("utf-8")) == {"enabled": True, "from": "22:30", "to": "06:45"}


def test_quiet_notice_posts_the_body_without_empty_text(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    payload = {"recorded": True, "delivery": "skipped", "reason": None}
    opener = FakeOpener({"data": payload})
    voice = DomainTaskVoice(str(tmp_path), opener=opener)
    assert voice.quiet_notice("task_results", "Recherchiere Strompreise", "Drei Anbieter gefunden.") == payload
    assert voice.quiet_notice("agent_questions", "Strompreise") == payload
    voice.quiet_notice("task_results", "t" * 300, "y" * 1200)
    requests = opener.requests
    assert all(request.get_method() == "POST" for request in requests)
    assert all(request.full_url.endswith("/api/v1/quiet-mode/notices") for request in requests)
    assert json.loads(requests[0].data.decode("utf-8")) == {"class": "task_results",
                                                            "title": "Recherchiere Strompreise",
                                                            "text": "Drei Anbieter gefunden."}
    assert json.loads(requests[1].data.decode("utf-8")) == {"class": "agent_questions", "title": "Strompreise"}
    truncated = json.loads(requests[2].data.decode("utf-8"))
    assert truncated["title"] == "t" * 200
    assert truncated["text"] == "y" * 1000


def test_wait_returns_final_job(tmp_path):
    steps = [{"status": "running"}, {"status": "running"}, {"status": "done", "resultSummary": "Fertig"}]
    clock = [0.0]

    def now():
        clock[0] += 1.0
        return clock[0]

    voice = DomainTaskVoice(str(tmp_path), now=now, sleep=lambda seconds: None)
    voice.status = lambda task_id: steps.pop(0)
    job = voice.wait("11111111-1111-4111-8111-111111111111", lambda: False)
    assert job["status"] == "done"
    assert job["resultSummary"] == "Fertig"


def test_wait_returns_none_when_cancelled(tmp_path):
    voice = DomainTaskVoice(str(tmp_path), sleep=lambda seconds: None)
    voice.status = lambda task_id: {"status": "running"}
    assert voice.wait("11111111-1111-4111-8111-111111111111", lambda: True) is None


def test_wait_gives_up_after_three_errors(tmp_path):
    voice = DomainTaskVoice(str(tmp_path), sleep=lambda seconds: None)

    def failing(task_id):
        raise OSError("control api down")

    voice.status = failing
    assert voice.wait("11111111-1111-4111-8111-111111111111", lambda: False) is None


TASK = {"taskId": "11111111-1111-4111-8111-111111111111", "domain": "research", "agentName": "Recherche-Agent",
        "status": "running", "resultSummary": None, "error": None}


def fresh_voice(root, **kwargs):
    voice = DomainTaskVoice(str(root), **kwargs)
    for job in voice.pending():
        voice.forget(job["taskId"])
    return voice


def test_jobs_persist_across_instances(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    voice = fresh_voice(tmp_path, opener=FakeOpener({"data": dict(TASK)}), wall=lambda: 1000.0)
    voice.create("Recherchiere Strompreise", "research")
    assert os.path.exists(voice.jobs_path)
    again = DomainTaskVoice(str(tmp_path))
    assert [job["taskId"] for job in again.pending()] == [TASK["taskId"]]
    again.forget(TASK["taskId"])
    assert DomainTaskVoice(str(tmp_path)).pending() == []


def test_status_question_uses_cache_only(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    voice = fresh_voice(tmp_path, opener=FakeOpener({"data": dict(TASK)}), wall=lambda: 1000.0)
    voice.create("Recherchiere Strompreise", "research")
    voice.wall = lambda: 1300.0

    def forbidden(*args, **kwargs):
        raise AssertionError("status question must not use the network")

    voice._request = forbidden
    answer = voice.handle("Wie weit ist die Recherche?")
    assert "Recherche-Agent" in answer
    assert "arbeitet" in answer
    assert "5 Minuten" in answer


def test_named_cancel_stops_only_the_research_task(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    opener = FakeOpener([
        {"data": {**TASK, "taskId": "research-1"}},
        {"data": {**TASK, "taskId": "audit-1", "domain": "audit", "agentName": "Pruef-Agent"}},
    ])
    voice = fresh_voice(tmp_path, opener=opener, wall=lambda: 1000.0)
    voice.create("Recherchiere Strompreise", "research")
    voice.create("Pruefe die Backups", "audit")
    calls = []

    def fake_request(method, path, body=None, key=None, timeout=12):
        calls.append((method, path))
        return {"taskId": "research-1", "status": "cancelled"}

    voice._request = fake_request
    answer = voice.handle("Brich die Recherche ab")
    assert calls == [("POST", "/api/v1/voice/tasks/research-1/cancel")]
    assert "abgebrochen" in answer
    assert "bleiben bestehen" in answer
    assert [job["taskId"] for job in voice.pending()] == ["audit-1"]


def test_named_cancel_asks_when_two_tasks_match(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    opener = FakeOpener([
        {"data": {**TASK, "taskId": "research-1"}},
        {"data": {**TASK, "taskId": "research-2"}},
    ])
    voice = fresh_voice(tmp_path, opener=opener, wall=lambda: 1000.0)
    voice.create("Recherchiere Strompreise", "research")
    voice.create("Recherchiere Wettbewerber", "research")

    def forbidden(*args, **kwargs):
        raise AssertionError("ambiguous cancel must ask first")

    voice._request = forbidden
    answer = voice.handle("Brich die Recherche ab")
    assert answer.startswith("Welchen Auftrag soll ich abbrechen:")
    assert " oder " in answer


def test_failed_cancel_keeps_the_task(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    voice = fresh_voice(tmp_path, opener=FakeOpener({"data": dict(TASK)}), wall=lambda: 1000.0)
    voice.create("Recherchiere Strompreise", "research")

    def failing(method, path, body=None, key=None, timeout=12):
        raise urllib.error.HTTPError(path, 500, "boom", None, None)

    voice._request = failing
    answer = voice.handle("Brich die Recherche ab")
    assert "laeuft weiter" in answer
    assert [job["taskId"] for job in voice.pending()] == [TASK["taskId"]]


def test_handles_text_needs_a_running_task(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    voice = fresh_voice(tmp_path, opener=FakeOpener({"data": dict(TASK)}), wall=lambda: 1000.0)
    assert voice.handles_text("Wie weit ist die Recherche?") is False
    voice.create("Recherchiere Strompreise", "research")
    assert voice.handles_text("Wie weit ist die Recherche?") is True
    assert voice.handles_text("Brich die Recherche ab") is True
    assert voice.handles_text("Wie spaet ist es?") is False


def test_bundle_text_single_and_multiple():
    single = domain_task_voice.bundle_text([{"domain": "research", "status": "done", "resultSummary": "21 Cent."}])
    assert single == "Ergebnis zur Aufgabe: 21 Cent."
    bundled = domain_task_voice.bundle_text([
        {"domain": "research", "status": "done", "resultSummary": "21 Cent."},
        {"domain": "audit", "status": "done", "resultSummary": "Alles gruen."}])
    assert bundled == "2 Ergebnisse. Recherche: 21 Cent. Pruefung: Alles gruen."


def test_take_bundle_returns_collected_jobs(tmp_path):
    voice = DomainTaskVoice(str(tmp_path), sleep=lambda seconds: None)
    voice.collect({"taskId": "a", "domain": "research", "status": "done"})
    voice.collect({"taskId": "b", "domain": "audit", "status": "done"})
    assert [job["taskId"] for job in voice.take_bundle(lambda: False, window_s=1.0)] == ["a", "b"]


def test_take_bundle_returns_empty_when_cancelled(tmp_path):
    voice = DomainTaskVoice(str(tmp_path), sleep=lambda seconds: None)
    assert voice.take_bundle(lambda: True) == []


def test_reply_posts_answer_with_idempotency_key(tmp_path, monkeypatch):
    write_key(str(tmp_path))
    monkeypatch.setattr(domain_task_voice, "dashboard_port", lambda root: 8765)
    task_id = "22222222-2222-4222-8222-222222222222"
    opener = FakeOpener({"data": {**TASK, "taskId": task_id, "status": "running", "question": None}})
    voice = DomainTaskVoice(str(tmp_path), opener=opener)
    job = voice.reply(task_id, "Nur Europa")
    assert job["taskId"] == task_id
    request = opener.requests[0]
    assert request.full_url.endswith(f"/api/v1/voice/tasks/{task_id}/reply")
    assert request.get_method() == "POST"
    assert request.get_header("Idempotency-key").startswith("voice-reply-")
    assert json.loads(request.data.decode("utf-8")) == {"answer": "Nur Europa"}


def test_wait_reports_a_new_question_once(tmp_path):
    steps = [
        {"status": "waiting", "question": "Welche Region?"},
        {"status": "waiting", "question": "Welche Region?"},
        {"status": "done", "resultSummary": "Fertig"},
    ]
    clock = [0.0]

    def now():
        clock[0] += 1.0
        return clock[0]

    voice = DomainTaskVoice(str(tmp_path), now=now, sleep=lambda seconds: None)
    voice.status = lambda task_id: steps.pop(0)
    task_id = "11111111-1111-4111-8111-111111111111"
    voice.jobs[task_id] = {"taskId": task_id, "domain": "research", "title": "Strompreise", "status": "running"}
    first = voice.wait(task_id, lambda: False)
    assert first["question"] == "Welche Region?"
    second = voice.wait(task_id, lambda: False)
    assert second["status"] == "done"
    assert second["resultSummary"] == "Fertig"


def test_result_text_announces_the_question():
    assert result_text({"status": "waiting", "question": "Welche Region?"}) == "Rueckfrage: Welche Region?"
