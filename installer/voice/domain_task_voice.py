"""Long spoken requests become durable tasks on a domain agent through the Control API."""

import base64
import json
import re
import time
import urllib.error
import urllib.request
import uuid

from voice_runtime_paths import dashboard_port, voice_bridge_key_path


FINAL = frozenset({"done", "failed", "cancelled"})
# First match wins: audit before alerts before research; anything else goes to the tasks agent.
DOMAIN_PATTERNS = [
    ("audit", re.compile(r"\b(pruef|prüf|ueberpruef|überprüf|kontrollier|audit|nachweis)", re.I)),
    ("alerts", re.compile(r"\b(warn|alarm|ueberwach|überwach|schwellenwert)", re.I)),
    ("research", re.compile(r"\b(recherch|such|finde heraus|vergleich|informier|quellen)", re.I)),
]
AGENT_LABEL = {"research": "Recherche-Agenten", "tasks": "Aufgaben-Agenten", "alerts": "Warn-Agenten",
               "audit": "Pruef-Agenten"}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def classify_domain(text: str) -> str:
    for domain, pattern in DOMAIN_PATTERNS:
        if pattern.search(text):
            return domain
    return "tasks"


def result_text(job: dict) -> str:
    status = job.get("status")
    if status == "failed":
        error = (job.get("error") or "").strip()
        return "Die Aufgabe ist fehlgeschlagen" + (": " + error if error else "") + "."
    if status == "cancelled":
        return "Die Aufgabe wurde abgebrochen."
    summary = (job.get("resultSummary") or "").strip()
    return summary or "Die Aufgabe ist erledigt; das Ergebnis steht im Dashboard."


class DomainTaskVoice:
    def __init__(self, root, opener=None, now=time.monotonic, sleep=time.sleep):
        self.root = root
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.now = now
        self.sleep = sleep

    def _request(self, method, path, body=None, key=None, timeout=12):
        with open(voice_bridge_key_path(self.root), encoding="ascii") as source:
            token = source.read().strip()
        if len(base64.b64decode(token, validate=True)) != 32:
            raise ValueError("invalid voice bridge key")
        headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json",
                   "Accept": "application/json"}
        if key:
            headers["Idempotency-Key"] = key
        request = urllib.request.Request(
            f"http://127.0.0.1:{dashboard_port(self.root)}{path}",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None,
            headers=headers, method=method,
        )
        with self.opener.open(request, timeout=timeout) as response:
            return json.load(response)["data"]

    def create(self, text, domain) -> dict:
        return self._request("POST", "/api/v1/voice/tasks", {"text": text, "domain": domain},
                             key="voice-task-" + uuid.uuid4().hex)

    def status(self, task_id) -> dict:
        return self._request("GET", f"/api/v1/voice/tasks/{task_id}")

    def wait(self, task_id, cancelled, poll_s=10.0, timeout_s=1800.0) -> dict | None:
        deadline = self.now() + timeout_s
        errors = 0
        while True:
            job = None
            try:
                job = self.status(task_id)
                errors = 0
            except (OSError, ValueError, urllib.error.HTTPError):
                errors += 1
                if errors >= 3:
                    return None
            if job is not None and job.get("status") in FINAL:
                return job
            if cancelled() or self.now() >= deadline:
                return None
            # Sleep in short steps so a spoken "Stopp" takes effect at once instead of after poll_s.
            slept = 0.0
            while slept < poll_s:
                if cancelled():
                    return None
                step = min(0.5, poll_s - slept)
                self.sleep(step)
                slept += step
