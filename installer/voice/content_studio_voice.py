"""Small, speaker-gated voice client for Content Studio production jobs.

The caller must verify the speaker before invoking ``handle``. The bridge key only
authorizes four local Content Studio operations; it is never sent to Hermes.
"""

import base64
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.request
import uuid

from voice_runtime_paths import content_studio_state_path, dashboard_port, voice_bridge_key_path


SUPPORTED = {"Feed-Post", "LinkedIn-Video", "YouTube-Video", "Story", "Reel", "TikTok-Video", "YouTube-Short"}
CREATE = re.compile(r"\b(erstelle|produziere|generiere|mach|starte)\b.*\b(story|reel|video|post|content|inhalt)\b", re.I)
STATUS = re.compile(r"\b(produktionsstatus|auftragsstatus|videostatus|contentstatus)\b|\b(content|studio|produktion|video|auftrag)\b.*\b(status|stand|fertig|fortschritt)\b|\b(status|stand|fortschritt)\b.*\b(content|studio|produktion|video|auftrag)\b", re.I)
CANCEL = re.compile(r"\b(auftrag|produktion|video)\b.*\b(abbrechen|stoppen|stornieren)\b|\b(brich|stoppe|storniere)\b.*\b(auftrag|produktion|video)\b", re.I)
PUBLISH = re.compile(r"\b(ver[oö]ffentlich|hochlad|upload|poste?)\w*\b.*\b(story|reel|video|post|instagram|facebook|tiktok|youtube)\b", re.I)
YES = re.compile(r"^\s*(ja|best[aä]tige|starte|mach es|leg los|okay|ok)(?:\s+(?:den|die|das|auftrag|jetzt|bitte|start))?[.!?\s]*$", re.I)
NO = re.compile(r"^\s*(nein|abbrechen|stopp|stop|verwerfen)[.!?\s]*$", re.I)


def _normal(value):
    return "".join(ch for ch in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(ch))


class ContentStudioVoice:
    def __init__(self, root, now=time.monotonic, opener=None):
        self.root = root
        self.now = now
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.pending = None
        self.last_job_id = None
        self.state_file = content_studio_state_path(root)
        try:
            with open(self.state_file, encoding="utf-8") as source:
                saved_id = json.load(source).get("last_job_id")
            if isinstance(saved_id, str) and re.fullmatch(r"[0-9a-f-]{36}", saved_id):
                self.last_job_id = saved_id
        except (OSError, ValueError, AttributeError):
            pass

    def _remember_job(self, job_id):
        self.last_job_id = job_id
        try:
            os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
            partial = self.state_file + ".partial"
            with open(partial, "w", encoding="utf-8") as target:
                json.dump({"last_job_id": job_id}, target)
            os.replace(partial, self.state_file)
        except OSError:
            pass  # The current session still knows the job; the dashboard remains the source of truth.

    def _request(self, method, path, body=None, request_key=None):
        with open(voice_bridge_key_path(self.root), encoding="ascii") as source:
            raw_key = source.read().strip()
        if len(base64.b64decode(raw_key, validate=True)) != 32:
            raise ValueError("Ungültiger Voice-Bridge-Schlüssel")
        headers = {"Authorization": "Bearer " + raw_key, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if request_key:
            headers["Idempotency-Key"] = request_key
        request = urllib.request.Request(
            f"http://127.0.0.1:{dashboard_port(self.root)}/api/v1/content-studio/{path}",
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            headers=headers, method=method,
        )
        with self.opener.open(request, timeout=12) as response:
            return json.load(response)["data"]

    def _safe_request(self, *args, **kwargs):
        try:
            return self._request(*args, **kwargs), None
        except urllib.error.HTTPError as error:
            if error.code == 403:
                return None, "Das Content Studio ist deaktiviert oder die Sprachberechtigung fehlt."
            if error.code == 409:
                return None, "Der Content-Plan wurde geändert. Bitte starte die Auswahl erneut."
            return None, f"Das Content Studio antwortet mit Fehler {error.code}."
        except (OSError, ValueError, KeyError, TimeoutError):
            return None, "Das Content Studio ist gerade nicht erreichbar."

    def handle(self, text):
        words = text.strip()
        if self.pending and self.now() > self.pending["expires"]:
            self.pending = None
        if self.pending and NO.fullmatch(words):
            self.pending = None
            return "Der noch nicht gestartete Produktionsauftrag ist verworfen."
        if self.pending and YES.fullmatch(words):
            if self.pending["stage"] == "choose":
                return "Nenne bitte den Titel der Content-Idee."
            pending = self.pending
            job, error = self._safe_request("POST", "production-jobs", {
                "ideaId": pending["idea_id"], "planRevision": pending["revision"], "confirmed": True,
            }, request_key=pending["request_key"])
            if error:
                if "geändert" in error:
                    self.pending = None
                return error + " Bei unklarem Ausgang kann dieselbe Bestätigung den Auftrag sicher wiederfinden."
            self.pending = None
            self._remember_job(job["id"])
            return "Der Produktionsauftrag ist gestartet. Ich übernehme Medien, Stimme und Schnitt. Frage mich nach dem Produktionsstatus."
        if CANCEL.search(words):
            if self.pending:
                self.pending = None
                return "Der noch nicht gestartete Produktionsauftrag ist verworfen."
            if not self.last_job_id:
                return "Ich habe keinen laufenden Produktionsauftrag in dieser Sprachsitzung."
            job, error = self._safe_request("POST", f"production-jobs/{self.last_job_id}/cancel")
            return error or ("Der Auftrag ist gestoppt. Bereits gesendete Anbieteraufrufe lassen sich nicht zurücknehmen." if job["state"] == "cancelled" else "Der Auftrag war bereits abgeschlossen.")
        if STATUS.search(words):
            if not self.last_job_id:
                return "Ich habe noch keinen Produktionsauftrag in dieser Sprachsitzung gestartet."
            job, error = self._safe_request("GET", f"production-jobs/{self.last_job_id}")
            if error:
                return error
            labels = {"queued": "eingereiht", "submitting": "beim Medienanbieter", "provider_pending": "in Medienerzeugung", "downloading": "beim Download", "speech_submitting": "bei der Stimmerzeugung", "editing": "im Videoschnitt", "completed": "fertig", "failed": "fehlgeschlagen", "cancelled": "abgebrochen", "provider_unknown": "beim Medienanbieter unklar", "speech_unknown": "bei der Stimmerzeugung unklar"}
            return "Der Produktionsauftrag ist " + labels.get(job["state"], job["state"]) + (". Das MP4 liegt im Dashboard bereit." if job["state"] == "completed" else ".")
        if PUBLISH.search(words):
            return "Automatisches Veröffentlichen ist noch nicht eingerichtet. Dafür müssen die Zielkonten einmalig verbunden werden."
        if self.pending and self.pending["stage"] == "choose":
            matches = [idea for idea in self.pending["ideas"] if _normal(idea["titel"]) in _normal(words)]
            if len(matches) == 1:
                return self._preview(matches[0], self.pending["revision"])
        if not CREATE.search(words):
            return None
        state, error = self._safe_request("GET", "plan")
        if error:
            return error
        ideas = [idea for idea in (state.get("plan") or {}).get("content", []) if idea.get("format") in SUPPORTED]
        if not ideas:
            return "Im Content Studio gibt es noch keine unterstützte Idee. Lege zuerst eine Idee im Dashboard an."
        matching = [idea for idea in ideas if _normal(idea["titel"]) in _normal(words)]
        format_words = _normal(words)
        if not matching:
            matching = [idea for idea in ideas if _normal(idea["format"]) in format_words]
        if len(matching) == 1:
            return self._preview(matching[0], state["revision"])
        if len(ideas) == 1:
            return self._preview(ideas[0], state["revision"])
        self.pending = {"stage": "choose", "ideas": ideas, "revision": state["revision"], "expires": self.now() + 90}
        titles = ", ".join(idea["titel"] for idea in ideas[:3])
        return "Welche Content-Idee meinst du? Zum Beispiel: " + titles + "."

    def _preview(self, idea, revision):
        self.pending = {"stage": "confirm", "idea_id": idea["id"], "revision": revision,
                        "request_key": "idem_voice_" + uuid.uuid5(uuid.NAMESPACE_URL, f"friday-content:{idea['id']}:{revision}").hex,
                        "expires": self.now() + 90}
        return f"Ich kann {idea['titel']} als {idea['format']} automatisch produzieren. kie.ai und ElevenLabs können Kosten verursachen. Soll ich genau diesen Auftrag starten?"
