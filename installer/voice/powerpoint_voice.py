"""One-slide Hermes PowerPoint request, spoken back before a verified second utterance."""

import base64
import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid

from content_studio_voice import dashboard_port
from voice_runtime_paths import voice_bridge_key_path


# Spoken syntax: "Erstelle eine PowerPoint mit Titel X und Folie Y mit Punkt eins A
# und Punkt zwei B". Explicit point numbers keep the parsed slide unambiguous.
COMMAND = re.compile(
    r"^(?:friday[, ]+)?erstelle\s+(?:eine\s+)?power[\s-]?point\s+mit\s+titel\s+(.+?)\s+"
    r"und\s+folie\s+(.+?)\s+mit\s+punkt\s+eins\s+(.+?)[.!?]?\s*$", re.I)
POINT = re.compile(r"\s+und\s+punkt\s+(zwei|drei|vier|f[uü]nf)\s+", re.I)
YES = re.compile(r"^\s*(?:ja|ja bitte|best[aä]tige|mach das|okay|ok)[.!?\s]*$", re.I)
NO = re.compile(r"^\s*(?:nein|abbrechen|stopp|stop|verwerfen)[.!?\s]*$", re.I)
NUMBERS = {"zwei": 2, "drei": 3, "vier": 4, "fünf": 5, "funf": 5}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def parse_command(text):
    match = COMMAND.fullmatch(text.strip())
    if not match:
        return None
    title, slide, remainder = (part.strip(" ,.!?") for part in match.groups())
    pieces = POINT.split(remainder)
    points = [pieces[0].strip(" ,.!?")]
    for offset in range(1, len(pieces), 2):
        number = NUMBERS.get(pieces[offset].casefold())
        if number != len(points) + 1 or offset + 1 >= len(pieces):
            raise ValueError("Punkte müssen nacheinander nummeriert sein")
        points.append(pieces[offset + 1].strip(" ,.!?"))
    if any(re.search(r"\bund\s+punkt\s+", point, re.I) for point in points):
        raise ValueError("Unbekannte oder zusätzliche Punktnummer")
    if not (1 <= len(title) <= 120 and 1 <= len(slide) <= 120 and
            1 <= len(points) <= 5 and all(1 <= len(point) <= 240 for point in points)):
        raise ValueError("Titel oder Punkte sind zu lang oder leer")
    return {"title": title, "slides": [{"title": slide, "bullets": points}]}


class PowerPointVoice:
    def __init__(self, root, now=time.monotonic, opener=None):
        self.root = root
        self.now = now
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.pending = None

    def arm_confirmation(self):
        # Invoked by Friday only after the entire preview has been spoken.
        if self.pending and self.pending["expires"] is None:
            self.pending["expires"] = self.now() + 90

    def _request(self, body, key):
        with open(voice_bridge_key_path(self.root), encoding="ascii") as source:
            raw_key = source.read().strip()
        if len(base64.b64decode(raw_key, validate=True)) != 32:
            raise ValueError("Voice-Bridge-Schlüssel ungültig")
        request = urllib.request.Request(
            f"http://127.0.0.1:{dashboard_port(self.root)}/api/v1/skills/powerpoint/voice",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST",
            headers={"Authorization": "Bearer " + raw_key, "Content-Type": "application/json",
                     "Accept": "application/json", "Idempotency-Key": key})
        with self.opener.open(request, timeout=35) as response:
            return json.load(response)["data"]

    def handle(self, text):
        """Caller has already verified the speaker for this utterance."""
        words = text.strip()
        if self.pending and self.pending["expires"] is not None and self.now() > self.pending["expires"]:
            self.pending = None
            if YES.fullmatch(words):
                return "Die PowerPoint-Bestätigung ist abgelaufen. Bitte nenne den Auftrag erneut."
        if self.pending and NO.fullmatch(words):
            self.pending = None
            return "Die PowerPoint-Präsentation wurde verworfen."
        if self.pending and YES.fullmatch(words):
            if self.pending["expires"] is None:
                self.pending = None
                return "Die Vorschau wurde unterbrochen. Bitte nenne die Präsentation erneut."
            pending = self.pending
            try:
                deck = self._request(pending["request"], pending["key"])
            except urllib.error.HTTPError as error:
                if error.code in (401, 403, 422, 503):
                    self.pending = None
                    return "PowerPoint ist nicht bereit oder der Sprachzugriff fehlt. Prüfe den Skill im Dashboard."
                return "Der Ausgang ist unklar. Sage erneut ja für denselben Auftrag, oder prüfe die letzten PowerPoint-Dateien im Skills-Menü."
            except (OSError, ValueError, KeyError, TimeoutError):
                return "Der Ausgang ist unklar. Sage erneut ja für denselben Auftrag, oder prüfe die letzten PowerPoint-Dateien im Skills-Menü."
            self.pending = None
            if not re.fullmatch(r"[a-f0-9-]{36}", str(deck.get("id", ""))):
                return "Die Präsentation wurde angefordert. Prüfe die letzten PowerPoint-Dateien im Skills-Menü."
            return "Die PowerPoint-Präsentation ist erstellt. Du findest den Download im Skills-Menü unter PowerPoint."
        if self.pending:
            self.pending = None
        try:
            request = parse_command(words)
        except ValueError:
            return "Bitte nenne einen kurzen Titel, einen Folientitel und bis zu fünf nummerierte Punkte."
        if request is None:
            if re.search(r"power[\s-]?point", words, re.I) and re.search(r"\b(?:erstelle|mach|mache)\b", words, re.I):
                return "Sage: Erstelle eine PowerPoint mit Titel Mein Thema und Folie Überblick mit Punkt eins Einführung und Punkt zwei Ergebnis."
            return None
        self.pending = {"request": request, "key": "idem_voice_powerpoint_" + uuid.uuid4().hex, "expires": None}
        points = request["slides"][0]["bullets"]
        readback = ". ".join(f"Punkt {index}: {point}" for index, point in enumerate(points, 1))
        return (f"Ich erstelle eine PowerPoint mit dem Titel {request['title']}. "
                f"Die Folie heißt {request['slides'][0]['title']}. {readback}. "
                "Soll ich genau diese Präsentation erstellen? Sage Ja oder Nein.")
