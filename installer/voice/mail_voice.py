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

YES = re.compile(r"^(?:ja|ja bitte|best[aä]tige|best[aä]tigen|ja[,]? bitte senden|ja[,]? schick sie ab|senden|mach das|okay|ok)[.!?\s]*$", re.I)
NO = re.compile(r"^(?:nein|abbrechen|stopp|stop|verwerfen)[.!?\s]*$", re.I)
LIST = re.compile(r"^(?:friday[, ]+)?(?:zeig(?:e)?|lies(?:t)?|finde|suche)\s+(?:(?P<kind>ungelesene|wichtige|markierte)\s+)?(?:(?:e-?)?mails?|nachrichten)(?:\s+(?:von|mit|zu)\s+(?P<term>.+))?[.!?\s]*$", re.I)
NUMBER = r"(?:[1-5]|eins|eine|zwei|drei|vier|f[üu]nf)"
READ = re.compile(r"^(?:friday[, ]+)?(?:lies|lese|[oö]ffne)\s+(?:(?:e-?)?mail|nachricht|mail)\s+(?P<number>" + NUMBER + r")[.!?\s]*$", re.I)
COMPOSE = re.compile(r"^(?:friday[, ]+)?(?:schreibe|sende)\s+(?:eine?\s+)?(?:e-?mail|mail)\s+an\s+(?P<to>.+?)\s+betreff\s+(?P<subject>.+?)\s+(?:text|inhalt)\s+(?P<body>.+)[.!?\s]*$", re.I)
REPLY = re.compile(r"^(?:friday[, ]+)?(?:antworte|antworten)\s+(?:auf\s+)?(?:(?:e-?)?mail|nachricht|mail)\s+(?P<number>" + NUMBER + r")\s+(?:mit|text)\s+(?P<body>.+)[.!?\s]*$", re.I)
MOVE = re.compile(r"^(?:friday[, ]+)?verschiebe\s+(?:(?:e-?)?mail|nachricht|mail)\s+(?P<number>" + NUMBER + r")\s+(?:in|nach)\s+(?P<folder>.+?)[.!?\s]*$", re.I)
FLAG = re.compile(r"^(?:friday[, ]+)?markiere\s+(?:(?:e-?)?mail|nachricht|mail)\s+(?P<number>" + NUMBER + r")\s+als\s+wichtig[.!?\s]*$", re.I)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class MailVoice:
    def __init__(self, root, now=time.monotonic, opener=None, interpret=None):
        self.root = root
        self.now = now
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.pending = None
        self.results = []
        self.results_expires = 0
        self.selected = None
        self.draft = None
        self.interpret = interpret
        self.read_offset = 0
        self.followup = None
        self.account_id = None
        self.account_name = None

    def clear(self):
        self.pending = None
        self.results = []
        self.results_expires = 0
        self.selected = None
        self.draft = None
        self.read_offset = 0
        self.followup = None
        self.account_id = None
        self.account_name = None

    def clear_confirmation(self):
        self.pending = None

    def handles_text(self, text):
        words = text.strip()
        return bool(self.pending or self.draft or self.followup or self._current() or
                    any(pattern.fullmatch(words) for pattern in (LIST, READ, COMPOSE, REPLY, MOVE, FLAG)) or
                    re.search(r"\b(?:e-?mails?|mails?|postfach|posteingang|nachrichten?|antworte|antworten|zurueck|zurück|schick|schicken|verschicken|verfassen)\b", words, re.I) or
                    ((self.results or self.selected or self.draft or self.followup) and
                     re.search(r"\b(?:erste|zweite|dritte|vierte|fuenfte|fünfte|folgende|naechste|nächste|nummer|lies|lese|vortragen|vorlesen|darauf|davon|archiv|ablegen|betreff|text|schreiben)\b", words, re.I)))

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
        endpoint = path if path.startswith("/api/v1/") else "/api/v1/communication/himalaya/" + path
        url = f"http://127.0.0.1:{dashboard_port(self.root)}{endpoint}"
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
        spoken = {"eins": 1, "eine": 1, "zwei": 2, "drei": 3, "vier": 4, "fünf": 5, "funf": 5}
        index = spoken.get(number.casefold(), int(number) if number.isdecimal() else 0) - 1
        return self.results[index] if 0 <= index < len(self.results) else None

    def _current(self):
        if self.now() > self.results_expires:
            self.results = []
            self.selected = None
            self.read_offset = 0
        return self.selected

    def _read(self, selected, label):
        if selected.get("accountId"):
            query = urllib.parse.urlencode({"mailbox": selected["mailbox"], "uid": selected["id"],
                                            "uidValidity": selected["uidValidity"]})
            path = f"/api/v1/integrations/mail/accounts/{selected['accountId']}/message?" + query
        else:
            path = "message?" + urllib.parse.urlencode(selected)
        data, error = self._safe("GET", path)
        if error:
            return error
        self.selected = selected
        self.results_expires = self.now() + 120
        body = data["bodyText"]
        self.read_offset = min(500, len(body))
        suffix = " Sage Weiter fuer den naechsten Abschnitt." if self.read_offset < len(body) else ""
        return f"Mail {label} von {data['from']}. Betreff {data['subject']}. Inhalt: {body[:self.read_offset]}{suffix}"

    def _continue_read(self):
        selected = self._current()
        if not selected or not getattr(self, "read_offset", 0):
            return "Bitte waehle zuerst eine Mail zum Vorlesen."
        if selected.get("accountId"):
            query = urllib.parse.urlencode({"mailbox": selected["mailbox"], "uid": selected["id"],
                                            "uidValidity": selected["uidValidity"]})
            path = f"/api/v1/integrations/mail/accounts/{selected['accountId']}/message?" + query
        else:
            path = "message?" + urllib.parse.urlencode(selected)
        data, error = self._safe("GET", path)
        if error:
            return error
        body = data["bodyText"]
        start = self.read_offset
        if start >= len(body):
            return "Das war der ganze Nachrichtentext."
        self.read_offset = min(start + 500, len(body))
        suffix = " Sage Weiter fuer den naechsten Abschnitt." if self.read_offset < len(body) else ""
        return body[start:self.read_offset] + suffix

    @staticmethod
    def _reference_clause(words, reply=False):
        # Only the command/reference clause may select a UID. Numbers in the
        # dictated reply text (dates, times, quantities) are never targets.
        if reply or re.search(r"\b(?:antwort\w*|zurueck|zurück|bescheid)\b", words, re.I):
            body_start = re.search(r"\b(?:dass|mit|text|inhalt)\b[,:\s]+|\b(?:bescheid|darauf)\s*[,;:]", words, re.I)
            if body_start:
                return words[:body_start.start()]
        return words

    @staticmethod
    def _reference_number(words, reply=False):
        scope = MailVoice._reference_clause(words, reply=reply)
        values = {"eins": 1, "eine": 1, "erste": 1, "ersten": 1,
                  "zwei": 2, "zweite": 2, "zweiten": 2,
                  "drei": 3, "dritte": 3, "dritten": 3,
                  "vier": 4, "vierte": 4, "vierten": 4,
                  "fuenf": 5, "fünf": 5, "fuenfte": 5, "fünfte": 5,
                  "fuenften": 5, "fünften": 5}
        token = r"([1-5]|eins|eine|erste|ersten|zwei|zweite|zweiten|drei|dritte|dritten|vier|vierte|vierten|fuenf|fünf|fuenfte|fünfte|fuenften|fünften)"
        match = re.search(r"\b(?:mail|e-mail|nachricht|nummer|nr\.?)\s*" + token + r"\b", scope, re.I)
        if not match:
            match = re.search(r"\b(?:die|den)\s+" + token + r"\b", scope, re.I)
        if not match:
            return None
        value = match[1].casefold()
        return int(value) if value.isdecimal() else values[value]

    @staticmethod
    def _reference_conflict(words, reply=False):
        scope = MailVoice._reference_clause(words, reply=reply)
        return bool(re.search(r"\bdarauf\b", scope, re.I) and MailVoice._reference_number(words, reply=reply))

    @staticmethod
    def _search_term(words):
        for pattern in (r"\b(?:in deren|deren)\s+Betreff\s+(.+?)(?:\s+steht\b|[.!?]|$)",
                        r"\bBetreff\s+(.+?)(?:\s+steht\b|[.!?]|$)",
                        r"\b(?:von|mit|zu)\s+(.+?)(?:\s+habe ich|\s+gibt es|[.!?]|$)"):
            match = re.search(pattern, words, re.I)
            if match:
                return MailVoice._spoken_label(match[1])
        return ""

    def _natural_intent(self, words):
        lower = words.casefold().strip()
        if self._reference_conflict(words):
            return {"action": "reference_clarify"}
        number = self._reference_number(words)
        if re.fullmatch(r"(?:weiter|lies weiter|lese weiter|weiterlesen)[.!?\s]*", lower) and self._current():
            return {"action": "continue"}
        if re.search(r"\b(?:mail|e-mail|email|nachrichten?|posteingang|postfach)\b", lower) and re.search(r"\b(?:welche|was|zeig|zeige|habe ich|ungelesen)\b", lower):
            kind = "unread" if "ungelesen" in lower else "flagged" if "wichtig" in lower or "markiert" in lower else "all"
            return {"action": "list", "kind": kind, "term": self._search_term(words)}
        if (number or self._current()) and (re.search(r"\b(?:lies|lese|vorlesen|vortragen)\b", lower) or
                                            (number and re.match(r"^(?:und\s+)?(?:die|den)\b", lower))):
            return {"action": "read", "index": number or 0}
        reply_cue = (re.search(r"\b(?:antworte|antworten|zurueck|zurück)\b", lower) or
                     re.search(r"\b(?:gib|sag|sage|schreib)\s+(?:ihr|ihm|der absenderin|dem absender)\s+(?:bitte\s+)?bescheid\b", lower))
        if (number or self._current()) and reply_cue:
            body = (re.search(r"\bdass\b[,:\s]+(.+)$", words, re.I) or
                    re.search(r"\b(?:mit|zurueck|zurück)\b[,:\s]+(.+)$", words, re.I) or
                    re.search(r"\bbescheid\s*[,;:]\s*(.+)$", words, re.I))
            return {"action": "reply", "index": number or 0, "body": body[1].strip() if body else ""}
        if (number or self._current()) and re.search(r"\b(?:verschieb\w*|leg|lege|ablegen)\b", lower):
            folder = re.search(r"\b(?:ins?|nach)\s+(.+)$", words, re.I)
            return {"action": "move", "index": number or 0, "destination": self._spoken_label(folder[1]) if folder else ""}
        if (number or self._current()) and re.search(r"\bmarkier\w*\b", lower) and "wichtig" in lower:
            return {"action": "flag", "index": number or 0}
        if (not re.search(r"\b(?:zurueck|zurück|antwort\w*)\b", lower) and
                re.search(r"\b(?:schreib\w*|verfass\w*|sende|schreiben)\b", lower) and
                (re.search(r"\b(?:e-?mail|mail|nachricht)\b", lower) or "jemandem" in lower)):
            recipient = re.search(r"\ban\s+(.+?)(?:\s+betreff\b|$)", words, re.I)
            return {"action": "compose", "to": self._recipient(recipient[1]) if recipient else ""}
        return None

    def _model_intent(self, words):
        if not self.interpret or YES.fullmatch(words) or NO.fullmatch(words):
            return None
        if self._reference_conflict(words):
            return {"action": "reference_clarify"}
        context = {"results": len(self.results) if self.now() <= self.results_expires else 0,
                   "selected": bool(self._current()), "draftMissing": [name for name in ("to", "subject", "body")
                   if self.draft is not None and not self.draft.get(name)]}
        try:
            value = self.interpret(words[:1000], context)
        except (OSError, ValueError, KeyError, TimeoutError):
            return None
        if not isinstance(value, dict) or set(value) != {"action"}:
            return None
        action = value["action"]
        if action not in {"list", "read", "continue", "compose", "reply", "move", "flag", "none"}:
            return None
        if action == "reply" and self._reference_conflict(words, reply=True):
            return {"action": "reference_clarify"}
        number = self._reference_number(words, reply=action == "reply")
        if number and number > context["results"]:
            return {"action": "none"}
        if action == "none":
            return value
        if action == "continue":
            return {"action": "read", "index": number} if number else value
        if action == "list":
            lower = words.casefold()
            kind = "unread" if "ungelesen" in lower else "flagged" if "wichtig" in lower or "markiert" in lower else "all"
            return {"action": "list", "kind": kind, "term": self._search_term(words)}
        if action in {"read", "reply", "move", "flag"} and not (number or self._current()):
            return {"action": action, "index": 0}
        intent = {"action": action, "index": number or 0}
        if action == "reply":
            body = (re.search(r"\bdass\b[,:\s]+(.+)$", words, re.I) or
                    re.search(r"\bmit\b[,:\s]+(.+)$", words, re.I) or
                    re.search(r"\bbescheid\s*[,;:]\s*(.+)$", words, re.I))
            intent["body"] = body[1].strip() if body else ""
        elif action == "move":
            folder = re.search(r"\b(?:ins?|nach)\s+(.+)$", words, re.I)
            intent["destination"] = self._spoken_label(folder[1]) if folder else ""
        elif action == "compose":
            recipient = re.search(r"\ban\s+(.+?)(?:\s+betreff\b|$)", words, re.I)
            intent["to"] = self._recipient(recipient[1]) if recipient else ""
        return intent

    def _run_intent(self, intent):
        action = intent["action"]
        if action == "reference_clarify":
            return "Meinst du die zuletzt ausgewaehlte Mail oder die genannte Nummer?"
        if action == "none":
            return "Welche Mailaktion meinst du genau?"
        if action == "continue":
            return self._continue_read()
        if action == "list":
            kind = {"unread": "ungelesene ", "flagged": "wichtige ", "all": ""}.get(intent.get("kind", "all"))
            if kind is None:
                return "Welche Nachrichten soll ich suchen?"
            term = self._spoken_label(intent.get("term", ""))
            return self.handle(f"Zeige {kind}Mails" + (f" mit {term}" if term else ""))
        if action == "compose":
            self.draft = {"to": self._recipient(intent.get("to", "")), "subject": intent.get("subject", ""),
                          "body": intent.get("body", "")}
            self.draft_expires = self.now() + 120
            return self._draft_step("")
        selected = self._selected(str(intent.get("index", 0))) if intent.get("index", 0) else self._current()
        if not selected:
            return "Welche Mail meinst du? Bitte nenne eine angezeigte Nummer."
        self.selected = selected
        self.results_expires = self.now() + 120
        if action == "read":
            return self._read(selected, str(intent.get("index") or "ausgewaehlt"))
        if action == "reply":
            body = intent.get("body", "").strip()
            if not body:
                self.followup = {"action": "reply", "selected": selected, "expires": self.now() + 120}
                return "Was soll ich antworten?"
            if len(body) > 1000:
                return "Der Antworttext ist fuer die Sprachvorschau zu lang. Bitte kuerzer formulieren."
            return self._preview({"action": "reply", **selected, "body": body})
        if action == "move":
            folder_name = self._spoken_label(intent.get("destination", ""))
            if not folder_name:
                self.followup = {"action": "move", "selected": selected, "expires": self.now() + 120}
                return "In welchen bestehenden Ordner soll ich die Mail verschieben?"
            boxes, error = self._safe("GET", f"/api/v1/integrations/mail/accounts/{selected['accountId']}/folders"
                                      if selected.get("accountId") else "mailboxes")
            if error:
                return error
            folders = [row for row in boxes.get("folders", boxes.get("mailboxes", []))
                       if row["name"].casefold() == folder_name.casefold()]
            if len(folders) != 1:
                return "Der Zielordner ist nicht eindeutig. Bitte nenne den genauen Ordnernamen."
            return self._preview({"action": "move", **selected, "destination": folders[0]["id"]})
        if action == "flag":
            return self._preview({"action": "flag", **selected})
        return "Welche Mailaktion meinst du genau?"

    def _draft_step(self, words):
        if self.now() > getattr(self, "draft_expires", 0):
            self.draft = None
            return "Der Mailentwurf ist abgelaufen. Bitte beginne erneut."
        if words:
            if YES.fullmatch(words):
                words = ""
            elif re.match(r"^(?:wie|was|wer|welche[rsn]?|wieviel|erzähl|erzaehl|spiele|stell|öffne|oeffne|recherchiere)\b", words, re.I):
                self.draft = None
                return None
        if words:
            if not self.draft["to"]:
                candidate = re.sub(r"^(?:an|empfaenger(?:in)? ist)\s+", "", words, flags=re.I)
                self.draft["to"] = self._recipient(candidate)
            elif not self.draft["subject"]:
                self.draft["subject"] = re.sub(r"^betreff\s*[:]?\s*", "", words, flags=re.I).strip()
            else:
                self.draft["body"] = re.sub(r"^(?:text|inhalt)\s*[:]?\s*", "", words, flags=re.I).strip()
            self.draft_expires = self.now() + 120
        if not self.draft["to"] or "@" not in self.draft["to"]:
            self.draft["to"] = ""
            return "An welche vollstaendige E-Mail-Adresse soll ich schreiben?"
        if not self.draft["subject"]:
            return "Welchen Betreff soll die Mail haben?"
        if not self.draft["body"]:
            return "Was soll im Nachrichtentext stehen?"
        if len(self.draft["subject"]) > 200 or len(self.draft["body"]) > 1000:
            self.draft = None
            return "Betreff oder Mailtext sind fuer die Sprachvorschau zu lang. Bitte kuerzer formulieren."
        draft = self.draft
        self.draft = None
        return self._preview({"action": "compose", "to": [draft["to"]], "subject": draft["subject"], "body": draft["body"],
                              **({"accountId": self.account_id} if self.account_id else {})})

    @staticmethod
    def _recipient(words):
        if len(words) > 254:
            return ""
        value = words.strip().casefold()
        value = re.sub(r"\s*(?:@|\bat\b|\bät\b)\s*", "@", value)
        value = re.sub(r"\s*(?:\.|\bpunkt\b|\bdot\b)\s*", ".", value)
        return re.sub(r"\s+", "", value)

    @staticmethod
    def _spoken_label(words):
        # ASR often adds sentence punctuation to a search term or folder name.
        value = words.strip().rstrip(".!? ").strip()
        if len(value) >= 2 and (value[0], value[-1]) in (("\"", "\""), ("„", "“"), ("«", "»")):
            value = value[1:-1].strip()
        return value

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
            return (f"Vorschau aus {preview.get('accountName', 'Mail Postfach')}. An {', '.join(preview['to'])}. Betreff {preview['subject']}. "
                    f"Text: {preview['body']}. Soll ich genau diese E-Mail senden? Sage Ja oder Nein.")
        if request["action"] == "move":
            return (f"Vorschau. Nachricht {preview['subject']} aus {preview['mailbox']} nach "
                    f"{preview['destination']} verschieben? Sage Ja oder Nein.")
        return f"Vorschau. Nachricht {preview['subject']} in {preview['mailbox']} als wichtig markieren? Sage Ja oder Nein."

    def _revise_pending(self, words, pending):
        request = pending["request"].copy()
        action = request["action"]
        subject = re.search(r"\b(?:änder\w*|aender\w*|korrigier\w*)\s+(?:den\s+)?betreff\s+(?:auf|zu)\s+(.+)$", words, re.I)
        body = re.search(r"\b(?:schreib\w*|sag\w*|text|inhalt)\s+(?:doch\s+)?(?:lieber|stattdessen|auf|zu)\s+(.+)$", words, re.I)
        if subject and action == "compose":
            request["subject"] = self._spoken_label(subject[1])
        elif body and action in ("compose", "reply"):
            request["body"] = body[1].strip()
        elif subject and action == "reply":
            return "Bei einer Antwort kann ich den Betreff nicht aendern. Was soll ich am Text aendern?"
        else:
            return None
        if not request.get("subject", "").strip() or not request.get("body", "").strip() or len(request.get("subject", "")) > 200 or len(request["body"]) > 1000:
            return "Die Korrektur ist leer oder zu lang. Bitte formuliere die Mailaktion erneut."
        return self._preview(request)

    def handle(self, text):
        words = text.strip()
        if not (self.pending or self.draft or self.followup) and (YES.fullmatch(words) or NO.fullmatch(words)):
            return None
        if self.pending and self.now() > self.pending["expires"]:
            self.pending = None
            if YES.fullmatch(words):
                return "Die Bestaetigungszeit ist abgelaufen. Bitte erneut beginnen."
        if self.pending and NO.fullmatch(words):
            self.pending = None
            self.draft = None
            self.followup = None
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
            pending = self.pending
            self.pending = None
            revised = self._revise_pending(words, pending)
            return revised or "Die Mailvorschau wurde verworfen. Bitte formuliere die Aktion erneut."
        if self.followup is not None:
            if (re.match(r"^(?:wie|was|wer|welche[rsn]?|wieviel|erzähl|erzaehl|spiele|stell|öffne|oeffne|recherchiere)\b", words, re.I) and
                    not re.search(r"\b(?:mail|nachricht|postfach|posteingang|antwort|betreff)\b", words, re.I)):
                self.followup = None
                return None
            new_intent = self._natural_intent(words)
            if new_intent and new_intent["action"] in {"list", "compose", "read", "flag"}:
                self.followup = None
                return self._run_intent(new_intent)
            followup = self.followup
            self.followup = None
            if self.now() > followup["expires"] or self._current() != followup["selected"]:
                return "Die Nachrichtenauswahl ist abgelaufen. Bitte suche erneut."
            if NO.fullmatch(words):
                return "Die Mailaktion wurde verworfen."
            if YES.fullmatch(words):
                return "Bitte nenne erst den Text oder den Zielordner."
            if followup["action"] == "reply":
                return self._run_intent({"action": "reply", "body": words})
            return self._run_intent({"action": "move", "destination": words})
        if self.draft is not None:
            if NO.fullmatch(words):
                self.draft = None
                return "Der Mailentwurf wurde verworfen."
            return self._draft_step(words)
        choice = re.fullmatch(r"(?:friday[, ]+)?(?:nimm|nutze|benutze|waehle|wähle)\s+(?:(?:mein|das|den)\s+)?(.+?)[.!?\s]*", words, re.I)
        if choice and re.search(r"(?:postfach|mail|konto)", choice[1], re.I):
            catalog, error = self._safe("GET", "/api/v1/integrations/mail/accounts")
            if error:
                return error
            label = self._spoken_label(choice[1]).casefold()
            matches = [row for row in catalog["accounts"] if row["displayName"].casefold() == label or
                       row["email"].casefold() == label]
            if len(matches) != 1:
                return "Dieses Mail Postfach ist nicht eindeutig. Bitte nenne den vollständigen Kontonamen."
            self.account_id = matches[0]["id"]
            self.account_name = matches[0]["displayName"]
            self.results = []
            self.selected = None
            self.followup = None
            return f"Ich nutze jetzt {self.account_name}. Welche Mailaktion möchtest du?"
        if match := LIST.fullmatch(words):
            boxes, error = self._safe("GET", f"/api/v1/integrations/mail/accounts/{self.account_id}/folders"
                                      if self.account_id else "mailboxes")
            if error:
                return error
            inbox = next((row for row in boxes.get("folders", boxes.get("mailboxes", []))
                          if row["role"] == "inbox" or row["id"].casefold() == "inbox"), None)
            if inbox is None:
                return "Kein eindeutiger Posteingang ist eingerichtet."
            items = []
            for page in (1, 2):
                query = urllib.parse.urlencode({"mailbox": inbox["id"], "page": page})
                path = f"/api/v1/integrations/mail/accounts/{self.account_id}/envelopes?" + query if self.account_id else "envelopes?" + query
                data, error = self._safe("GET", path)
                if error:
                    return error
                items.extend(data["items"])
                if len(data["items"]) < 25:
                    break
            kind = (match["kind"] or "").lower()
            term = self._spoken_label(match["term"] or "").casefold()
            if match["term"] and not term:
                return "Bitte nenne einen Suchbegriff."
            def matches(row):
                flags = {str(flag).casefold() for flag in row.get("flags") or []}
                if kind == "ungelesene" and "seen" in flags:
                    return False
                if kind in ("wichtige", "markierte") and "flagged" not in flags:
                    return False
                haystack = row.get("subject", "") + " " + json.dumps(row.get("from", []), ensure_ascii=False)
                return not term or term in haystack.casefold()
            found = [row for row in items if matches(row)][:5]
            self.results = [{"mailbox": inbox["id"], "id": row["id"],
                             **({"accountId": self.account_id, "uidValidity": data["uidValidity"]} if self.account_id else {})}
                            for row in found]
            self.selected = None
            self.read_offset = 0
            self.results_expires = self.now() + 120
            if not found:
                return "In den ersten 50 Nachrichten habe ich keine passende Mail gefunden."
            labels = [f"{index}: {str(row.get('subject') or 'Ohne Betreff')[:100]}" for index, row in enumerate(found, 1)]
            return "In den ersten 50 Nachrichten gefunden: " + "; ".join(labels) + ". Sage zum Beispiel: Lies Mail eins."
        if match := READ.fullmatch(words):
            selected = self._selected(match["number"])
            if selected is None:
                return "Bitte suche zuerst eine Mail und waehle eine angezeigte Nummer."
            return self._read(selected, match["number"])
        if match := COMPOSE.fullmatch(words):
            recipient = self._recipient(match["to"].replace("(at)", "@").replace("[at]", "@"))
            if len(match["subject"]) > 200 or len(match["body"]) > 1000:
                return "Betreff oder Mailtext sind fuer die Sprachvorschau zu lang. Bitte kuerzer formulieren."
            return self._preview({"action": "compose", "to": [recipient], "subject": match["subject"], "body": match["body"],
                                  **({"accountId": self.account_id} if self.account_id else {})})
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
                    boxes, error = self._safe("GET", f"/api/v1/integrations/mail/accounts/{selected['accountId']}/folders"
                                              if selected.get("accountId") else "mailboxes")
                    if error:
                        return error
                    folder_name = self._spoken_label(match["folder"])
                    folders = [row for row in boxes.get("folders", boxes.get("mailboxes", []))
                               if folder_name and row["name"].casefold() == folder_name.casefold()]
                    if len(folders) != 1:
                        return "Der Zielordner ist nicht eindeutig. Bitte nenne den genauen Ordnernamen."
                    request["destination"] = folders[0]["id"]
                return self._preview(request)
        intent = self._natural_intent(words) or self._model_intent(words)
        if intent is not None:
            if intent["action"] == "none" and not self._mail_words(words):
                return None
            return self._run_intent(intent)
        if self._mail_words(words):
            return "Welche Mailaktion meinst du: suchen, vorlesen, antworten, schreiben oder verschieben?"
        return None

    @staticmethod
    def _mail_words(words):
        return bool(re.search(r"\b(?:(?:e-?)?mails?|nachrichten?|postfach|posteingang|antwort\w*|zurueck|zurück|betreff|darauf|davon|ungelesen\w*|archiv|verschieb\w*|vorlesen|nummer\s*[1-5])\b", words, re.I))
