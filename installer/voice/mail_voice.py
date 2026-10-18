"""Bounded, speaker-gated German IMAP/SMTP voice commands."""
import base64
import datetime as dt
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from voice_runtime_paths import dashboard_port, voice_bridge_key_path

YES = re.compile(r"^(?:ja|ja bitte|best[aÃ¤]tige|best[aÃ¤]tigen|senden|mach das|okay|ok)[.!?\s]*$", re.I)
NO = re.compile(r"^(?:nein|abbrechen|stopp|stop|verwerfen)[.!?\s]*$", re.I)
LIST = re.compile(r"^(?:friday[, ]+)?(?:zeig(?:e)?|lies(?:t)?|finde|suche)\s+(?:(?P<kind>ungelesene|wichtige|markierte)\s+)?(?:(?:e-?)?mails?|nachrichten)(?:\s+(?:von|mit|zu)\s+(?P<term>.+))?[.!?\s]*$", re.I)
NUMBER = r"(?:[1-5]|eins|eine|zwei|drei|vier|f[Ã¼u]nf)"
READ = re.compile(r"^(?:friday[, ]+)?(?:lies|lese|[oÃ¶]ffne)\s+(?:(?:e-?)?mail|nachricht|mail)\s+(?P<number>" + NUMBER + r")[.!?\s]*$", re.I)
COMPOSE = re.compile(r"^(?:friday[, ]+)?(?:schreibe|sende)\s+(?:eine?\s+)?(?:e-?mail|mail)\s+an\s+(?P<to>.+?)\s+betreff\s+(?P<subject>.+?)\s+(?:text|inhalt)\s+(?P<body>.+)[.!?\s]*$", re.I)
REPLY = re.compile(r"^(?:friday[, ]+)?(?:antworte|antworten)\s+(?:auf\s+)?(?:(?:e-?)?mail|nachricht|mail)\s+(?P<number>" + NUMBER + r")\s+(?:mit|text)\s+(?P<body>.+)[.!?\s]*$", re.I)
MOVE = re.compile(r"^(?:friday[, ]+)?verschiebe\s+(?:(?:e-?)?mail|nachricht|mail)\s+(?P<number>" + NUMBER + r")\s+(?:in|nach)\s+(?P<folder>.+?)[.!?\s]*$", re.I)
FLAG = re.compile(r"^(?:friday[, ]+)?markiere\s+(?:(?:e-?)?mail|nachricht|mail)\s+(?P<number>" + NUMBER + r")\s+als\s+wichtig[.!?\s]*$", re.I)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class MailVoice:
    def __init__(self, root, now=time.monotonic, opener=None):
        self.root = root
        self.now = now
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.pending = None
        self.results = []
        self.results_expires = 0

    def clear(self):
        self.pending = None
        self.results = []
        self.results_expires = 0

    def handles_text(self, text):
        words = text.strip()
        return bool((self.pending and (YES.fullmatch(words) or NO.fullmatch(words))) or
                    any(pattern.fullmatch(words) for pattern in (LIST, READ, COMPOSE, REPLY, MOVE, FLAG)) or
                    re.search(r"\b(?:e-?mails?|mails?|postfach)\b", words, re.I))

    def arm_confirmation(self):
        if self.pending and self.now() <= self.pending["expires"]:
            self.pending["armed"] = True

    def _request(self, method, path, body=None, key=None):
        with open(voice_bridge_key_path(self.root), encoding="ascii") as source:
            raw_key = source.read().strip()
        if len(base64.b64decode(raw_key, validate=True)) != 32:
            raise ValueError("invalid bridge key")
        headers = {"Authorization": "Bearer " + raw_key, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if key:
            headers["Idempotency-Key"] = key
        url = f"http://127.0.0.1:{dashboard_port(self.root)}/api/v1/communication/himalaya/{path}"
        req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8") if body is not None else None,
                                     headers=headers, method=method)
        with self.opener.open(req, timeout=12 if method == "GET" else 35) as response:
            return json.load(response)["data"]

    def _safe(self, method, path, body=None, key=None):
        try:
            return self._request(method, path, body, key), None
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                return None, "Die lokale Mail-Sprachberechtigung fehlt."
            if error.code == 409:
                return None, "Die Nachricht wurde geaendert oder die Bestaetigung ist abgelaufen. Bitte erneut beginnen."
            if error.code == 422:
                return None, "Die Mailangaben sind ungueltig oder nicht eindeutig."
            return None, f"Der lokale Maildienst antwortet mit Fehler {error.code}."
        except (OSError, ValueError, KeyError, TimeoutError):
            return None, "Der lokale Maildienst ist gerade nicht erreichbar."

    def _selected(self, number):
        if self.now() > self.results_expires:
            self.results = []
        spoken = {"eins": 1, "eine": 1, "zwei": 2, "drei": 3, "vier": 4, "fÃ¼nf": 5, "funf": 5}
        index = spoken.get(number.casefold(), int(number) if number.isdecimal() else 0) - 1
        return self.results[index] if 0 <= index < len(self.results) else None

    @staticmethod
    def _recipient(words):
        if len(words) > 254:
            return ""
        value = words.strip().casefold()
        value = re.sub(r"\s*(?:@|\bat\b|\bät\b)\s*", "@", value)
        value = re.sub(r"\s*(?:\.|\bpunkt\b|\bdot\b)\s*", ".", value)
        return re.sub(r"\s+", "", value)

    def _preview(self, request):
        preview, error = self._safe("POST", "voice/preview", request)
        if error:
            return error
        remaining = min(75, (dt.datetime.fromisoformat(preview["expiresAt"].replace("Z", "+00:00")) - dt.datetime.now(dt.timezone.utc)).total_seconds())
        if remaining < 10:
            return "Die Mailvorschau ist abgelaufen. Bitte erneut beginnen."
        self.pending = {"request": request, "preview": preview, "key": "idem_voice_mail_" + uuid.uuid4().hex,
                        "expires": self.now() + remaining, "armed": False}
        if request["action"] in ("compose", "reply"):
            return (f"Vorschau. An {', '.join(preview['to'])}. Betreff {preview['subject']}. "
                    f"Text: {preview['body']}. Soll ich genau diese E-Mail senden? Sage Ja oder Nein.")
        if request["action"] == "move":
            return (f"Vorschau. Nachricht {preview['subject']} aus {preview['mailbox']} nach "
                    f"{preview['destination']} verschieben? Sage Ja oder Nein.")
        return f"Vorschau. Nachricht {preview['subject']} in {preview['mailbox']} als wichtig markieren? Sage Ja oder Nein."

    def handle(self, text):
        words = text.strip()
        if self.pending and self.now() > self.pending["expires"]:
            self.pending = None
            if YES.fullmatch(words):
                return "Die Bestaetigungszeit ist abgelaufen. Bitte erneut beginnen."
        if self.pending and NO.fullmatch(words):
            self.pending = None
            return "Die Mailaktion wurde verworfen."
        if self.pending and YES.fullmatch(words):
            pending = self.pending
            self.pending = None
            if not pending["armed"]:
                return "Die Mailvorschau wurde unterbrochen. Bitte erneut beginnen."
            result, error = self._safe("POST", "voice/confirm", {"request": pending["request"],
                                       "token": pending["preview"]["token"],
                                       "fingerprint": pending["preview"]["fingerprint"]}, pending["key"])
            if error:
                return error
            return {"sent": "Die E-Mail wurde gesendet.", "changed": "Die Mailaktion wurde ausgefuehrt.",
                    "unknown": "Das Ergebnis ist unklar. Bitte pruefe das Postfach, bevor du es erneut versuchst."}[result["state"]]
        if self.pending:
            self.pending = None
        if match := LIST.fullmatch(words):
            boxes, error = self._safe("GET", "mailboxes")
            if error:
                return error
            inbox = next((row for row in boxes["mailboxes"] if row["role"] == "inbox"), None)
            if inbox is None:
                return "Kein eindeutiger Posteingang ist eingerichtet."
            items = []
            for page in (1, 2):
                query = urllib.parse.urlencode({"mailbox": inbox["id"], "page": page})
                data, error = self._safe("GET", "envelopes?" + query)
                if error:
                    return error
                items.extend(data["items"])
                if len(data["items"]) < 25:
                    break
            kind = (match["kind"] or "").lower()
            term = (match["term"] or "").strip().casefold()
            def matches(row):
                flags = {str(flag).casefold() for flag in row.get("flags") or []}
                if kind == "ungelesene" and "seen" in flags:
                    return False
                if kind in ("wichtige", "markierte") and "flagged" not in flags:
                    return False
                haystack = row.get("subject", "") + " " + json.dumps(row.get("from", []), ensure_ascii=False)
                return not term or term in haystack.casefold()
            found = [row for row in items if matches(row)][:5]
            self.results = [{"mailbox": inbox["id"], "id": row["id"]} for row in found]
            self.results_expires = self.now() + 120
            if not found:
                return "In den ersten 50 Nachrichten habe ich keine passende Mail gefunden."
            labels = [f"{index}: {str(row.get('subject') or 'Ohne Betreff')[:100]}" for index, row in enumerate(found, 1)]
            return "In den ersten 50 Nachrichten gefunden: " + "; ".join(labels) + ". Sage zum Beispiel: Lies Mail eins."
        if match := READ.fullmatch(words):
            selected = self._selected(match["number"])
            if selected is None:
                return "Bitte suche zuerst eine Mail und waehle eine angezeigte Nummer."
            query = urllib.parse.urlencode(selected)
            data, error = self._safe("GET", "message?" + query)
            if error:
                return error
            return f"Mail {match['number']} von {data['from']}. Betreff {data['subject']}. Inhalt: {data['bodyText'][:500]}"
        if match := COMPOSE.fullmatch(words):
            recipient = self._recipient(match["to"].replace("(at)", "@").replace("[at]", "@"))
            if len(match["subject"]) > 200 or len(match["body"]) > 1000:
                return "Betreff oder Mailtext sind fuer die Sprachvorschau zu lang. Bitte kuerzer formulieren."
            return self._preview({"action": "compose", "to": [recipient], "subject": match["subject"], "body": match["body"]})
        for pattern, action in ((REPLY, "reply"), (MOVE, "move"), (FLAG, "flag")):
            if match := pattern.fullmatch(words):
                selected = self._selected(match["number"])
                if selected is None:
                    return "Bitte suche zuerst eine Mail und waehle eine angezeigte Nummer."
                request = {"action": action, **selected}
                if action == "reply":
                    if len(match["body"]) > 1000:
                        return "Der Antworttext ist fuer die Sprachvorschau zu lang. Bitte kuerzer formulieren."
                    request["body"] = match["body"]
                if action == "move":
                    boxes, error = self._safe("GET", "mailboxes")
                    if error:
                        return error
                    folders = [row for row in boxes["mailboxes"] if row["name"].casefold() == match["folder"].casefold()]
                    if len(folders) != 1:
                        return "Der Zielordner ist nicht eindeutig. Bitte nenne den genauen Ordnernamen."
                    request["destination"] = folders[0]["id"]
                return self._preview(request)
        if self.handles_text(words):
            return "Diesen Mailbefehl habe ich nicht eindeutig verstanden. Sage zum Beispiel: Zeige ungelesene Mails."
        return None
