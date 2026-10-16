import copy
import ast
import base64
import io
import json
import os
import re
import sys
import time
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from skills_onboarding_voice import SkillsOnboardingVoice


class FakeApi:
    def __init__(self):
        self.state = {"revision": 0, "steps": {step: "pending" for step in ("intro", "profile", "skills", "accounts", "finish")},
                      "goals": [], "selectedSkillIds": [], "completedAt": None, "updatedAt": None}
        self.skills = [{"id": "friday:calendar", "name": "Kalender", "enabled": True},
                       {"id": "friday:research", "name": "Recherche", "enabled": None},
                       {"id": "friday:mail", "name": "E-Mail", "enabled": False}]
        self.calls = []
        self.conflict = False

    def request(self, method, path, body=None, revision=None, timeout=12):
        self.calls.append((method, path, copy.deepcopy(body), revision))
        if path == "skills":
            return {"data": copy.deepcopy(self.skills)}, None
        if method == "GET":
            return copy.deepcopy(self.state), None
        if self.conflict:
            return None, "conflict"
        assert revision == self.state["revision"]
        self.state.update(copy.deepcopy(body))
        self.state["revision"] += 1
        return copy.deepcopy(self.state), None


def handler(tmp_path, api, clock=None):
    voice = SkillsOnboardingVoice(str(tmp_path), now=clock or (lambda: 0))
    voice._safe_request = api.request
    return voice


def test_resume_and_confirmed_preferences(tmp_path):
    api = FakeApi()
    voice = handler(tmp_path, api)
    assert "beginnen" in voice.handle("Einrichtung starten")
    assert "nennen" in voice.handle("ja")
    assert "Alex" in voice.handle("Alex")
    assert api.state.get("preferredName") is None
    assert "erreichen" in voice.handle("ja")
    assert api.state["preferredName"] == "Alex"
    assert "speichern" in voice.handle("Meine Termine planen")
    assert "Skills" in voice.handle("ja")
    assert api.state["goals"] == ["Meine Termine planen"]
    assert "aktiviert den Skill nicht" in voice.handle("Kalender")
    assert api.state["selectedSkillIds"] == []
    assert "Konten" in voice.handle("ja")
    assert api.state["selectedSkillIds"] == ["friday:calendar"]
    assert api.skills[0]["enabled"] is True
    restarted = handler(tmp_path, api)
    assert "Konten" in restarted.handle("Einrichtung fortsetzen")
    assert "abschließen" in restarted.handle("überspringen")
    assert api.state["steps"]["accounts"] == "skipped"
    assert "abgeschlossen" in restarted.handle("ja")
    assert all(value != "pending" for value in api.state["steps"].values())


def test_status_preserves_unknown_and_does_not_read_onboarding(tmp_path):
    api = FakeApi()
    voice = handler(tmp_path, api)
    answer = voice.handle("Welche Skills sind aktiv?")
    assert "Kalender" in answer and "Recherche" in answer
    assert "unbekannt" in answer
    assert "E-Mail" in answer and "Deaktiviert" in answer
    assert api.calls == [("GET", "skills", None, None)]
    assert "Kalender" in voice.handle("Was kannst du?")


def test_conflict_rereads_without_overwrite(tmp_path):
    api = FakeApi()
    voice = handler(tmp_path, api)
    voice.handle("Einrichtung starten")
    api.conflict = True
    assert "geändert" in voice.handle("ja")
    assert api.state["revision"] == 0
    assert [call[:2] for call in api.calls][-2:] == [("PUT", "onboarding"), ("GET", "onboarding")]
    assert voice.handle("ja") is None


def test_external_edit_during_question_requires_resume(tmp_path):
    api = FakeApi()
    voice = handler(tmp_path, api)
    voice.handle("Einrichtung starten")
    api.state["revision"] = 1
    assert "geändert" in voice.handle("ja")
    assert not any(call[0] == "PUT" for call in api.calls)


def test_pending_expires_and_unmatched_falls_through(tmp_path):
    api = FakeApi()
    current = [0]
    voice = handler(tmp_path, api, lambda: current[0])
    assert voice.handle("Wie spät ist es?") is None
    voice.handle("Einrichtung starten")
    current[0] = 16
    assert voice.handle("ja") is None
    assert api.state["revision"] == 0


def test_first_use_invitation_is_persisted_and_resumable(tmp_path):
    api = FakeApi()
    api.state["preferredName"] = "Alex"
    api.state["goals"] = ["Termine planen", "E-Mails sortieren"]
    voice = handler(tmp_path, api)
    invitation = voice.offer_first_use()
    assert "Willkommen, Alex" in invitation
    assert "Termine planen; E-Mails sortieren" in invitation
    assert "Friday- und Hermes-Skills" in invitation and "Sage ja oder nein" in invitation
    assert voice.offer_first_use() is None
    restarted = handler(tmp_path, api)
    assert restarted.offer_first_use() is None

    assert "erreichen" in voice.handle("ja")
    assert api.state["steps"]["intro"] == "completed"
    assert api.state["steps"]["profile"] == "pending"


def test_first_use_invite_has_long_window_but_regular_steps_stay_short(tmp_path):
    api = FakeApi()
    current = [0]
    voice = handler(tmp_path, api, lambda: current[0])
    assert voice.offer_first_use()
    assert voice.pending["expires"] == 90

    current[0] = 89
    assert "nennen" in voice.handle("ja")
    assert voice.pending["expires"] == 104


def test_completed_intro_does_not_write_offer_marker(tmp_path):
    api = FakeApi()
    api.state["steps"]["intro"] = "completed"
    voice = handler(tmp_path, api)
    assert voice.offer_first_use() is None
    assert not (tmp_path / "dashboard" / "data" / "voice-bridge" / "onboarding-offer.json").exists()


def test_first_use_invitation_decline_and_unrelated_command_are_bounded(tmp_path):
    (tmp_path / "dashboard" / "data" / "voice-bridge").mkdir(parents=True)
    api = FakeApi()
    voice = handler(tmp_path, api)
    assert voice.offer_first_use()
    assert "jederzeit" in voice.handle("nein")
    assert api.state["steps"]["intro"] == "pending"
    assert voice.handle("Wie spät ist es?") is None
    assert voice.offer_first_use() is None

    second = handler(tmp_path, FakeApi())
    assert second.offer_first_use() is None


def test_dispatcher_keeps_speaker_gate_and_hermes_fallback(tmp_path):
    # Load only the method: the full service imports GPU/audio packages absent in unit tests.
    source = os.path.join(os.path.dirname(os.path.dirname(__file__)), "friday_voice.py")
    service = next(node for node in ast.parse(open(source, encoding="utf-8").read()).body
                   if isinstance(node, ast.ClassDef) and node.name == "VoiceService")
    method = next(node for node in service.body if isinstance(node, ast.FunctionDef) and node.name == "_handle_command")
    method.returns = None
    for arg in method.args.args:
        arg.annotation = None
    namespace = {"time": time, "SR": 16000, "log_event": lambda **kwargs: None,
                 "STOP_WORDS": re.compile("^stopp$"), "uuid": __import__("uuid"),
                 "DEFAULT_ACK_WAIT": "warte", "DEFAULT_ACK_BACKGROUND": "warte"}
    exec(compile(ast.Module(body=[method], type_ignores=[]), source, "exec"), namespace)
    calls = []
    offers = []
    voice = types.SimpleNamespace(
        cfg={"speaker_threshold": 0.4, "trusted_session_s": 15},
        verifier=types.SimpleNamespace(score=lambda audio: 0.2),
        status={"rejected_speaker": 0, "commands": 0}, trusted_until=0,
        _transcribe=lambda audio: "Welche Skills sind aktiv?",
        content_studio_voice=types.SimpleNamespace(handle=lambda text: calls.append("studio") or None),
        skills_onboarding_voice=types.SimpleNamespace(
            handle=lambda text: calls.append("skills") or "Kalender ist aktiv.",
            offer_first_use=lambda: offers.append("offer") or "",
        ),
        tts=types.SimpleNamespace(say=lambda answer: calls.append(answer)), history=[],
    )
    namespace["_handle_command"](voice, [0] * 16000, None)
    assert calls == [] and offers == [] and voice.status["rejected_speaker"] == 1
    voice.verifier.score = lambda audio: 0.7
    namespace["_handle_command"](voice, [0] * 16000, None)
    assert calls == ["studio", "skills", "Kalender ist aktiv."]
    assert offers == ["offer"]
    calls.clear()
    voice.skills_onboarding_voice.handle = lambda text: calls.append("skills") or None
    voice._transcribe = lambda audio: "Wie spät ist es?"
    voice._route = lambda text: calls.append("route") or {"route": "local", "answer": "Es ist zwölf Uhr."}
    namespace["_handle_command"](voice, [0] * 16000, None)
    assert calls[:3] == ["studio", "skills", "route"]
    assert offers == ["offer", "offer"]
    assert "Es ist zwölf Uhr." in calls


def test_bridge_uses_only_loopback_bearer_and_revision(tmp_path):
    key = tmp_path / "dashboard" / "data" / "voice-bridge" / "auth.key"
    key.parent.mkdir(parents=True)
    key.write_text(base64.b64encode(bytes(range(32))).decode("ascii"), encoding="ascii")

    class Opener:
        def __init__(self):
            self.request = None

        def open(self, request, timeout):
            self.request = request
            assert timeout == 12
            return io.BytesIO(json.dumps({"data": {"revision": 2}}).encode("utf-8"))

    opener = Opener()
    voice = SkillsOnboardingVoice(str(tmp_path), opener=opener)
    assert voice._request("PUT", "onboarding", {"goals": []}, revision=1) == {"revision": 2}
    assert opener.request.full_url == "http://127.0.0.1:3100/api/v1/onboarding"
    assert opener.request.get_header("Authorization").startswith("Bearer ")
    assert opener.request.get_header("If-match") == "1"
    assert opener.request.get_header("Cookie") is None
    try:
        voice._request("PUT", "skills/friday:calendar/activation", {"enabled": True})
    except ValueError:
        pass
    else:
        raise AssertionError("activation must remain outside the voice allowlist")
