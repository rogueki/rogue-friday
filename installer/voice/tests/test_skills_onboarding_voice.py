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

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from skills_onboarding_voice import SkillsOnboardingVoice


@pytest.fixture(autouse=True)
def windows_layout_data_dir(tmp_path, monkeypatch):
    # On Linux the bridge files live under FRIDAY_DATA_DIR; point it at the Windows layout these tests assert.
    monkeypatch.setenv("FRIDAY_DATA_DIR", str(tmp_path / "dashboard" / "data"))


class FakeApi:
    def __init__(self):
        self.state = {"revision": 0, "steps": {step: "pending" for step in ("intro", "profile", "skills", "accounts", "finish")},
                      "goals": [], "selectedSkillIds": [], "completedAt": None, "updatedAt": None}
        self.skills = [{"id": "friday:calendar", "name": "Kalender", "enabled": True, "integrationDetails": []},
                       {"id": "friday:research", "name": "Recherche", "enabled": None, "integrationDetails": []},
                       {"id": "friday:mail", "name": "E-Mail", "enabled": False, "integrationDetails": []}]
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
    assert "Skills" in voice.handle("ja")
    assert "Konten" in voice.handle("fertig")
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


def test_spoken_skill_detail_reports_status_account_and_connection_limits(tmp_path):
    api = FakeApi()
    api.skills = [{"id": "hermes:notion", "source": "hermes", "name": "notion", "description": "Verwaltet freigegebene Notion-Seiten.",
                   "enabled": True, "integrationDetails": [{"id": "notion", "account": "required", "configured": True, "connectionChecked": None}]}]
    voice = handler(tmp_path, api)
    answer = voice.handle("Was kann Skill Notion?")
    assert "freigegebene Notion-Seiten" in answer
    assert "aktiviert" in answer and "keine erfolgreiche Ausführung" in answer
    assert "Konto ist nötig" in answer and "lokal vorhanden" in answer and "Verbindung nicht geprüft" in answer
    assert api.calls == [("GET", "skills", None, None)]
    assert "Konto ist nötig" in voice.handle("Braucht Notion ein Konto?")
    assert "aktiviert" in voice.handle("Ist Notion aktiviert?")


def test_spoken_skill_detail_resolves_exact_id_but_rejects_ambiguous_name(tmp_path):
    api = FakeApi()
    api.skills = [{"id": "friday:research", "source": "friday", "name": "research", "description": "Friday recherche.", "enabled": False, "integrationDetails": []},
                  {"id": "hermes:research", "source": "hermes", "name": "research", "description": "Hermes recherche.", "enabled": None, "integrationDetails": []},
                  {"id": "hermes:powerpoint", "source": "hermes", "name": "powerpoint", "description": "Erstellt Folien.", "enabled": True, "integrationDetails": []}]
    voice = handler(tmp_path, api)
    assert "mehrdeutig" in voice.handle("Erkläre Research")
    assert "Friday recherche" in voice.handle("Erkläre Friday:Research")
    assert "deaktiviert" in voice.handle("Erkläre Friday:Research")
    assert "Erstellt Folien" in voice.handle("Was kann PowerPoint erstellen?")
    assert "kein Konto verzeichnet" in voice.handle("Braucht PowerPoint ein Konto?")
    assert "nicht" in voice.handle("Erkläre mail")


def test_spoken_skill_detail_is_bounded_for_unavailable_or_malformed_catalog(tmp_path):
    api = FakeApi()
    voice = handler(tmp_path, api)
    api.request = lambda *args, **kwargs: (None, "unavailable")
    voice._safe_request = api.request
    assert "nicht erreichbar" in voice.handle("Erkläre Notion")
    voice._safe_request = lambda *args, **kwargs: ({"data": [None, {}, {"id": "hermes:notion", "name": "notion", "description": "Token=sk-very-secret-value", "enabled": None}]}, None)
    answer = voice.handle("Erkläre Notion")
    assert "unbekannt" in answer and "Ob ein Konto nötig ist" in answer
    assert "sk-very-secret-value" not in answer


def test_selected_account_guidance_deduplicates_bounds_and_does_not_write(tmp_path):
    api = FakeApi()
    api.state["selectedSkillIds"] = ["friday:a", "friday:b", "friday:a"]
    api.skills = [
        {"id": "friday:a", "integrationDetails": [
            {"id": "imap", "account": "required", "configured": True, "connectionChecked": None, "setupDe": "password=secret"},
            {"id": "caldav", "account": "conditional", "configured": False, "connectionChecked": False},
            {"id": "third", "account": "required", "configured": None, "connectionChecked": True},
            {"id": "fourth", "account": "required", "configured": None, "connectionChecked": None},
            {"id": "fifth", "account": "required", "configured": None, "connectionChecked": None},
        ]},
        {"id": "friday:b", "integrationDetails": [{"id": "imap", "account": "conditional", "configured": True, "connectionChecked": None}]},
    ]
    voice = handler(tmp_path, api)
    answer = voice.handle("Welche Konten brauche ich für meine Skills?")
    assert "imap: erforderlich, lokal eingerichtet, Verbindung nicht geprüft" in answer
    assert "caldav: je nach Nutzung, nicht eingerichtet, Verbindung nicht bestätigt" in answer
    assert "third: erforderlich, Einrichtungsstand unbekannt, Verbindung geprüft" in answer
    assert "2 weitere" in answer and "fourth" not in answer
    assert "secret" not in answer and "Mail" in answer
    assert api.calls == [("GET", "onboarding", None, None), ("GET", "skills", None, None)]
    assert api.state["revision"] == 0
    assert voice.pending is None


def test_account_guidance_handles_no_selection_missing_catalog_and_no_accounts(tmp_path):
    api = FakeApi()
    voice = handler(tmp_path, api)
    assert "noch keine Skills ausgewählt" in voice.handle("Welche Konten brauche ich für meine Skills?")
    api.state["selectedSkillIds"] = ["friday:calendar"]
    api.skills[0]["integrationDetails"] = [{"id": "local", "account": "none", "configured": None, "connectionChecked": None}]
    assert "keine externen Konten" in voice.handle("Welche Konten brauche ich für meine Skills?")
    voice._safe_request = lambda method, path, **kwargs: (copy.deepcopy(api.state), None) if path == "onboarding" else (None, "unavailable")
    assert "nicht sicher sagen" in voice.handle("Welche Konten brauche ich für meine Skills?")
    assert voice.handle("Welche Konten brauche ich für andere Nutzer?") is None
    assert voice.handle("Welche Skills brauchen Konten?") is None


def test_account_step_uses_live_selection_and_stays_unverified(tmp_path):
    api = FakeApi()
    api.state["steps"].update(intro="completed", profile="completed", skills="completed")
    api.state["selectedSkillIds"] = ["friday:mail"]
    api.skills[2]["integrationDetails"] = [{"id": "smtp", "account": "required", "configured": False, "connectionChecked": None}]
    voice = handler(tmp_path, api)
    prompt = voice.handle("Einrichtung fortsetzen")
    assert "Konto 1 von 1: smtp, erforderlich; nicht eingerichtet" in prompt
    assert "ungeprueft" in prompt
    assert "abschließen" in voice.handle("weiter")
    assert api.state["steps"]["accounts"] == "skipped"


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
                 "STOP_WORDS": re.compile("^stopp$"), "is_goodbye": lambda text: False, "uuid": __import__("uuid"),
                 "DEFAULT_ACK_WAIT": "warte", "DEFAULT_ACK_BACKGROUND": "warte",
                 "record_latency": lambda *args, **kwargs: None}
    exec(compile(ast.Module(body=[method], type_ignores=[]), source, "exec"), namespace)
    calls = []
    offers = []
    voice = types.SimpleNamespace(
        cfg={"speaker_threshold": 0.4, "trusted_session_s": 15},
        control_generation=0, control_cancel=types.SimpleNamespace(is_set=lambda: False),
        verifier=types.SimpleNamespace(score=lambda audio: 0.2),
        status={"rejected_speaker": 0, "commands": 0}, trusted_until=0,
        _transcribe=lambda audio: "Welche Skills sind aktiv?",
        calendar_voice=types.SimpleNamespace(handle=lambda text: None, pending=None),
        cloudtalk_voice=types.SimpleNamespace(handle=lambda text: None, pending=None),
        powerpoint_voice=types.SimpleNamespace(handle=lambda text: None, pending=None),
        coding_voice=types.SimpleNamespace(handle=lambda text: calls.append("coding") or None),
        content_studio_voice=types.SimpleNamespace(handle=lambda text: calls.append("studio") or None),
        skills_onboarding_voice=types.SimpleNamespace(
            handle=lambda text: calls.append("skills") or "Kalender ist aktiv.",
            offer_first_use=lambda: offers.append("offer") or "",
        ),
        tts=types.SimpleNamespace(say=lambda answer: calls.append(answer)), history=[],
    )
    voice._say_if_current = lambda answer, generation: calls.append(answer) or True
    namespace["_handle_command"](voice, [0] * 16000, None)
    assert calls == [] and offers == [] and voice.status["rejected_speaker"] == 1
    voice.verifier.score = lambda audio: 0.7
    namespace["_handle_command"](voice, [0] * 16000, None)
    assert calls == ["coding", "studio", "skills", "Kalender ist aktiv."]
    assert offers == ["offer"]
    calls.clear()
    voice.skills_onboarding_voice.handle = lambda text: calls.append("skills") or None
    voice._transcribe = lambda audio: "Wie spät ist es?"
    voice._route = lambda text: calls.append("route") or {"route": "local", "answer": "Es ist zwölf Uhr."}
    namespace["_handle_command"](voice, [0] * 16000, None)
    assert calls[:4] == ["coding", "studio", "skills", "route"]
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


def test_voice_selects_two_skills_before_explicit_finish(tmp_path):
    api = FakeApi()
    api.state["steps"].update(intro="completed", profile="completed")
    voice = handler(tmp_path, api)
    assert "Skills" in voice.handle("Einrichtung fortsetzen")
    assert "aktiviert den Skill nicht" in voice.handle("Kalender")
    assert "Skills" in voice.handle("ja")
    assert api.state["steps"]["skills"] == "pending"
    assert "aktiviert den Skill nicht" in voice.handle("Recherche")
    assert "Skills" in voice.handle("ja")
    assert api.state["selectedSkillIds"] == ["friday:calendar", "friday:research"]
    assert "Konten" in voice.handle("fertig")
    assert api.state["steps"]["skills"] == "completed"


def test_account_walkthrough_covers_all_deduplicated_accounts(tmp_path):
    api = FakeApi()
    api.state["steps"].update(intro="completed", profile="completed", skills="completed")
    api.state["selectedSkillIds"] = ["friday:calendar", "friday:research"]
    api.skills[0]["integrationDetails"] = [
        {"id": f"service_{index}", "account": "required", "configured": False,
         "connectionChecked": None, "settingsTarget": "/settings?area=skillAccounts",
         "setupDe": "api_key=do-not-speak"} for index in range(1, 6)
    ]
    api.skills[1]["integrationDetails"] = [
        {"id": "service_1", "account": "conditional", "configured": False,
         "connectionChecked": None, "settingsTarget": "/settings?area=skillAccounts"}
    ]
    voice = handler(tmp_path, api)
    prompts = [voice.handle("Einrichtung fortsetzen")]
    for _ in range(4):
        prompts.append(voice.handle("weiter"))
        assert api.state["steps"]["accounts"] == "pending"
    for index, prompt in enumerate(prompts, 1):
        assert f"Konto {index} von 5: service {index}" in prompt
        assert "Einstellungen, Skill-Konten" in prompt
        assert "do-not-speak" not in prompt
    assert "Grundeinrichtung" in voice.handle("weiter")
    assert api.state["steps"]["accounts"] == "skipped"


def test_voice_catalog_unavailable_does_not_advance_or_echo_secrets(tmp_path):
    api = FakeApi()
    api.state["steps"].update(intro="completed", profile="completed", skills="completed")
    api.state["selectedSkillIds"] = ["friday:mail"]
    voice = handler(tmp_path, api)
    voice._safe_request = lambda method, path, **kwargs: (None, "unavailable") if path == "skills" else api.request(method, path, **kwargs)
    assert "nicht erreichbar" in voice.handle("Einrichtung fortsetzen")
    assert api.state["steps"]["accounts"] == "pending"
    assert voice.pending is None


def test_later_dismisses_without_changing_steps(tmp_path):
    api = FakeApi()
    api.state["steps"].update(intro="completed", profile="completed")
    voice = handler(tmp_path, api)
    assert voice.handle("Einrichtung fortsetzen")
    assert "Einrichtung fortsetzen" in voice.handle("spater")
    assert voice.pending is None
    assert api.state["steps"]["skills"] == "pending"
    assert voice.handle("weiter") is None


def test_account_catalog_change_requires_resume(tmp_path):
    api = FakeApi()
    api.state["steps"].update(intro="completed", profile="completed", skills="completed")
    api.state["selectedSkillIds"] = ["friday:mail"]
    api.skills[2]["integrationDetails"] = [
        {"id": "smtp", "account": "required", "configured": False,
         "connectionChecked": None}
    ]
    voice = handler(tmp_path, api)
    assert "smtp" in voice.handle("Einrichtung fortsetzen")
    api.skills[2]["integrationDetails"] = []
    assert "neu lese" in voice.handle("weiter")
    assert voice.pending is None
    assert api.state["steps"]["accounts"] == "pending"


def test_account_location_distinguishes_anchored_cloudtalk_and_hermes_host(tmp_path):
    api = FakeApi()
    api.state["steps"].update(intro="completed", profile="completed", skills="completed")
    api.state["selectedSkillIds"] = ["friday:mail"]
    api.skills[2]["integrationDetails"] = [
        {"id": "cloudtalk", "account": "required", "configured": False,
         "connectionChecked": None, "settingsTarget": "/settings?area=skillAccounts#cloudtalk-setup-title"},
        {"id": "hermes_host", "account": "required", "configured": None,
         "connectionChecked": None, "settingsTarget": "Hermes-Einstellungen in Friday-Ubuntu"},
    ]
    voice = handler(tmp_path, api)
    direct = voice.handle("Einrichtung fortsetzen")
    assert "cloudtalk" in direct
    assert "Einstellungen, Skill-Konten" in direct
    host = voice.handle("weiter")
    assert "Skills-Menue beim Skill-Detail" in host
    assert "Skill-Konten" not in host
    assert "Friday-Ubuntu" not in host


def test_account_step_never_speaks_token_like_integration_id(tmp_path):
    api = FakeApi()
    api.state["steps"].update(intro="completed", profile="completed", skills="completed")
    api.state["selectedSkillIds"] = ["friday:mail"]
    token_like_id = "a" * 40
    api.skills[2]["integrationDetails"] = [
        {"id": token_like_id, "account": "required", "configured": False,
         "connectionChecked": None, "settingsTarget": "/settings?area=skillAccounts"},
    ]
    voice = handler(tmp_path, api)
    response = voice.handle("Einrichtung fortsetzen")
    assert "unvollstaendig" in response
    assert token_like_id not in response
    assert voice.pending is None
    assert api.state["steps"]["accounts"] == "pending"
