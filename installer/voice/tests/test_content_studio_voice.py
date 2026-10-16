import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from content_studio_voice import ContentStudioVoice


def test_spoken_confirmation_starts_exactly_one_paid_job(tmp_path):
    studio = ContentStudioVoice(str(tmp_path))
    calls = []
    idea = {"id": "story-1", "titel": "Herbstaktion", "format": "Story"}

    def request(method, path, body=None, request_key=None):
        calls.append((method, path, body, request_key))
        if path == "plan":
            return {"revision": 3, "plan": {"content": [idea]}}, None
        if path == "production-jobs":
            return {"id": "job-1", "state": "queued"}, None
        return {"state": "completed"}, None

    studio._safe_request = request
    preview = studio.handle("Friday, erstelle eine Story für Herbstaktion")
    assert "Kosten" in preview
    assert [call[1] for call in calls] == ["plan"]
    assert studio.handle("ja") == "Der Produktionsauftrag ist gestartet. Ich übernehme Medien, Stimme und Schnitt. Frage mich nach dem Produktionsstatus."
    assert calls[1][1:3] == ("production-jobs", {"ideaId": "story-1", "planRevision": 3, "confirmed": True})
    assert calls[1][3].startswith("idem_voice_")
    assert "fertig" in studio.handle("Wie ist der Produktionsstatus?")


def test_pending_voice_job_can_be_cancelled_without_provider_request(tmp_path):
    studio = ContentStudioVoice(str(tmp_path))
    calls = []
    studio._safe_request = lambda method, path, body=None, request_key=None: (calls.append((method, path)) or {"revision": 1, "plan": {"content": [{"id": "one", "titel": "Frühling", "format": "Reel"}]}}, None)
    assert "Kosten" in studio.handle("Produziere ein Reel")
    assert "verworfen" in studio.handle("abbrechen")
    assert calls == [("GET", "plan")]
    assert studio.handle("ja") is None


def test_multiple_ideas_require_a_spoken_title(tmp_path):
    studio = ContentStudioVoice(str(tmp_path))
    ideas = [{"id": "one", "titel": "Sommerstart", "format": "Story"}, {"id": "two", "titel": "Winterstart", "format": "Story"}]
    studio._safe_request = lambda method, path, body=None, request_key=None: ({"revision": 2, "plan": {"content": ideas}}, None)
    assert "Welche Content-Idee" in studio.handle("Erstelle eine Story")
    assert "Winterstart" in studio.handle("Nimm Winterstart")
    assert studio.pending["idea_id"] == "two"


def test_upload_request_is_not_mistaken_for_production(tmp_path):
    studio = ContentStudioVoice(str(tmp_path))
    assert "noch nicht eingerichtet" in studio.handle("Uploade eine neue Story auf Instagram")
    assert studio.pending is None


def test_repeated_voice_preview_reuses_one_idempotency_key(tmp_path):
    first = ContentStudioVoice(str(tmp_path))
    second = ContentStudioVoice(str(tmp_path))
    idea = {"id": "same-story", "titel": "Aktion", "format": "Story"}
    first._preview(idea, 5)
    second._preview(idea, 5)
    assert first.pending["request_key"] == second.pending["request_key"]
    second._preview(idea, 6)
    assert first.pending["request_key"] != second.pending["request_key"]
