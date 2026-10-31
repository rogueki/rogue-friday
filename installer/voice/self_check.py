"""Self-diagnosis of the voice service from live values.

Only the given status and optional Control API probes are read; raw error texts and audio never reach the spoken
sentences, so the answers stay fixed and safe to say aloud.
"""

import datetime

AREAS = (
    "mikrofon",
    "wake_word",
    "sprecher",
    "qwen",
    "dashboard",
    "ruhemodus",
    "system",
    "gedaechtnis",
)

MAX_ANSWER = 300


def _finding(area, ok, text):
    return {"bereich": area, "ok": ok, "text": text}


def _runtime_settings(status):
    settings = status.get("runtime_settings")
    if isinstance(settings, dict):
        return settings
    return None


def _check_mikrofon(status):
    if status.get("audio_error"):
        return _finding(
            "mikrofon",
            False,
            "Das Mikrofon meldet einen Fehler. Prüfe unter Einstellungen → Sprache das Eingabegerät.",
        )
    active = status.get("input_stream_active")
    if status.get("audio_transport") == "browser":
        # The browser owns the microphone here; the service has no local stream to judge.
        return _finding("mikrofon", True, "Das Mikrofon läuft über den Browser.")
    if active is False:
        return _finding("mikrofon", False, "Das Mikrofon nimmt gerade nicht auf.")
    if "input_stream_active" in status:
        name = status.get("input_device_name")
        if name:
            return _finding("mikrofon", True, f"Mikrofon aktiv: {name}.")
        return _finding("mikrofon", True, "Mikrofon aktiv.")
    return None


def _check_wake_word(status):
    settings = _runtime_settings(status) or {}
    if settings.get("wakeWordEnabled") is False:
        return _finding(
            "wake_word",
            False,
            "Das Wake Word ist ausgeschaltet. Ansprechen geht dann nur per Tastenkürzel.",
        )
    phrase = status.get("wake_phrase")
    if phrase:
        return _finding("wake_word", True, f"Wake Word „{phrase}“ ist aktiv.")
    return None


def _check_sprecher(status):
    settings = _runtime_settings(status)
    if settings is None:
        return None
    required = settings.get("speakerVerificationRequired") is True
    if required and status.get("speaker_profile") is None:
        return _finding(
            "sprecher",
            False,
            "Die Sprecherprüfung ist an, aber es gibt kein Sprecherprofil.",
        )
    rejected = status.get("rejected_speaker")
    if isinstance(rejected, int) and not isinstance(rejected, bool) and rejected >= 3:
        return _finding(
            "sprecher",
            False,
            f"Seit dem Start habe ich {rejected} Befehle abgelehnt, weil die Stimme nicht passte.",
        )
    if required:
        return _finding("sprecher", True, "Sprecherprüfung aktiv.")
    return _finding("sprecher", True, "Sprecherprüfung ist aus.")


def _check_qwen(status):
    conversation = status.get("conversation")
    if not isinstance(conversation, dict):
        return None
    backend = conversation.get("backend")
    if backend == "qwen":
        if conversation.get("key_configured") is False:
            return _finding("qwen", False, "Für den Qwen-Modus fehlt der Schlüssel.")
        last_error = conversation.get("last_error")
        if last_error == "auth":
            return _finding("qwen", False, "Der Qwen-Schlüssel wurde abgelehnt.")
        if last_error:
            return _finding("qwen", False, "Die Verbindung zu Qwen meldet einen Fehler.")
        return _finding("qwen", True, "Qwen-Gesprächsmodus bereit.")
    if backend == "local":
        return _finding("qwen", True, "Lokaler Sprachbetrieb.")
    return None


def _parse_until(value, now):
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        moment = datetime.datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=now.tzinfo)
    return moment.astimezone(now.tzinfo)


def _quiet_findings(quiet_state, now):
    if quiet_state is None:
        return None
    try:
        state = quiet_state()
    except Exception:
        return [
            _finding(
                "dashboard",
                False,
                "Das Dashboard ist für mich nicht erreichbar. "
                "Aufträge und Ansagen funktionieren dann nicht.",
            )
        ]
    if not isinstance(state, dict):
        state = {}
    dashboard = _finding("dashboard", True, "Das Dashboard ist erreichbar.")
    if state.get("active") is True:
        label = "Ruhemodus" if state.get("source") == "temporary" else "Nachtruhe"
        moment = _parse_until(state.get("until"), now)
        if moment is None:
            text = f"{label} aktiv. Ansagen kommen erst danach."
        else:
            text = f"{label} aktiv bis {moment.strftime('%H:%M')} Uhr. Ansagen kommen erst danach."
        return [dashboard, _finding("ruhemodus", False, text)]
    return [dashboard, _finding("ruhemodus", True, "Kein Ruhemodus aktiv.")]


def _check_system(system_status):
    if system_status is None:
        return None
    try:
        result = system_status()
    except Exception:
        return None
    if not isinstance(result, dict):
        return None
    answer = result.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        return None
    text = answer.strip()
    return _finding("system", "nicht online" not in text, text[:MAX_ANSWER])


def _check_gedaechtnis(status):
    if status.get("memory_capture_error"):
        return _finding("gedaechtnis", False, "Das Gedächtnis kann gerade nichts speichern.")
    pending = status.get("memory_pending")
    if isinstance(pending, int) and not isinstance(pending, bool) and pending >= 20:
        return _finding(
            "gedaechtnis",
            False,
            f"{pending} Gedächtniseinträge warten auf die Übertragung.",
        )
    return None


def diagnose(status: dict, *, quiet_state=None, system_status=None, now=None) -> list[dict]:
    if not isinstance(status, dict):
        status = {}
    if now is None:
        now = datetime.datetime.now().astimezone()

    findings = []
    for finding in (
        _check_mikrofon(status),
        _check_wake_word(status),
        _check_sprecher(status),
        _check_qwen(status),
    ):
        if finding is not None:
            findings.append(finding)
    findings.extend(_quiet_findings(quiet_state, now) or [])
    for finding in (_check_system(system_status), _check_gedaechtnis(status)):
        if finding is not None:
            findings.append(finding)
    return findings


def spoken_summary(findings: list[dict], limit: int = 3) -> str:
    if not findings:
        return "Dazu habe ich gerade keine Messwerte."

    problems = [finding["text"] for finding in findings if not finding.get("ok")]
    if not problems:
        ok_texts = [finding["text"] for finding in findings if finding.get("ok")][:2]
        return " ".join(["Ich finde keinen Fehler."] + ok_texts)

    try:
        count = max(1, int(limit))
    except (TypeError, ValueError):
        count = 3

    summary = "Mir fällt auf: " + " ".join(problems[:count])
    if len(problems) > count:
        summary += " Weitere Punkte stehen im Dashboard unter Sprache."
    return summary
