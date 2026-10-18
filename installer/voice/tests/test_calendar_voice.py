import datetime as dt
import ast
import base64
import http.server
import os
import re
import sys
import threading
import time
import types
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from calendar_voice import CalendarVoice


def test_dispatcher_discards_calendar_preview_if_cancelled_or_not_spoken():
    source = os.path.join(os.path.dirname(os.path.dirname(__file__)), "friday_voice.py")
    service = next(node for node in ast.parse(open(source, encoding="utf-8").read()).body
                   if isinstance(node, ast.ClassDef) and node.name == "VoiceService")
    method = next(node for node in service.body if isinstance(node, ast.FunctionDef) and node.name == "_handle_command")
    method.returns = None
    for arg in method.args.args:
        arg.annotation = None
    namespace = {"time": time, "SR": 16000, "STOP_WORDS": re.compile(r"^stopp?$", re.I),
                 "log_event": lambda **kwargs: None}
    exec(compile(ast.Module(body=[method], type_ignores=[]), source, "exec"), namespace)

    def make_voice():
        voice = types.SimpleNamespace(
            cfg={"speaker_threshold": 0.4, "trusted_session_s": 15}, control_generation=0,
            control_cancel=types.SimpleNamespace(is_set=lambda: False),
            verifier=types.SimpleNamespace(score=lambda audio: 0.7),
            status={"rejected_speaker": 0, "commands": 0}, trusted_until=0,
            _transcribe=lambda audio: "Erstelle Termin Team am 20.10.2026 um 14 Uhr",
            calendar_voice=types.SimpleNamespace(pending=None),
            cloudtalk_voice=types.SimpleNamespace(handle=lambda text: None, pending=None),
            powerpoint_voice=types.SimpleNamespace(handle=lambda text: None, pending=None),
            coding_voice=types.SimpleNamespace(pending=None),
            content_studio_voice=types.SimpleNamespace(pending=None),
            skills_onboarding_voice=types.SimpleNamespace(pending=None),
            history=[],
        )
        return voice

    switched = make_voice()
    def switched_handle(text):
        switched.calendar_voice.pending = {"preview": "unspoken"}
        switched.control_generation += 1
        return "Soll ich den Termin anlegen?"
    switched.calendar_voice.handle = switched_handle
    namespace["_handle_command"](switched, [0] * 16000, None)
    assert switched.calendar_voice.pending is None

    cancelled = make_voice()
    stopped = [False]
    cancelled.control_cancel.is_set = lambda: stopped[0]
    def cancelled_handle(text):
        cancelled.calendar_voice.pending = {"preview": "unspoken"}
        stopped[0] = True
        return "Soll ich den Termin anlegen?"
    cancelled.calendar_voice.handle = cancelled_handle
    namespace["_handle_command"](cancelled, [0] * 16000, None)
    assert cancelled.calendar_voice.pending is None

    unheard = make_voice()
    def unheard_handle(text):
        unheard.calendar_voice.pending = {"preview": "unspoken"}
        return "Soll ich den Termin anlegen?"
    unheard.calendar_voice.handle = unheard_handle
    unheard._say_if_current = lambda answer, generation: False
    namespace["_handle_command"](unheard, [0] * 16000, None)
    assert unheard.calendar_voice.pending is None
    assert unheard.history == []


def test_calendar_bridge_does_not_follow_http_redirect_with_bearer(tmp_path, monkeypatch):
    hits = []
    class Redirect(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            hits.append((self.path, self.headers.get("Authorization")))
            self.send_response(307)
            self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/steal")
            self.end_headers()

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        key = tmp_path / "dashboard" / "data" / "voice-bridge" / "auth.key"
        key.parent.mkdir(parents=True)
        key.write_text(base64.b64encode(bytes(range(32))).decode("ascii"), encoding="ascii")
        config = tmp_path / "dashboard" / "config" / "dashboard.yaml"
        config.parent.mkdir(parents=True)
        config.write_text(f"server:\n  port: {server.server_port}\n", encoding="utf-8")
        monkeypatch.setenv("FRIDAY_DATA_DIR", str(tmp_path / "dashboard" / "data"))
        monkeypatch.setenv("FRIDAY_DASHBOARD_PORT", str(server.server_port))
        calendar = CalendarVoice(str(tmp_path))
        try:
            calendar._request("preview", {"action": "delete", "targetTitle": "Team"})
            assert False, "Redirect must be rejected"
        except urllib.error.HTTPError as error:
            assert error.code == 307
        assert len(hits) == 1
        assert hits[0][0] == "/api/v1/calendar/local/voice/preview"
        assert hits[0][1] == "Bearer " + key.read_text(encoding="ascii")
    finally:
        server.shutdown()
        server.server_close()


def test_create_requires_spoken_confirmation_and_never_retries_with_new_key(tmp_path):
    calendar = CalendarVoice(str(tmp_path), zone="UTC")
    calls = []

    def request(path, body, request_key=None):
        calls.append((path, body, request_key))
        if path == "preview":
            return {"token": "signed-token", "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=90)).isoformat(),
                    "targetId": "", "version": 0, "event": body}, None
        return {"id": "cal-one"}, None

    calendar._safe_request = request
    preview = calendar.handle("Erstelle Termin Zahnarzt am 20.10.2026 um 14 Uhr für 30 Minuten")
    assert "Soll ich genau das tun" in preview
    assert [call[0] for call in calls] == ["preview"]
    assert calendar.handle("nein").endswith("verworfen.")
    assert len(calls) == 1
    calendar.handle("Erstelle Termin Zahnarzt am 20.10.2026 um 14 Uhr für 30 Minuten")
    calendar.arm_confirmation()
    assert "angelegt" in calendar.handle("ja")
    assert calls[-1][0] == "confirm"
    assert calls[-1][2].startswith("idem_voice_calendar_")
    assert calendar.handle("ja") is None


def test_update_delete_use_names_not_spoken_ids_and_timeout(tmp_path):
    now = [0]
    calendar = CalendarVoice(str(tmp_path), now=lambda: now[0], zone="UTC")
    calls = []

    def request(path, body, request_key=None):
        calls.append((path, body))
        return {"token": "signed-token", "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=90)).isoformat(),
                "targetId": "cal-from-server", "version": 1,
                "event": {"title": "Team", "start": "2026-10-20T14:00:00Z", "end": "2026-10-20T15:00:00Z", "timeZone": "UTC"}}, None

    calendar._safe_request = request
    assert "aendern" in calendar.handle("Verschiebe Termin Team auf 21.10.2026 um 15 Uhr")
    calendar.arm_confirmation()
    assert calls[0][1]["targetTitle"] == "Team"
    assert "targetId" not in calls[0][1]
    now[0] = 80
    assert "abgelaufen" in calendar.handle("ja")
    assert len(calls) == 1
    assert "loeschen" in calendar.handle("Lösche Termin Team")
    assert calls[1][1] == {"action": "delete", "targetTitle": "Team"}


def test_confirmation_before_finished_preview_is_rejected(tmp_path):
    calendar = CalendarVoice(str(tmp_path), zone="UTC")
    calls = []
    def request(path, body, request_key=None):
        calls.append(path)
        return {"token": "signed-token", "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=90)).isoformat(),
                "targetId": "", "version": 0, "event": body}, None
    calendar._safe_request = request
    calendar.handle("Erstelle Termin Team am 20.10.2026 um 14 Uhr")
    assert "unterbrochen" in calendar.handle("ja")
    assert calls == ["preview"]
