import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from coding_voice import CodingVoice


COMMAND = "Starte Codex im Projekt Mein Projekt mit dem Auftrag, korrigiere den Fehler in der Anmeldung"
RUN = "run_" + "a" * 32


def test_requires_exact_alias_and_explicit_confirmation(tmp_path):
    voice = CodingVoice(str(tmp_path))
    calls = []

    def request(method, path, body=None, request_key=None):
        calls.append((method, path, body, request_key))
        if method == "GET":
            return {"alias": "Mein Projekt", "repository": "C:\\repo", "revision": 3}
        return {"runId": RUN, "status": "queued"}

    voice._request = request
    assert "Bitte nenne" in voice.handle(COMMAND.replace("Mein Projekt", "Anderes Projekt"))
    assert len(calls) == 1 and calls[0][0] == "GET"
    preview = voice.handle(COMMAND)
    assert "codex" in preview and "Anmeldung" in preview
    assert "Anbieterkosten" in preview
    assert len(calls) == 2 and calls[1][0] == "GET"
    voice.arm_confirmation()
    assert RUN in voice.handle("ja")
    assert calls[2][0:2] == ("POST", "voice")
    assert calls[2][2] == {"alias": "Mein Projekt", "revision": 3, "cli": "codex", "task": "korrigiere den Fehler in der Anmeldung"}
    assert calls[2][3].startswith("idem_voice_")
    assert voice.handle("ja") is None
    assert len(calls) == 3


def test_cancel_expiry_and_unclear_outcome_reuse_one_key(tmp_path):
    clock = [0.0]
    voice = CodingVoice(str(tmp_path), now=lambda: clock[0])
    calls = []

    def request(method, path, body=None, request_key=None):
        calls.append((method, request_key))
        if method == "GET":
            return {"alias": "Mein Projekt", "revision": 1}
        if len([call for call in calls if call[0] == "POST"]) == 1:
            raise TimeoutError("lost response")
        return {"runId": RUN}

    voice._request = request
    voice.handle(COMMAND)
    voice.arm_confirmation()
    assert "unklar" in voice.handle("ja")
    assert RUN in voice.handle("ja")
    posts = [call for call in calls if call[0] == "POST"]
    assert len(posts) == 2 and posts[0][1] == posts[1][1]
    voice.handle(COMMAND)
    voice.arm_confirmation()
    assert "verworfen" in voice.handle("nein")
    assert len([call for call in calls if call[0] == "POST"]) == 2
    voice.handle(COMMAND)
    clock[0] = 20.0  # Playback and synthesis can consume time before the answer window starts.
    voice.arm_confirmation()
    clock[0] = 111.0
    assert "abgelaufen" in voice.handle("ja")
    assert len([call for call in calls if call[0] == "POST"]) == 2


def test_coding_intent_fails_closed_without_setup_or_task(tmp_path):
    voice = CodingVoice(str(tmp_path))
    calls = []
    voice._request = lambda *args, **kwargs: calls.append(args) or {"alias": "", "revision": 0}
    assert "Bitte nenne" in voice.handle("Starte Codex im Projekt Mein Projekt")
    assert "Richte zuerst" in voice.handle(COMMAND)
    assert not [call for call in calls if call[0] == "POST"]


def test_confirmation_before_readback_finishes_cannot_start(tmp_path):
    voice = CodingVoice(str(tmp_path))
    calls = []
    voice._request = lambda method, path, body=None, request_key=None: calls.append(method) or {"alias": "Mein Projekt", "revision": 1}
    voice.handle(COMMAND)
    assert "unterbrochen" in voice.handle("ja")
    assert calls == ["GET"]
