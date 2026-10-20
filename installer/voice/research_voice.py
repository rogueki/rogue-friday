"""Local, speaker-gated Research commands through the native preview and approval path."""

import base64
import json
import re
import threading
import time
import urllib.error
import urllib.request
import uuid

from voice_runtime_paths import dashboard_port, voice_bridge_key_path


RESEARCH = re.compile(r"^(?:recherchiere|recherchiert bitte|suche quellen (?:zu|fuer)|research)\s+.+", re.I)
YES = re.compile(r"^(?:ja|ja bitte|bestaetige|bestätige|mach das|okay|ok)[.!?\s]*$", re.I)
NO = re.compile(r"^(?:nein|abbrechen|verwerfen)[.!?\s]*$", re.I)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class ResearchVoice:
    def __init__(self, root, now=time.monotonic, opener=None):
        self.root = root
        self.now = now
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.pending = None
        self.awaiting_approvals = []
        self.discard_threads = []

    def handles_text(self, text):
        return bool(self.pending or RESEARCH.fullmatch(text.strip()))

    def arm_confirmation(self):
        if self.pending and self.now() <= self.pending["expires"]:
            self.pending["armed"] = True

    def clear(self):
        self.pending = None

    def cancel(self):
        pending = self.pending
        self.pending = None
        awaiting = self.awaiting_approvals
        self.awaiting_approvals = []
        self._discard(([pending] if pending else []) + awaiting)

    def cancel_preview(self):
        pending = self.pending
        self.pending = None
        if pending:
            self._discard([pending])

    def _discard(self, to_discard):
        if not to_discard:
            return

        def discard(item):
            try:
                self._request({"text": item["text"], "source": "voice", "previewId": item["previewId"]},
                              timeout=2)
            except (OSError, ValueError, urllib.error.HTTPError):
                pass  # Local cancellation is immediate; the server keeps its own expiry and decision state.

        self.discard_threads = [thread for thread in self.discard_threads if thread.is_alive()]
        for item in to_discard:
            thread = threading.Thread(target=discard, args=(item,), daemon=True)
            self.discard_threads.append(thread)
            thread.start()

    def _request(self, body, key=None, timeout=12):
        with open(voice_bridge_key_path(self.root), encoding="ascii") as source:
            token = source.read().strip()
        if len(base64.b64decode(token, validate=True)) != 32:
            raise ValueError("invalid voice bridge key")
        headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json"}
        if key:
            headers["Idempotency-Key"] = key
        request = urllib.request.Request(
            f"http://127.0.0.1:{dashboard_port(self.root)}/api/v1/commands",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST",
        )
        with self.opener.open(request, timeout=timeout) as response:
            return json.load(response)

    def handle(self, text):
        words = text.strip()
        pending = self.pending
        if pending and self.now() > pending["expires"]:
            self.clear()
            if YES.fullmatch(words):
                return "Die Recherchevorschau ist abgelaufen. Bitte erneut beginnen."
            pending = None
        if pending and NO.fullmatch(words):
            self.clear()
            try:
                self._request({"text": pending["text"], "source": "voice", "previewId": pending["previewId"]})
            except (OSError, ValueError, urllib.error.HTTPError):
                return "Die Recherche ist lokal verworfen. Der Entwurf im Dashboard kann bis zum Ablauf bestehen bleiben."
            return "Die Recherche wurde verworfen."
        if pending and YES.fullmatch(words):
            if not pending["armed"]:
                self.cancel_preview()
                return "Die Recherchevorschau wurde unterbrochen. Bitte beginne erneut."
            self.clear()  # Consume before any uncertain network outcome; never auto-retry.
            try:
                result = self._request({"text": pending["text"], "source": "voice", "confirm": True,
                                        "previewId": pending["previewId"]}, pending["key"])
            except (OSError, ValueError, urllib.error.HTTPError):
                return "Das Rechercheergebnis ist unklar. Bitte im Dashboard prüfen, bevor du es erneut versuchst."
            if result.get("status") == "requires_approval":
                if result.get("approvalId"):
                    self.awaiting_approvals.append({"text": pending["text"], "previewId": pending["previewId"]})
                return "Die Recherche wartet auf Freigabe im Dashboard. Sie wurde noch nicht gestartet."
            if result.get("status") == "executed":
                return "Die Recherche wurde gestartet. Die Quellen und Ergebnisse erscheinen im Dashboard."
            return "Die Recherche wurde nicht gestartet. Bitte prüfe den Status im Dashboard."
        if pending:
            self.cancel_preview()
        if not RESEARCH.fullmatch(words):
            return None
        if len(self.awaiting_approvals) >= 16:
            return "Es warten bereits zu viele Sprachrecherchen auf Freigabe. Stoppe den Dialog oder entscheide sie im Dashboard."
        try:
            result = self._request({"text": words, "source": "voice"})
        except (OSError, ValueError, urllib.error.HTTPError):
            return "Die lokale Recherchevorschau ist gerade nicht erreichbar."
        if result.get("status") != "requires_confirmation" or not result.get("previewId") or not result.get("previewText"):
            return "Die Recherchevorschau konnte nicht erstellt werden. Es wurde nichts gestartet."
        self.pending = {"text": words, "previewId": result["previewId"],
                        "key": "idem_voice_research_" + uuid.uuid4().hex,
                        "expires": self.now() + 75, "armed": False}
        return result["previewText"] + " Soll ich genau diese Recherche beauftragen? Sage Ja oder Nein."
