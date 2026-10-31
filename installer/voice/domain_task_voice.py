"""Long spoken requests become durable tasks on a domain agent through the Control API."""

import base64
import json
import os
import re
import threading
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
AGENT_LABEL_SHORT = {"research": "Recherche", "tasks": "Aufgaben", "alerts": "Warnungen", "audit": "Pruefung"}
# Status and named cancellation are answered from the local task cache; a plain "Stopp" stays dialog-only.
STATUS_QUESTION = re.compile(r"\b(wie weit|was macht|status|stand)\b.*\b(auftrag|auftr(ae|ä)ge|aufgabe|recherche|agent|pr(ue|ü)fung|ueberwachung|überwachung)", re.I)
CANCEL_COMMAND = re.compile(r"^\s*(?:brich|breche)\s+(.+?)\s+ab[.!?\s]*$|^\s*(?:stoppe|beende)\s+(?:die|den|das)\s+(.+?)[.!?\s]*$", re.I)
DOMAIN_WORDS = {"research": re.compile(r"recherch", re.I), "audit": re.compile(r"pr(ue|ü)f", re.I),
                "alerts": re.compile(r"warn|(ue|ü)berwach", re.I), "tasks": re.compile(r"aufgabe|auftrag", re.I)}
AGENT_NAME = {"research": "Der Recherche-Agent", "tasks": "Der Aufgaben-Agent", "alerts": "Der Warn-Agent",
              "audit": "Der Pruef-Agent"}
STATUS_LABEL = {"triage": "wird eingeordnet", "todo": "wartet", "ready": "wartet auf einen freien Platz",
                "running": "arbeitet", "waiting": "wartet auf eine Eingabe", "review": "wartet auf Pruefung"}


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
    question = str(job.get("question") or "").strip()
    if status == "waiting" and question:
        return "Rueckfrage: " + question
    if status == "failed":
        error = (job.get("error") or "").strip()
        return "Die Aufgabe ist fehlgeschlagen" + (": " + error if error else "") + "."
    if status == "cancelled":
        return "Die Aufgabe wurde abgebrochen."
    summary = (job.get("resultSummary") or "").strip()
    return summary or "Die Aufgabe ist erledigt; das Ergebnis steht im Dashboard."


class DomainTaskVoice:
    def __init__(self, root, opener=None, now=time.monotonic, sleep=time.sleep, wall=time.time):
        self.root = root
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.now = now
        self.sleep = sleep
        self.wall = wall
        self.lock = threading.Lock()
        self.jobs_path = os.path.join(os.path.dirname(voice_bridge_key_path(root)), "domain-tasks.json")
        self.jobs = self._load()
        self.finished = []
        self.finished_ready = threading.Condition(self.lock)

    def _load(self) -> dict:
        try:
            with open(self.jobs_path, encoding="utf-8") as source:
                loaded = json.load(source)
        except (OSError, ValueError):
            return {}
        if not isinstance(loaded, dict):
            return {}
        return {task_id: job for task_id, job in loaded.items() if isinstance(job, dict)}

    def _save(self) -> bool:
        # The spoken flow must not fail when the state file is not writable; the task itself is durable in Hermes.
        try:
            os.makedirs(os.path.dirname(self.jobs_path), exist_ok=True)
            temporary = self.jobs_path + ".tmp"
            with open(temporary, "w", encoding="utf-8") as target:
                json.dump(self.jobs, target, ensure_ascii=False)
            os.replace(temporary, self.jobs_path)
            return True
        except OSError:
            return False

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
        job = self._request("POST", "/api/v1/voice/tasks", {"text": text, "domain": domain},
                            key="voice-task-" + uuid.uuid4().hex)
        with self.lock:
            self.jobs[job["taskId"]] = {"taskId": job["taskId"], "domain": domain, "title": text[:80],
                                        "createdAt": self.wall(), "status": job.get("status")}
        self._save()
        return job

    def status(self, task_id) -> dict:
        job = self._request("GET", f"/api/v1/voice/tasks/{task_id}")
        with self.lock:
            entry = self.jobs.get(task_id)
            if entry is not None:
                entry["status"] = job.get("status")
        return job

    def cancel(self, task_id) -> dict:
        job = self._request("POST", f"/api/v1/voice/tasks/{task_id}/cancel", None,
                            key="voice-cancel-" + uuid.uuid4().hex)
        with self.lock:
            entry = self.jobs.get(task_id)
            if entry is not None:
                entry["status"] = job.get("status")
        return job

    def read(self, text) -> dict:
        """Direct read answer from the dashboard (weather, settings, tasks ...); no agent is started."""
        return self._request("POST", "/api/v1/voice/read", {"text": str(text)[:500]})

    def reply(self, task_id, answer) -> dict:
        job = self._request("POST", f"/api/v1/voice/tasks/{task_id}/reply", {"answer": str(answer)[:2000]},
                            key="voice-reply-" + uuid.uuid4().hex)
        with self.lock:
            entry = self.jobs.get(task_id)
            if entry is not None:
                entry["status"] = job.get("status")
                entry.pop("question", None)
        self._save()
        return job

    def quiet_state(self) -> dict:
        return self._request("GET", "/api/v1/quiet-mode", timeout=4)

    def set_quiet(self, until_iso: str, level=None) -> dict:
        body = {"until": until_iso}
        if level is not None:
            body["level"] = level
        return self._request("PUT", "/api/v1/quiet-mode", body)

    def quiet_notice(self, klass: str, title: str, text: str = "") -> dict:
        body = {"class": klass, "title": str(title)[:200]}
        if text:
            body["text"] = str(text)[:1000]
        return self._request("POST", "/api/v1/quiet-mode/notices", body, timeout=8)

    def set_quiet_hours(self, enabled, start, end) -> dict:
        return self._request("PUT", "/api/v1/quiet-mode/schedule",
                             {"enabled": bool(enabled), "from": start, "to": end})

    def quiet_summary(self) -> dict:
        """What the dashboard held back during the current or last quiet period (titles only)."""
        return self._request("GET", "/api/v1/quiet-mode/summary", timeout=4)

    def clear_quiet(self) -> dict:
        return self._request("DELETE", "/api/v1/quiet-mode")

    def pending(self) -> list[dict]:
        with self.lock:
            return [dict(entry) for entry in self.jobs.values()]

    def forget(self, task_id) -> None:
        with self.lock:
            self.jobs.pop(task_id, None)
        self._save()

    def handles_text(self, text) -> bool:
        if not self.jobs:
            return False
        return bool(STATUS_QUESTION.search(text) or CANCEL_COMMAND.match(text))

    def handle(self, text) -> str | None:
        if STATUS_QUESTION.search(text):
            return self._status_answer()
        match = CANCEL_COMMAND.match(text)
        if match:
            return self._cancel_answer((match.group(1) or match.group(2) or "").strip().lower())
        return None

    def _status_answer(self) -> str:
        sentences = []
        for entry in self.pending():
            agent = AGENT_NAME.get(entry.get("domain"), "Der Agent")
            label = STATUS_LABEL.get(entry.get("status"), "arbeitet")
            minutes = max(1, int((self.wall() - entry.get("createdAt", self.wall())) // 60))
            sentences.append(f"{agent} {label} an „{entry.get('title', '')}“, seit {minutes} Minuten.")
        return " ".join(sentences) if sentences else "Dazu laeuft gerade kein Auftrag."

    def _cancel_candidates(self, target: str) -> list[dict]:
        entries = self.pending()
        candidates = [entry for entry in entries if self._is_named(entry, target)]
        if not candidates and len(entries) == 1 and re.search(r"auftrag|aufgabe", target):
            return entries  # "brich den Auftrag ab" with exactly one running task
        return candidates

    @staticmethod
    def _is_named(entry: dict, target: str) -> bool:
        pattern = DOMAIN_WORDS.get(entry.get("domain"))
        title = str(entry.get("title") or "").lower()
        return bool((pattern is not None and pattern.search(target)) or (title and title[:20] in target))

    def _cancel_answer(self, target: str) -> str:
        candidates = self._cancel_candidates(target)
        if not candidates:
            return "Dazu laeuft gerade kein Auftrag."
        if len(candidates) > 1:
            return "Welchen Auftrag soll ich abbrechen: " + " oder ".join(entry["title"] for entry in candidates) + "?"
        job = candidates[0]
        try:
            self.cancel(job["taskId"])
        except (OSError, ValueError, KeyError, urllib.error.HTTPError):
            return "Der Abbruch hat nicht geklappt; der Auftrag laeuft weiter."
        self.forget(job["taskId"])
        return f"Ich habe „{job['title']}“ abgebrochen. Bereits erledigte Schritte bleiben bestehen."

    def collect(self, job: dict) -> None:
        with self.finished_ready:
            self.finished.append(job)
            self.finished_ready.notify_all()

    def take_bundle(self, cancelled, window_s=3.0) -> list[dict]:
        """Wait for at least one result, then give follow-up results window_s seconds to join the same bundle."""
        with self.finished_ready:
            while not self.finished:
                if cancelled():
                    return []
                self.finished_ready.wait(0.5)
        remaining = window_s
        while remaining > 0 and not cancelled():
            step = min(0.5, remaining)
            self.sleep(step)
            remaining -= step
        with self.finished_ready:
            jobs = list(self.finished)
            self.finished.clear()
        return jobs

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
            if job is not None and job.get("status") == "waiting" and job.get("question"):
                question = str(job["question"]).strip()
                with self.lock:
                    entry = self.jobs.get(task_id)
                    # The same question is reported once; the next wait only returns on a new one or a final status.
                    fresh = entry is not None and entry.get("question") != question
                    if fresh:
                        entry["question"] = question
                        entry["status"] = "waiting"
                if fresh:
                    self._save()
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


def bundle_text(jobs) -> str:
    if len(jobs) == 1:
        return "Ergebnis zur Aufgabe: " + result_text(jobs[0])
    return f"{len(jobs)} Ergebnisse. " + " ".join(
        f"{AGENT_LABEL_SHORT.get(job['domain'], job['domain'])}: {result_text(job)}" for job in jobs)
