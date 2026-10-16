"""Verified speaker's bounded, explicitly confirmed native coding request."""

import base64
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.request
import uuid

from content_studio_voice import _dashboard_port


CODING = re.compile(r"\b(codex|opencode|open\s+code|claude\s*code|coding|programmier\w*|codeauftrag|code-auftrag)\b", re.I)
START = re.compile(r"\b(starte?|starten|beauftrage|nutze|verwende|lass|lasse|mach|mache)\b", re.I)
YES = re.compile(r"^\s*(ja|best[aä]tige|starte|mach es|leg los|okay|ok)[.!?\s]*$", re.I)
NO = re.compile(r"^\s*(nein|abbrechen|stopp|stop|verwerfen)[.!?\s]*$", re.I)
FORMAT = re.compile(r"(?:mit\s+(?:dem\s+)?auftrag|auftrag\s*:|und\s+(?:soll|bitte))[,\s]+(.+)$", re.I)


def _normal(value):
    return "".join(ch for ch in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(ch))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class CodingVoice:
    def __init__(self, root, now=time.monotonic, opener=None):
        self.root = root
        self.now = now
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.pending = None

    def arm_confirmation(self):
        """Start the answer window after Friday has finished reading the whole preview."""
        if self.pending and self.pending["expires"] is None:
            self.pending["expires"] = self.now() + 90

    def _request(self, method, path, body=None, request_key=None):
        if (method, path) not in {("GET", "voice-repository"), ("POST", "voice")}:
            raise ValueError("Nicht erlaubte Coding-Bridge-Operation")
        key_path = os.path.join(self.root, "dashboard", "data", "voice-bridge", "auth.key")
        with open(key_path, encoding="ascii") as source:
            key = source.read().strip()
        if len(base64.b64decode(key, validate=True)) != 32:
            raise ValueError("Ungültiger Voice-Bridge-Schlüssel")
        headers = {"Authorization": "Bearer " + key, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if request_key:
            headers["Idempotency-Key"] = request_key
        request = urllib.request.Request(
            f"http://127.0.0.1:{_dashboard_port(self.root)}/api/v1/coding-runs/{path}",
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            headers=headers, method=method,
        )
        with self.opener.open(request, timeout=20) as response:
            return json.load(response)["data"]

    def handle(self, text):
        """Caller must verify the speaker for every call, including confirmation."""
        words = text.strip()
        if self.pending and self.pending["expires"] is not None and self.now() > self.pending["expires"]:
            self.pending = None
            if YES.fullmatch(words):
                return "Die Bestätigung ist abgelaufen. Bitte nenne den Coding-Auftrag erneut."
        if self.pending and NO.fullmatch(words):
            self.pending = None
            return "Der Coding-Auftrag wurde verworfen."
        if self.pending and YES.fullmatch(words):
            if self.pending["expires"] is None:
                self.pending = None
                return "Die Auftragsvorschau wurde unterbrochen. Bitte nenne den Coding-Auftrag erneut."
            pending = self.pending
            try:
                run = self._request("POST", "voice", {
                    "alias": pending["alias"], "revision": pending["revision"],
                    "cli": pending["cli"], "task": pending["task"],
                }, pending["key"])
            except urllib.error.HTTPError as error:
                if error.code in (400, 401, 403, 409, 422):
                    self.pending = None
                    return "Der Coding-Auftrag wurde nicht gestartet. Projekt, Berechtigung oder CLI sind nicht mehr gültig."
                return "Der Ausgang ist unklar. Sage erneut ja, um denselben Auftrag sicher wiederzufinden, oder nein."
            except (OSError, ValueError, KeyError, TimeoutError):
                return "Der Ausgang ist unklar. Sage erneut ja, um denselben Auftrag sicher wiederzufinden, oder nein."
            self.pending = None
            run_id = run.get("runId", "")
            if not re.fullmatch(r"run_[a-f0-9]{32}", run_id):
                return "Der Auftrag wurde angenommen, aber die Run-ID ist unbekannt. Prüfe den Status im Skills-Dashboard."
            return (f"Der Coding-Auftrag {run_id} wurde angenommen. Der CLI- und Anbieterstatus steht im Skills-Dashboard. "
                    "Anbieter können Kosten verursachen; die Ausführung ist erst bestätigt, wenn der CLI-Prozess dort als gestartet angezeigt wird.")
        if self.pending:
            self.pending = None
        if not CODING.search(words):
            return None
        if not START.search(words):
            return "Für einen Coding-Auftrag sage: Starte Codex im Projekt Projektname mit dem Auftrag, gefolgt von deiner Aufgabe."
        cli_hits = []
        normalized = _normal(words)
        for cli, pattern in (("codex", r"\bcodex\b"), ("opencode", r"\bopen\s*code\b"), ("claude-code", r"\bclaude\s*code\b")):
            if re.search(pattern, normalized):
                cli_hits.append(cli)
        if len(cli_hits) != 1:
            return "Bitte nenne genau eine CLI: Codex, OpenCode oder Claude Code."
        match = FORMAT.search(words)
        task = match.group(1).strip(" ,.?!") if match else ""
        if not (10 <= len(task) <= 300) or task.startswith("-"):
            return "Bitte nenne nach ‚mit dem Auftrag‘ eine konkrete Aufgabe mit 10 bis 300 Zeichen."
        try:
            project = self._request("GET", "voice-repository")
        except (OSError, ValueError, KeyError, TimeoutError, urllib.error.HTTPError):
            return "Das gespeicherte Sprachprojekt ist gerade nicht erreichbar."
        alias = project.get("alias", "")
        revision = project.get("revision", 0)
        if not alias or not isinstance(revision, int) or revision < 1:
            return "Richte zuerst im Skills-Dashboard ein Git-Repository für Sprachaufträge ein."
        if not re.search(r"\bim\s+projekt\s+" + re.escape(_normal(alias)) + r"\b", normalized):
            return f"Bitte nenne das gespeicherte Projekt {alias} ausdrücklich. Ich verwende keinen gesprochenen Dateipfad."
        self.pending = {"alias": alias, "revision": revision, "cli": cli_hits[0], "task": task,
                        "key": "idem_voice_" + uuid.uuid4().hex, "expires": None}
        return (f"Ich würde {cli_hits[0]} im Projekt {alias} mit genau diesem Auftrag starten: {task}. "
                "Das kann Anbieterkosten verursachen. Soll ich diesen Coding-Auftrag jetzt starten? Sage ja oder nein.")
