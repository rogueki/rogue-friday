"""Exercise the real voice dispatcher and session cleanup with synthetic mail."""
import ast
import datetime as dt
import os
import re
import sys
import time
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from mail_voice import MailVoice


SOURCE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "friday_voice.py")


def _method(name):
    service = next(node for node in ast.parse(open(SOURCE, encoding="utf-8").read()).body
                   if isinstance(node, ast.ClassDef) and node.name == "VoiceService")
    method = next(node for node in service.body if isinstance(node, ast.FunctionDef) and node.name == name)
    method.returns = None
    for argument in method.args.args:
        argument.annotation = None
    namespace = {"time": time, "SR": 16000, "STOP_WORDS": re.compile(r"^stopp?$", re.I),
                 "log_event": lambda **kwargs: None}
    exec(compile(ast.Module(body=[method], type_ignores=[]), SOURCE, "exec"), namespace)
    return namespace[name]


def test_spoken_mail_read_goes_through_speaker_gate_and_stays_local():
    dispatch = _method("_handle_command")
    spoken = []
    transcript = ["Lies Mail eins vor", "Lies sie vor"]
    mail = MailVoice("/synthetic")
    mail.results = [{"mailbox": "Inbox", "id": "506"}]
    mail.results_expires = mail.now() + 120
    calls = []
    def fake(method, path, payload=None, key=None):
        calls.append(path)
        assert method == "GET" and path == "message?mailbox=Inbox&id=506"
        return {"from": "sender@example.test", "subject": "Synthetic", "bodyText": "Hello"}, None
    mail._safe = fake
    voice = types.SimpleNamespace(
        control_generation=0, control_cancel=types.SimpleNamespace(is_set=lambda: False),
        cfg={"speaker_threshold": 0.4, "trusted_session_s": 15},
        verifier=types.SimpleNamespace(score=lambda audio: 0.8),
        status={"rejected_speaker": 0, "commands": 0}, trusted_until=0,
        _transcribe=lambda audio: transcript.pop(0), mail_voice=mail,
        _say_if_current=lambda answer, generation: spoken.append(answer) or True,
        cloudtalk_voice=types.SimpleNamespace(handle=lambda text: (_ for _ in ()).throw(AssertionError("cloud route")), pending=None),
        powerpoint_voice=types.SimpleNamespace(pending=None), calendar_voice=types.SimpleNamespace(pending=None),
        coding_voice=types.SimpleNamespace(pending=None), content_studio_voice=types.SimpleNamespace(pending=None),
        skills_onboarding_voice=types.SimpleNamespace(pending=None), history=[])
    dispatch(voice, [0] * 16000, None)
    dispatch(voice, [0] * 16000, None)
    assert len(spoken) == 2 and all("Hello" in answer for answer in spoken)
    assert calls == ["message?mailbox=Inbox&id=506"] * 2
    assert mail.selected == {"mailbox": "Inbox", "id": "506"}
    assert voice.history == []

    voice.verifier.score = lambda audio: 0.1
    transcript.append("Antworte darauf, dass ich morgen Zeit habe")
    dispatch(voice, [0] * 16000, None)
    assert len(spoken) == 2 and not mail.pending


def test_session_end_clears_only_mail_approval():
    session = _method("_session")
    mail = MailVoice("/synthetic")
    mail.selected = {"mailbox": "Inbox", "id": "506"}
    mail.results_expires = mail.now() + 120
    mail.pending = {"armed": True}
    recording = iter(([0] * 16000, None))
    empty = types.SimpleNamespace(pending=None)
    voice = types.SimpleNamespace(
        cfg={"command_start_timeout_s": 1, "followup_window_s": 1}, control_generation=0,
        control_cancel=types.SimpleNamespace(is_set=lambda: False), control_paused=False,
        status={"state": "listening"}, processing=None, preroll=[], trusted_until=0,
        background_jobs=set(), background_reply_ready=types.SimpleNamespace(is_set=lambda: False),
        tts=types.SimpleNamespace(speaking=types.SimpleNamespace(is_set=lambda: False)),
        _drain=lambda: None, _beep=lambda *args: None, _record_command=lambda timeout: next(recording),
        _handle_command=lambda audio, wake: None, mail_voice=mail, calendar_voice=empty,
        powerpoint_voice=types.SimpleNamespace(pending=None), cloudtalk_voice=types.SimpleNamespace(pending=None))
    session(voice, manual=True)
    assert mail.selected == {"mailbox": "Inbox", "id": "506"}
    assert mail.pending is None


def test_spoken_search_read_reply_preview_and_no_stay_inside_mail_pipeline():
    dispatch = _method("_handle_command")
    transcripts = iter(("Schau nach Nachrichten, in deren Betreff Friday Sprachtest steht",
                        "Lies mir die erste Mail vor",
                        "Gib ihr bitte Bescheid, morgen passt es mir um drei", "Nein"))
    spoken, requests = [], []
    mail = MailVoice("/synthetic", interpret=lambda words, context: {"action": "list"})
    def fake(method, path, body=None, key=None):
        if path == "mailboxes":
            return {"mailboxes": [{"id": "Inbox", "name": "Inbox", "role": "inbox"}]}, None
        if path.startswith("envelopes?"):
            return {"items": [{"id": "506", "subject": "Friday Sprachtest", "from": [], "flags": []}]}, None
        if path == "message?mailbox=Inbox&id=506":
            return {"from": "sender@example.test", "subject": "Friday Sprachtest", "bodyText": "Synthetic"}, None
        if path == "voice/preview":
            requests.append(body)
            return {"token": "a" * 40, "fingerprint": "f" * 64,
                    "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=60)).isoformat(),
                    "action": "reply", "to": ["sender@example.test"], "subject": "Re: Friday Sprachtest",
                    "body": body["body"], "mailbox": "Inbox", "id": "506", "destination": ""}, None
        raise AssertionError(path)
    mail._safe = fake
    other = types.SimpleNamespace(handle=lambda text: (_ for _ in ()).throw(AssertionError("external route")), pending=None)
    voice = types.SimpleNamespace(
        control_generation=0, control_cancel=types.SimpleNamespace(is_set=lambda: False),
        cfg={"speaker_threshold": 0.4, "trusted_session_s": 15},
        verifier=types.SimpleNamespace(score=lambda audio: 0.8),
        status={"rejected_speaker": 0, "commands": 0}, trusted_until=0,
        _transcribe=lambda audio: next(transcripts), mail_voice=mail,
        _say_if_current=lambda answer, generation: spoken.append(answer) or True,
        cloudtalk_voice=other, powerpoint_voice=other, calendar_voice=types.SimpleNamespace(pending=None),
        coding_voice=types.SimpleNamespace(pending=None), content_studio_voice=types.SimpleNamespace(pending=None),
        skills_onboarding_voice=types.SimpleNamespace(pending=None), history=[])
    for _ in range(4):
        dispatch(voice, [0] * 16000, None)
    assert len(spoken) == 4 and "Friday Sprachtest" in spoken[0]
    assert "Synthetic" in spoken[1] and "Sage Ja oder Nein" in spoken[2]
    assert "verworfen" in spoken[3]
    assert requests == [{"action": "reply", "mailbox": "Inbox", "id": "506",
                         "body": "morgen passt es mir um drei"}]
    assert mail.pending is None and voice.history == []


def test_semantic_mail_branch_clears_previous_calendar_approval():
    dispatch = _method("_handle_command")
    executed = []
    calendar = types.SimpleNamespace(pending={"token": "synthetic"})
    calendar.handle = lambda text: executed.append(text) if calendar.pending and text == "Ja" else None
    mail = types.SimpleNamespace(handles_text=lambda text: False, handle=lambda text: "Mail gelesen",
                                 clear=lambda: None)
    other = types.SimpleNamespace(handle=lambda text: None, pending=None)
    spoken = []
    voice = types.SimpleNamespace(
        control_generation=0, control_cancel=types.SimpleNamespace(is_set=lambda: False),
        cfg={"speaker_threshold": 0.4, "trusted_session_s": 15},
        verifier=types.SimpleNamespace(score=lambda audio: 0.8),
        status={"rejected_speaker": 0, "commands": 0}, trusted_until=0,
        _transcribe=lambda audio: "Bitte lies die Mitteilung fuer mich", mail_voice=mail,
        _say_if_current=lambda answer, generation: spoken.append(answer) or True,
        cloudtalk_voice=other, powerpoint_voice=other, calendar_voice=calendar,
        coding_voice=types.SimpleNamespace(pending=None), content_studio_voice=types.SimpleNamespace(pending=None),
        skills_onboarding_voice=types.SimpleNamespace(pending=None), history=[])
    dispatch(voice, [0] * 16000, None)
    assert spoken == ["Mail gelesen"] and calendar.pending is None
    assert calendar.handle("Ja") is None and executed == []
