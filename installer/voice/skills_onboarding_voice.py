"""Speaker-gated first-run guidance backed by the Control API's owner state."""

import base64
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.request

from content_studio_voice import _dashboard_port


STEPS = ("intro", "profile", "skills", "accounts", "finish")
YES = {"ja", "jep", "genau", "bestatigen", "bestatige", "okay", "ok", "weiter"}
NO = {"nein", "abbrechen", "stopp", "stop"}
SKIP = {"uberspringen", "spater", "weiter ohne"}


def _normal(value):
    return "".join(ch for ch in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(ch))


def _words(value):
    return _normal(value).strip(" .!?,:;")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class SkillsOnboardingVoice:
    def __init__(self, root, now=time.monotonic, opener=None, pending_seconds=15):
        self.root = root
        self.now = now
        self.opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.pending_seconds = min(15, pending_seconds)
        self.pending = None

    def _request(self, method, path, body=None, revision=None):
        if (method, path) not in {("GET", "skills"), ("GET", "onboarding"), ("PUT", "onboarding")}:
            raise ValueError("Nicht erlaubte Voice-Bridge-Operation")
        key_path = os.path.join(self.root, "dashboard", "data", "voice-bridge", "auth.key")
        with open(key_path, encoding="ascii") as source:
            key = source.read().strip()
        if len(base64.b64decode(key, validate=True)) != 32:
            raise ValueError("Ungültiger Voice-Bridge-Schlüssel")
        headers = {"Authorization": "Bearer " + key, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if revision is not None:
            headers["If-Match"] = str(revision)
        request = urllib.request.Request(
            f"http://127.0.0.1:{_dashboard_port(self.root)}/api/v1/{path}",
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            headers=headers, method=method,
        )
        with self.opener.open(request, timeout=12) as response:
            payload = json.load(response)
        return payload if path == "skills" else payload["data"]

    def _safe_request(self, *args, **kwargs):
        try:
            return self._request(*args, **kwargs), None
        except urllib.error.HTTPError as error:
            if error.code == 409:
                return None, "conflict"
            if error.code in (401, 403):
                return None, "Die Sprachberechtigung für die Einrichtung fehlt."
            return None, "Die Skills-Einrichtung antwortet gerade nicht."
        except (OSError, ValueError, KeyError, TypeError, TimeoutError):
            return None, "Die Skills-Einrichtung ist gerade nicht erreichbar."

    def _save(self, state, *, step=None, status="completed", preferred_name=None, goals=None, selected_ids=None):
        steps = dict(state["steps"])
        if step:
            steps[step] = status
        update = {"steps": steps, "goals": state["goals"] if goals is None else goals,
                  "selectedSkillIds": state["selectedSkillIds"] if selected_ids is None else selected_ids}
        name = state.get("preferredName") if preferred_name is None else preferred_name
        if name:
            update["preferredName"] = name
        saved, error = self._safe_request("PUT", "onboarding", update, revision=state["revision"])
        if error == "conflict":
            self._safe_request("GET", "onboarding")
            self.pending = None
            return None, "Die Einrichtung wurde inzwischen geändert. Sage bitte „Einrichtung fortsetzen“, damit ich den aktuellen Stand lese."
        return saved, error

    def _ask(self, stage, prompt, **extra):
        self.pending = {"stage": stage, "expires": self.now() + self.pending_seconds, **extra}
        return prompt

    def _guide(self, state):
        steps = state["steps"]
        if steps["intro"] == "pending":
            return self._ask("intro", "Ich begleite dich in kurzen Schritten durch die Einrichtung. Soll ich beginnen?", revision=state["revision"])
        if steps["profile"] == "pending":
            if not state.get("preferredName"):
                return self._ask("name", "Wie soll ich dich nennen? Du kannst auch „überspringen“ sagen.", revision=state["revision"])
            return self._ask("goals", "Was möchtest du mit F.R.I.D.A.Y. erreichen? Nenne ein Ziel oder sage „überspringen“.", revision=state["revision"])
        if steps["skills"] == "pending":
            catalog, error = self._safe_request("GET", "skills")
            if error:
                return error
            skills = catalog.get("data", [])
            examples = [next((skill["name"] for skill in skills if skill.get("source") == source), None)
                        for source in ("friday", "hermes")]
            names = ", ".join(name for name in examples if name) or ", ".join(skill["name"] for skill in skills[:3])
            extra = " Zum Beispiel: " + names + "." if names else " Der Katalog ist derzeit leer."
            return self._ask("skills", "Welche Skills interessieren dich? Nenne einen Namen oder sage „überspringen“." + extra,
                             skills=skills, revision=state["revision"])
        if steps["accounts"] == "pending":
            return self._ask("accounts", "Für manche Skills müssen Konten oder Programme im Dashboard eingerichtet werden. Ich kann Verbindungen per Sprache noch nicht prüfen. Sage weiter oder überspringen; der Kontenschritt bleibt als ungeprüft markiert.", revision=state["revision"])
        if steps["finish"] == "pending":
            return self._ask("finish", "Die Grundeinrichtung ist bereit. Soll ich sie abschließen?", revision=state["revision"])
        self.pending = None
        return "Die Einrichtung ist abgeschlossen. Du kannst jederzeit nach aktiven Skills fragen."

    def _status(self):
        catalog, error = self._safe_request("GET", "skills")
        if error:
            return "Der Aktivierungsstatus der Skills ist gerade unbekannt. Die Control API antwortet nicht."
        skills = catalog.get("data", [])
        active = [skill["name"] for skill in skills if skill.get("enabled") is True]
        disabled = [skill["name"] for skill in skills if skill.get("enabled") is False]
        unknown = [skill["name"] for skill in skills if skill.get("enabled") is None]
        parts = ["Aktiv sind: " + ", ".join(active[:6]) + (f" und {len(active) - 6} weitere" if len(active) > 6 else "") + "." if active else "Ich sehe gerade keine als aktiv bestätigten Skills."]
        if disabled:
            parts.append("Deaktiviert sind: " + ", ".join(disabled[:3]) + (f" und {len(disabled) - 3} weitere" if len(disabled) > 3 else "") + ".")
        if unknown:
            parts.append("Bei " + ", ".join(unknown[:3]) + (f" und {len(unknown) - 3} weiteren" if len(unknown) > 3 else "") + " ist der Aktivierungsstatus unbekannt.")
        return " ".join(parts)

    def _capabilities(self):
        catalog, error = self._safe_request("GET", "skills")
        if error:
            return error
        names = [skill["name"] for skill in catalog.get("data", [])[:4]]
        if not names:
            return "Ich kann dich durch die Einrichtung führen. Der Skills-Katalog ist gerade leer oder nicht verfügbar."
        return "Ich kann dich durch die Einrichtung führen. Im Katalog stehen zum Beispiel " + ", ".join(names) + ". Frage mich, welche Skills aktiv sind."

    def handle(self, text):
        words = _words(text)
        if self.pending and self.now() > self.pending["expires"]:
            self.pending = None
        if re.search(r"\b(welche|was fur|zeige|liste)\b.*\bskills?\b.*\b(aktiv|aktiviert|eingeschaltet)\b|\baktive skills?\b", words):
            return self._status()
        if re.search(r"\bwas kannst du\b|\bwelche skills? (hast|gibt)\b", words):
            return self._capabilities()
        if re.search(r"\b(einrichtung|onboarding|skills? einrichten)\b.*\b(starten|fortsetzen|weitermachen|beginnen)\b", words):
            self.pending = None
            state, error = self._safe_request("GET", "onboarding")
            return error or self._guide(state)
        if not self.pending:
            return None
        pending = self.pending
        if words in NO:
            self.pending = None
            return "In Ordnung. Sage „Einrichtung fortsetzen“, wenn du weitermachen möchtest."
        state, error = self._safe_request("GET", "onboarding")
        if error:
            return error
        if state["revision"] != pending["revision"]:
            self.pending = None
            return "Die Einrichtung wurde inzwischen geändert. Sage bitte „Einrichtung fortsetzen“, damit ich den aktuellen Stand lese."
        stage = pending["stage"]
        if stage in STEPS and state["steps"][stage] != "pending":
            self.pending = None
            return self._guide(state)
        if stage == "intro" or stage == "finish":
            if words not in YES:
                return "Bitte sage ja oder nein."
            saved, error = self._save(state, step=stage)
        elif stage == "name":
            if words in SKIP:
                saved, error = self._save(state, step="profile", status="skipped")
            elif len(text.strip()) > 80 or len(text.strip()) < 1:
                return "Bitte nenne einen kurzen Namen mit höchstens 80 Zeichen."
            else:
                return self._ask("confirm_name", f"Soll ich dich {text.strip()} nennen? Sage ja oder nein.", value=text.strip(), revision=state["revision"])
        elif stage == "confirm_name":
            if words not in YES:
                return self._ask("name", "Wie soll ich dich nennen?", revision=state["revision"])
            saved, error = self._save(state, preferred_name=pending["value"])
        elif stage == "goals":
            if words in SKIP:
                saved, error = self._save(state, step="profile", status="skipped")
            elif len(text.strip()) > 120 or len(text.strip()) < 1:
                return "Bitte nenne ein kurzes Ziel mit höchstens 120 Zeichen."
            else:
                return self._ask("confirm_goals", f"Dein Ziel ist: {text.strip()}. Soll ich das speichern?", value=text.strip(), revision=state["revision"])
        elif stage == "confirm_goals":
            if words not in YES:
                return self._ask("goals", "Welches Ziel soll ich speichern?", revision=state["revision"])
            goals = list(dict.fromkeys([*state["goals"], pending["value"]]))[:20]
            saved, error = self._save(state, step="profile", goals=goals)
        elif stage == "skills":
            if words in SKIP:
                saved, error = self._save(state, step="skills", status="skipped")
            else:
                matches = [skill for skill in pending["skills"] if _normal(skill["name"]) in words]
                if len(matches) != 1:
                    return "Bitte nenne genau einen Skill aus dem Katalog oder sage „überspringen“."
                return self._ask("confirm_skills", f"Soll ich {matches[0]['name']} als Interesse speichern? Das aktiviert den Skill nicht.", value=matches[0]["id"], revision=state["revision"])
        elif stage == "confirm_skills":
            if words not in YES:
                return self._guide(state)
            ids = list(dict.fromkeys([*state["selectedSkillIds"], pending["value"]]))[:200]
            saved, error = self._save(state, step="skills", selected_ids=ids)
        elif stage == "accounts":
            if words not in YES and words not in SKIP:
                return "Bitte sage weiter oder überspringen. Konten und Programme richtest du im Dashboard ein; ich kann ihren Zustand per Sprache nicht bestätigen."
            saved, error = self._save(state, step="accounts", status="skipped")
        else:
            self.pending = None
            return None
        if error:
            return error
        self.pending = None
        return self._guide(saved)
