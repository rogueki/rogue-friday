"""Speaker-gated, local-only calendar commands. Caller verifies every utterance."""

import base64
import datetime as dt
import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from content_studio_voice import dashboard_port
from voice_runtime_paths import voice_bridge_key_path


DATE_TIME = r"(?P<day>\d{1,2})\.(?P<month>\d{1,2})\.(?P<year>\d{4})\s+um\s+(?P<hour>\d{1,2})(?:[:.](?P<minute>\d{2}))?\s*Uhr"
CREATE = re.compile(r"^(?:friday[, ]+)?(?:erstelle|lege|mach)\s+(?:einen?\s+)?Termin\s+(?P<title>.+?)\s+am\s+" + DATE_TIME + r"(?:\s+f[uü]r\s+(?P<duration>\d{1,3})\s+Minuten)?[.!?]?\s*$", re.I)
MOVE = re.compile(r"^(?:friday[, ]+)?(?:verschiebe|[aä]ndere)\s+Termin\s+(?P<title>.+?)\s+auf\s+" + DATE_TIME + r"[.!?]?\s*$", re.I)
RENAME = re.compile(r"^(?:friday[, ]+)?(?:benenne|[aä]ndere)\s+Termin\s+(?P<title>.+?)\s+um\s+in\s+(?P<new_title>.+?)[.!?]?\s*$", re.I)
DELETE = re.compile(r"^(?:friday[, ]+)?(?:l[oö]sche|entferne)\s+Termin\s+(?P<title>.+?)[.!?]?\s*$", re.I)
YES = re.compile(r"^\s*(?:ja|ja bitte|best[aä]tige|best[aä]tigen|mach das|okay|ok)[.!?\s]*$", re.I)
NO = re.compile(r"^\s*(?:nein|abbrechen|stopp|stop|verwerfen)[.!?\s]*$", re.I)
CONNECTED = re.compile(r"\s+im\s+Kalender\s+(?P<name>[\wÄÖÜäöüß][\wÄÖÜäöüß -]{0,80})[.!?]?\s*$", re.I)
CORRECTION = re.compile(r"^\s*(?:nein[,.]?\s+)?(?:(?:ich\s+meinte|lieber|besser|stattdessen|doch)\s+)?(?P<rest>(?:am|um|f[uü]r)\s.+?)[.!?]?\s*$", re.I)
CORRECTION_DATE = re.compile(r"\bam\s+(?P<day>\d{1,2})\.(?P<month>\d{1,2})\.(?P<year>\d{4})\b", re.I)
CORRECTION_TIME = re.compile(r"\bum\s+(?P<hour>\d{1,2})(?:[:.](?P<minute>\d{2}))?\s*Uhr\b", re.I)
CORRECTION_DURATION = re.compile(r"\bf[uü]r\s+(?P<duration>\d{1,3})\s+Minuten\b", re.I)
REMINDER = "Die Terminvorschau wartet noch auf deine Antwort. Sage Ja, Nein oder eine Korrektur wie: nein, um 16 Uhr."


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class CalendarVoice:
    def __init__(self, root, now=time.monotonic, opener=None, zone="Europe/Berlin"):
        self.root = root
        self.now = now
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.zone = zone
        self.pending = None

    def arm_confirmation(self):
        # The caller invokes this only after TTS has finished the entire preview.
        if self.pending and self.now() <= self.pending["expires"]:
            self.pending["armed"] = True

    def _request(self, path, body, request_key=None):
        with open(voice_bridge_key_path(self.root), encoding="ascii") as source:
            raw_key = source.read().strip()
        if len(base64.b64decode(raw_key, validate=True)) != 32:
            raise ValueError("Voice-Bridge-Schluessel ungueltig")
        headers = {"Authorization": "Bearer " + raw_key, "Content-Type": "application/json", "Accept": "application/json"}
        if request_key:
            headers["Idempotency-Key"] = request_key
        voice_request = body.get("request", body)
        scope = "connected" if voice_request.get("calendarName") else "local"
        req = urllib.request.Request(f"http://127.0.0.1:{dashboard_port(self.root)}/api/v1/calendar/{scope}/voice/{path}",
                                     data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
        with self.opener.open(req, timeout=12) as response:
            return json.load(response)["data"]

    def _safe_request(self, path, body, request_key=None):
        try:
            return self._request(path, body, request_key), None
        except urllib.error.HTTPError as error:
            if error.code == 409:
                return None, "Der Termin ist nicht eindeutig, wurde geaendert oder die Bestaetigung ist abgelaufen. Bitte starte erneut."
            if error.code in (401, 403):
                return None, "Die Kalender-Sprachberechtigung fehlt. Pruefe den lokalen Voice-Dienst."
            if error.code == 422:
                return None, "Die Termindaten sind ungueltig. Bitte nenne Titel, Datum und Uhrzeit eindeutig."
            return None, f"Der lokale Kalender antwortet mit Fehler {error.code}."
        except (OSError, ValueError, KeyError, TimeoutError):
            return None, "Der lokale Kalender ist gerade nicht erreichbar."

    def _iso(self, match):
        zone = ZoneInfo(self.zone)
        local = dt.datetime(int(match["year"]), int(match["month"]), int(match["day"]), int(match["hour"]), int(match["minute"] or 0), tzinfo=zone)
        # Reject skipped or ambiguous wall-clock times during DST transitions.
        utc = local.astimezone(dt.timezone.utc)
        if utc.astimezone(zone).replace(tzinfo=None) != local.replace(tzinfo=None) or zone.utcoffset(local.replace(fold=0)) != zone.utcoffset(local.replace(fold=1)):
            raise ValueError("ambiguous local time")
        return utc.isoformat(timespec="seconds").replace("+00:00", "Z")

    def _corrected(self, request, rest):
        date = CORRECTION_DATE.search(rest)
        time_ = CORRECTION_TIME.search(rest)
        duration = CORRECTION_DURATION.search(rest)
        if not (date or time_ or duration):
            return None
        if request["action"] != "create" and not (request["action"] == "update" and "start" in request):
            raise ValueError("not correctable")
        if request["action"] == "update" and duration:
            raise ValueError("not correctable")
        zone = ZoneInfo(self.zone)
        start = dt.datetime.fromisoformat(request["start"].replace("Z", "+00:00")).astimezone(zone)
        parts = {"day": start.day, "month": start.month, "year": start.year, "hour": start.hour, "minute": start.minute}
        if date:
            parts["day"], parts["month"], parts["year"] = int(date["day"]), int(date["month"]), int(date["year"])
        if time_:
            parts["hour"], parts["minute"] = int(time_["hour"]), int(time_["minute"] or 0)
        corrected = dict(request)
        corrected["start"] = self._iso(parts)
        if request["action"] == "create":
            if duration:
                minutes = int(duration["duration"])
            else:
                seconds = (dt.datetime.fromisoformat(request["end"].replace("Z", "+00:00"))
                           - dt.datetime.fromisoformat(request["start"].replace("Z", "+00:00"))).total_seconds()
                minutes = int(seconds // 60)
            if not 1 <= minutes <= 480:
                raise ValueError("duration")
            corrected["end"] = (dt.datetime.fromisoformat(corrected["start"].replace("Z", "+00:00"))
                                + dt.timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")
        return corrected

    def _request_from_text(self, words):
        connected = CONNECTED.search(words)
        if connected:
            words = words[:connected.start()].rstrip(" .!?")
        account_name = connected["name"].strip() if connected else None
        if match := CREATE.fullmatch(words):
            start = dt.datetime.fromisoformat(self._iso(match).replace("Z", "+00:00"))
            duration = int(match["duration"] or 60)
            if not 1 <= duration <= 480:
                raise ValueError("duration")
            return {"action": "create", "title": match["title"].strip(), "start": start.isoformat().replace("+00:00", "Z"),
                    "end": (start + dt.timedelta(minutes=duration)).isoformat().replace("+00:00", "Z"), "timeZone": self.zone,
                    **({"calendarName": account_name} if account_name else {})}
        if match := MOVE.fullmatch(words):
            return {"action": "update", "targetTitle": match["title"].strip(), "start": self._iso(match), "timeZone": self.zone,
                    **({"calendarName": account_name} if account_name else {})}
        if match := RENAME.fullmatch(words):
            return {"action": "update", "targetTitle": match["title"].strip(), "title": match["new_title"].strip(),
                    **({"calendarName": account_name} if account_name else {})}
        if match := DELETE.fullmatch(words):
            return {"action": "delete", "targetTitle": match["title"].strip(),
                    **({"calendarName": account_name} if account_name else {})}
        return None

    def handle(self, text):
        words = text.strip()
        if self.pending and self.now() > self.pending["expires"]:
            self.pending = None
            if YES.fullmatch(words):
                return "Die Bestaetigungszeit ist abgelaufen. Bitte sage den Termin erneut."
        if self.pending and NO.fullmatch(words):
            self.pending = None
            return "Die Kalenderaenderung wurde verworfen."
        if self.pending and YES.fullmatch(words):
            if not self.pending["armed"]:
                self.pending = None
                return "Die Kalendervorschau wurde unterbrochen. Bitte beginne erneut."
            pending = self.pending
            confirmation = {"request": pending["request"], "token": pending["preview"]["token"]}
            if pending["request"].get("calendarName"):
                confirmation.update({key: pending["preview"][key] for key in ("accountId", "calendarId", "eventId", "etag")})
            else:
                confirmation.update({key: pending["preview"][key] for key in ("targetId", "version")})
            result, error = self._safe_request("confirm", confirmation, pending["key"])
            if error:
                if "nicht eindeutig" in error or "ungueltig" in error:
                    self.pending = None
                return error
            self.pending = None
            if pending["request"].get("calendarName"):
                if result.get("state") == "uncertain":
                    return "Das Ergebnis beim verbundenen Kalender ist unklar. Bitte im Dashboard prüfen, bevor du es erneut versuchst."
                return {"create": "Der Termin ist im verbundenen Kalender angelegt.",
                        "update": "Der verbundene Termin wurde geändert.",
                        "delete": "Der verbundene Termin wurde gelöscht."}[pending["request"]["action"]]
            return {"create": "Der Termin ist im lokalen Friday-Kalender angelegt.",
                    "update": "Der lokale Termin wurde geaendert.",
                    "delete": "Der lokale Termin wurde geloescht."}[pending["request"]["action"]]
        if self.pending and (correction := CORRECTION.fullmatch(words)):
            try:
                corrected = self._corrected(self.pending["request"], correction["rest"])
            except ValueError:
                return "Das kann ich in dieser Vorschau nicht korrigieren. Sage Nein und nenne den Termin neu."
            except ZoneInfoNotFoundError:
                return "Datum oder Uhrzeit sind nicht eindeutig, oder Zeitzonendaten fehlen. Bitte nenne einen gueltigen Termin."
            if corrected is not None:
                self.pending = None
                answer = self._preview(corrected)
                return "Korrigiert. " + answer if self.pending else answer
        try:
            request = self._request_from_text(words)
        except (ValueError, ZoneInfoNotFoundError):
            self.pending = None
            return "Datum oder Uhrzeit sind nicht eindeutig, oder Zeitzonendaten fehlen. Bitte nenne einen gueltigen Termin."
        if request is None:
            # An open preview is a question to the owner: keep it and ask again instead of dropping it silently.
            return REMINDER if self.pending else None
        self.pending = None
        return self._preview(request)

    def _preview(self, request):
        preview, error = self._safe_request("preview", request)
        if error:
            return error
        event = preview["event"]
        try:
            local_start = dt.datetime.fromisoformat(event["start"].replace("Z", "+00:00")).astimezone(ZoneInfo(event.get("timeZone", self.zone)))
            local_end = dt.datetime.fromisoformat(event["end"].replace("Z", "+00:00")).astimezone(ZoneInfo(event.get("timeZone", self.zone)))
            date_words = local_start.strftime("%d.%m.%Y um %H:%M Uhr")
            end_words = local_end.strftime("%d.%m.%Y um %H:%M Uhr")
        except (ValueError, ZoneInfoNotFoundError, KeyError):
            return "Die Kalendervorschau konnte nicht vorgelesen werden. Es wurde nichts geaendert."
        remaining = max(0, min(75, (dt.datetime.fromisoformat(preview["expiresAt"].replace("Z", "+00:00")) - dt.datetime.now(dt.timezone.utc)).total_seconds()))
        if remaining < 10:
            return "Die Kalendervorschau ist bereits abgelaufen. Bitte erneut beginnen."
        self.pending = {"request": request, "preview": preview, "key": "idem_voice_calendar_" + uuid.uuid4().hex,
                        "expires": self.now() + remaining, "armed": False}
        verb = {"create": "anlegen", "update": "aendern", "delete": "loeschen"}[request["action"]]
        location = f"im Kalender {preview['calendarName']}" if request.get("calendarName") else "im lokalen Friday-Kalender"
        return f"Ich werde den Termin {event['title']} {location} vom {date_words} bis {end_words} {verb}. Soll ich genau das tun? Sage Ja oder Nein."
