import base64
import io
import json
import os
import sys

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
        self.payload = payload
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        return FakeResponse(self.payload)


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
