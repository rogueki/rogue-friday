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
DONE = {"weiter", "fertig", "abschliessen"}


def _normal(value):
    return "".join(ch for ch in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(ch))


def _words(value):
    return _normal(value).strip(" .!?,:;")


def _skill_question(words):
    patterns = (
        r"^was kann (?:der |die |das )?(?:skill )?(.+)$",
        r"^erklare (?:mir )?(?:den |die |das )?(?:skill )?(.+)$",
        r"^braucht (?:der |die |das )?(?:skill )?(.+?) (?:ein konto|einen account|eine anmeldung)$",
        r"^ist (?:der |die |das )?(?:skill )?(.+?) (?:aktiv|aktiviert|eingeschaltet)$",
    )
    for pattern in patterns:
        match = re.fullmatch(pattern, words)
        if match:
            return match.group(1).strip()
    return None


def _spoken_field(value, limit=180):
    if not isinstance(value, str):
        return ""
    value = " ".join(value.split())
    if re.search(r"(?i)(?:api[_ -]?key|token|secret|passwort|password)\s*[:=]|bearer\s+\S+|https?://|[A-Za-z0-9_-]{32,}", value):
        return ""
    if len(value) > limit:
        value = value[:limit].rsplit(" ", 1)[0].rstrip(" ,;:") + " …"
    return value


def _skill_match(skills, subject):
    subject = re.sub(r"\s+", " ", subject).strip()
    as_name = re.sub(r"[-_]+", " ", subject)
    name_of = lambda skill: re.sub(r"[-_]+", " ", _words(skill["name"]))
    exact = [skill for skill in skills if as_name == name_of(skill) or subject == _words(skill["id"])]
    if exact:
        return exact
    # Match whole skill names only. Short generic names such as "mail" must not
    # match a longer, unrelated phrase or another skill's name.
    candidates = [skill for skill in skills if len(name_of(skill)) >= 5
                  and re.search(r"(?<!\w)" + re.escape(name_of(skill)) + r"(?!\w)", as_name)]
    if not candidates:
        return []
    longest = max(len(name_of(skill)) for skill in candidates)
    return [skill for skill in candidates if len(name_of(skill)) == longest]


def _account_guidance(state, catalog):
    selected = state.get("selectedSkillIds")
    if not isinstance(selected, list) or not selected:
        return "Du hast noch keine Skills ausgewählt. Wähle sie im Skills-Menü; dann kann ich dir die passenden Konten nennen."
    if not isinstance(catalog, dict) or not isinstance(catalog.get("data"), list):
        return "Der Skills-Katalog ist gerade nicht verfügbar. Welche Konten deine Skills brauchen, kann ich nicht sicher sagen."
    skills = {skill["id"]: skill for skill in catalog["data"] if isinstance(skill, dict)
              and isinstance(skill.get("id"), str)}
    integrations = {}
    incomplete = False
    for skill_id in dict.fromkeys(item for item in selected if isinstance(item, str)):
        skill = skills.get(skill_id)
        if not skill or not isinstance(skill.get("integrationDetails"), list):
            incomplete = True
            continue
        for detail in skill["integrationDetails"]:
            if not isinstance(detail, dict) or detail.get("account") not in ("required", "conditional"):
                continue
            integration_id = detail.get("id")
            if not isinstance(integration_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,44}", integration_id) or not _spoken_field(integration_id, 45):
                incomplete = True
                continue
            previous = integrations.get(integration_id)
            if previous is None:
                integrations[integration_id] = dict(detail)
            else:
                previous["account"] = "required" if "required" in (previous["account"], detail["account"]) else "conditional"
                for field in ("configured", "connectionChecked"):
                    if previous.get(field) != detail.get(field):
                        previous[field] = None
    if not integrations:
        if incomplete:
            return "Für deine ausgewählten Skills fehlen aktuelle Kontoinformationen im Katalog. Prüfe ihre Details im Skills-Menü."
        return "Für deine ausgewählten Skills sind im aktuellen Katalog keine externen Konten verzeichnet. Lokale Programme können trotzdem nötig sein."

    parts = []
    for integration_id, detail in list(integrations.items())[:3]:
        name = integration_id.replace("_", " ").replace("-", " ")
        requirement = "erforderlich" if detail["account"] == "required" else "je nach Nutzung"
        configured = detail.get("configured")
        setup = "lokal eingerichtet" if configured is True else "nicht eingerichtet" if configured is False else "Einrichtungsstand unbekannt"
        checked = detail.get("connectionChecked")
        connection = "Verbindung geprüft" if checked is True else "Verbindung nicht bestätigt" if checked is False else "Verbindung nicht geprüft"
        parts.append(f"{name}: {requirement}, {setup}, {connection}")
    extra = f"; {len(integrations) - 3} weitere im Skills-Menü" if len(integrations) > 3 else ""
    ids = set(integrations)
    if ids & {"imap", "smtp", "himalaya", "hermes_himalaya"}:
        section = "Für Mail öffne Einstellungen, Skill-Konten oder Mail und Kommunikation."
    elif ids & {"caldav", "google_calendar", "outlook_calendar"}:
        section = "Für Kalender öffne Einstellungen, Adapter und Kalender."
    else:
        section = "Den jeweiligen Einrichtungsweg findest du im Skills-Menü und unter Einstellungen, Skill-Konten."
    caveat = " Für weitere ausgewählte Skills fehlen aktuelle Kontoinformationen." if incomplete else ""
    return "Für deine ausgewählten Skills sehe ich: " + "; ".join(parts) + extra + ". " + section + caveat


def _account_items(state, catalog):
    if not isinstance(catalog, dict) or not isinstance(catalog.get("data"), list):
        return None
    selected = state.get("selectedSkillIds")
    if not isinstance(selected, list):
        return None
    skills = {skill["id"]: skill for skill in catalog["data"] if isinstance(skill, dict)
              and isinstance(skill.get("id"), str)}
    accounts = {}
    for skill_id in dict.fromkeys(item for item in selected if isinstance(item, str)):
        skill = skills.get(skill_id)
        if not skill or not isinstance(skill.get("integrationDetails"), list):
            return None
        for detail in skill["integrationDetails"]:
            if not isinstance(detail, dict) or detail.get("account") not in ("required", "conditional"):
                continue
            integration_id = detail.get("id")
            if (not isinstance(integration_id, str)
                    or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,44}", integration_id)
                    or not _spoken_field(integration_id, 45)):
                return None
            previous = accounts.get(integration_id)
            if previous is None:
                accounts[integration_id] = dict(detail)
            else:
                previous["account"] = "required" if "required" in (previous["account"], detail["account"]) else "conditional"
                for field in ("configured", "connectionChecked"):
                    if previous.get(field) != detail.get(field):
                        previous[field] = None
    return list(accounts.values())


def _account_prompt(detail, index, count):
    name = detail["id"].replace("_", " ").replace("-", " ")
    requirement = "erforderlich" if detail["account"] == "required" else "je nach Nutzung erforderlich"
    configured = detail.get("configured")
    setup = "lokal eingerichtet" if configured is True else "nicht eingerichtet" if configured is False else "Einrichtungsstand unbekannt"
    checked = detail.get("connectionChecked")
    connection = "Verbindung laut Katalog geprueft" if checked is True else "Verbindung nicht bestaetigt" if checked is False else "Verbindung nicht geprueft"
    target = detail.get("settingsTarget")
    if (target == "Friday Dashboard > Einstellungen > Adapter > CalDAV"
            or isinstance(target, str) and (re.fullmatch(r"adapter:[a-z0-9_-]+", target)
                                            or re.fullmatch(r"/settings\?area=adapters(?:#[a-z0-9_-]+)?", target))):
        location = "Den Einrichtungsbereich findest du im Dashboard unter Einstellungen, Adapter."
    elif target in {"Friday Dashboard > Einstellungen > Skill-Konten > E-Mail",
                    "Friday Dashboard > Einstellungen > Skill-Konten > Telegram",
                    "Friday Dashboard > Einstellungen > Skill-Konten > Discord",
                    "Friday Dashboard > Einstellungen > Skill-Konten > WhatsApp"} or (
                        isinstance(target, str)
                        and re.fullmatch(r"/settings\?area=skillAccounts(?:#[a-z0-9_-]+)?", target)):
        location = "Den Einrichtungsbereich findest du im Dashboard unter Einstellungen, Skill-Konten."
    elif target == "/settings?area=contentStudioKeys":
        location = "Den Einrichtungsbereich findest du im Dashboard unter Einstellungen, Content Studio."
    else:
        location = "Den genauen Einrichtungsort findest du im Skills-Menue beim Skill-Detail."
    return (f"Konto {index + 1} von {count}: {name}, {requirement}; {setup}; {connection}. "
            f"{location} Sage weiter fuer das naechste Konto, fertig zum Beenden oder ueberspringen. Der Kontenschritt bleibt ungeprueft.")


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
        self.offer_path = os.path.join(root, "dashboard", "data", "voice-bridge", "onboarding-offer.json")
        self.offer_shown = self._read_offer_shown()

    def _read_offer_shown(self):
        try:
            with open(self.offer_path, encoding="utf-8") as source:
                marker = json.load(source)
            return marker == {"version": 1, "shown": True}
        except (OSError, ValueError, TypeError):
            return False

    def _mark_offer_shown(self):
        self.offer_shown = True
        temporary = self.offer_path + ".tmp"
        try:
            os.makedirs(os.path.dirname(self.offer_path), exist_ok=True)
            with open(temporary, "w", encoding="utf-8") as target:
                json.dump({"version": 1, "shown": True}, target)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, self.offer_path)
        except OSError:
            try:
                os.remove(temporary)
            except OSError:
                pass

    def offer_first_use(self):
        """Offer onboarding once, after the caller has verified the speaker."""
        if self.offer_shown or self.pending is not None:
            return None
        # An unavailable dashboard must not delay an unrelated spoken answer.
        state, error = self._safe_request("GET", "onboarding", timeout=1.5)
        if error:
            return None
        if state.get("steps", {}).get("intro") != "pending":
            self.offer_shown = True
            return None
        self._mark_offer_shown()
        name = str(state.get("preferredName") or "").strip()
        goals = state.get("goals")
        goals = [goal.strip() for goal in goals if isinstance(goal, str) and goal.strip()] if isinstance(goals, list) else []
        greeting = f"Willkommen, {name}." if name else "Willkommen bei F.R.I.D.A.Y."
        saved_goals = " Ich habe bisher diese Ziele notiert: " + "; ".join(goals[:2]) + "." if goals else ""
        return self._ask(
            "first_use_invite",
            greeting + saved_goals + " Ich kann dich kurz durch dein Profil, deine Friday- und Hermes-Skills und die Einrichtung begleiten. Sollen wir jetzt gemeinsam anfangen? Sage ja oder nein.",
            expires_in=90,
            revision=state["revision"],
        )

    def _request(self, method, path, body=None, revision=None, timeout=12):
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
        with self.opener.open(request, timeout=timeout) as response:
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

    def _ask(self, stage, prompt, *, expires_in=None, **extra):
        duration = self.pending_seconds if expires_in is None else min(90, max(0, expires_in))
        self.pending = {"stage": stage, "expires": self.now() + duration, **extra}
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
                self.pending = None
                return error
            if not isinstance(catalog, dict) or not isinstance(catalog.get("data"), list):
                self.pending = None
                return "Der Skills-Katalog ist gerade nicht verfuegbar. Sage spaeter Einrichtung fortsetzen."
            skills = [skill for skill in catalog["data"] if isinstance(skill, dict)
                      and isinstance(skill.get("id"), str) and isinstance(skill.get("name"), str)
                      and _spoken_field(skill["name"], 70)]
            examples = [next((_spoken_field(skill["name"], 70) for skill in skills if skill.get("source") == source), None)
                        for source in ("friday", "hermes")]
            names = ", ".join(name for name in examples if name) or ", ".join(_spoken_field(skill["name"], 70) for skill in skills[:3])
            extra = " Zum Beispiel: " + names + "." if names else " Der Katalog ist derzeit leer."
            return self._ask("skills", "Welche Skills interessieren dich? Nenne einen Namen, dann weitere Skills, oder sage fertig. Ueberspringen ist auch moeglich." + extra,
                             skills=skills, revision=state["revision"])
        if steps["accounts"] == "pending":
            catalog, error = self._safe_request("GET", "skills")
            accounts = _account_items(state, catalog) if not error else None
            if accounts is None:
                self.pending = None
                return "Der Skills-Katalog ist gerade nicht erreichbar oder unvollstaendig. Konten kann ich nicht sicher erklaeren. Sage spaeter Einrichtung fortsetzen."
            if not accounts:
                return self._ask("accounts", "Fuer deine Auswahl sind keine externen Konten verzeichnet. Sage weiter oder ueberspringen; der Kontenschritt bleibt ungeprueft.", revision=state["revision"], accounts=accounts, index=0)
            return self._ask("accounts", _account_prompt(accounts[0], 0, len(accounts)), revision=state["revision"], accounts=accounts, index=0)
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

    def _selected_accounts(self):
        state, error = self._safe_request("GET", "onboarding")
        if error or not isinstance(state, dict):
            return "Deine Skill-Auswahl ist gerade nicht erreichbar. Welche Konten du brauchst, kann ich nicht sicher sagen."
        catalog, error = self._safe_request("GET", "skills")
        if error:
            return "Der Skills-Katalog ist gerade nicht erreichbar. Welche Konten deine Skills brauchen, kann ich nicht sicher sagen."
        return _account_guidance(state, catalog)

    def _skill_detail(self, subject):
        catalog, error = self._safe_request("GET", "skills")
        if error or not isinstance(catalog, dict) or not isinstance(catalog.get("data"), list):
            return "Der Skills-Katalog ist gerade nicht erreichbar. Den Zustand dieses Skills kann ich nicht sicher nennen."
        skills = [skill for skill in catalog["data"] if isinstance(skill, dict)
                  and isinstance(skill.get("name"), str) and skill["name"]
                  and isinstance(skill.get("id"), str) and skill["id"]]
        matches = _skill_match(skills, subject)
        if not matches:
            return "Diesen Skill finde ich im aktuellen Katalog nicht. Nenne bitte den genauen Namen aus dem Skills-Menü."
        if len(matches) > 1:
            sources = ", ".join(_spoken_field(skill.get("source"), 20) or "unbekannt" for skill in matches[:3])
            return f"Der Name ist mehrdeutig; ich sehe ihn bei {sources}. Nenne bitte die Skill-ID aus dem Skills-Menü."
        skill = matches[0]
        name = _spoken_field(skill["name"], 70) or "Dieser Skill"
        description = _spoken_field(skill.get("description"))
        answer = [f"{name}: {description}." if description else f"{name}: Eine sichere Kurzbeschreibung fehlt im Katalog."]
        enabled = skill.get("enabled")
        if enabled is True:
            answer.append("Er wird aktuell als aktiviert angezeigt; das beweist noch keine erfolgreiche Ausführung.")
        elif enabled is False:
            answer.append("Er wird aktuell als deaktiviert angezeigt.")
        else:
            answer.append("Sein Aktivierungsstatus ist derzeit unbekannt.")
        details = skill.get("integrationDetails")
        accounts = [detail for detail in details if isinstance(detail, dict)
                    and detail.get("account") in ("required", "conditional")
                    and _spoken_field(detail.get("id"), 45)] if isinstance(details, list) else []
        if accounts:
            for detail in accounts[:2]:
                account = _spoken_field(detail["id"], 45)
                kind = "Ein Konto ist nötig" if detail["account"] == "required" else "Ein Konto kann je nach Nutzung nötig sein"
                configured = detail.get("configured")
                setup = "lokal vorhanden" if configured is True else "noch nicht eingerichtet" if configured is False else "Einrichtungsstand unbekannt"
                checked = "Verbindung bestätigt" if detail.get("connectionChecked") is True else "Verbindung nicht bestätigt" if detail.get("connectionChecked") is False else "Verbindung nicht geprüft"
                answer.append(f"{kind} für {account}: {setup}; {checked}.")
            if len(accounts) > 2:
                answer.append(f"{len(accounts) - 2} weitere Voraussetzungen stehen im Skills-Menü.")
            answer.append("Den passenden Einrichtungsweg findest du im Skills-Menü und gegebenenfalls unter Einstellungen.")
        elif isinstance(details, list) and not details:
            answer.append("Im Katalog ist kein Konto verzeichnet; lokale Programme können trotzdem nötig sein.")
        elif isinstance(details, list) and all(isinstance(detail, dict) and detail.get("account") == "none" for detail in details):
            answer.append("Laut Katalog ist kein externes Konto erforderlich; lokale Programme können trotzdem nötig sein.")
        else:
            answer.append("Ob ein Konto nötig ist, ist im Katalog derzeit unbekannt.")
        return " ".join(answer)

    def handle(self, text):
        words = _words(text)
        if self.pending and self.now() > self.pending["expires"]:
            self.pending = None
        if words == "spater" and self.pending:
            self.pending = None
            return "In Ordnung. Sage Einrichtung fortsetzen, wenn du weitermachen moechtest."
        if self.pending and self.pending["stage"] == "first_use_invite":
            pending = self.pending
            self.pending = None
            if words in NO:
                return "Alles klar. Du kannst die Einrichtung jederzeit im Dashboard oder mit ‚Einrichtung fortsetzen‘ starten."
            if words in YES:
                state, error = self._safe_request("GET", "onboarding")
                if error:
                    return error
                if state["revision"] != pending["revision"]:
                    return "Die Einrichtung wurde inzwischen geaendert. Sage bitte ‚Einrichtung fortsetzen‘, damit ich den aktuellen Stand lese."
                if state["steps"].get("intro") != "pending":
                    return self._guide(state)
                saved, error = self._save(state, step="intro")
                return error or self._guide(saved)
        if re.search(r"\b(welche|was fur|zeige|liste)\b.*\bskills?\b.*\b(aktiv|aktiviert|eingeschaltet)\b|\baktive skills?\b", words):
            return self._status()
        if words in {"welche konten brauche ich fur meine skills", "welche konten brauchen meine skills", "welche accounts brauche ich fur meine skills"}:
            return self._selected_accounts()
        if re.search(r"\bwas kannst du\b|\bwelche skills? (hast|gibt)\b", words):
            return self._capabilities()
        subject = _skill_question(words)
        if subject:
            return self._skill_detail(subject)
        if re.search(r"\b(einrichtung|onboarding|skills? einrichten)\b.*\b(starten|fortsetzen|weitermachen|beginnen)\b", words):
            self.pending = None
            state, error = self._safe_request("GET", "onboarding")
            if error:
                return error
            if state.get("steps", {}).get("intro") == "pending":
                self._mark_offer_shown()
            return self._guide(state)
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
            elif words in DONE:
                saved, error = self._save(state, step="skills")
            else:
                matches = [skill for skill in pending["skills"] if _normal(skill["name"]) in words]
                if len(matches) != 1:
                    return "Bitte nenne genau einen Skill aus dem Katalog oder sage fertig."
                name = _spoken_field(matches[0]["name"], 70)
                return self._ask("confirm_skills", f"Soll ich {name} als Interesse speichern? Das aktiviert den Skill nicht.", value=matches[0]["id"], revision=state["revision"])
        elif stage == "confirm_skills":
            if words not in YES:
                return self._guide(state)
            ids = list(dict.fromkeys([*state["selectedSkillIds"], pending["value"]]))[:200]
            saved, error = self._save(state, selected_ids=ids)
        elif stage == "accounts":
            catalog, catalog_error = self._safe_request("GET", "skills")
            current_accounts = _account_items(state, catalog) if not catalog_error else None
            if current_accounts is None or current_accounts != pending["accounts"]:
                self.pending = None
                return "Der Skills-Katalog hat sich geaendert oder ist nicht erreichbar. Sage Einrichtung fortsetzen, damit ich die Konten neu lese."
            if (words in SKIP or (words in DONE and words != "weiter")
                    or (words == "weiter" and pending["index"] + 1 >= len(pending["accounts"]))):
                saved, error = self._save(state, step="accounts", status="skipped")
            elif words == "weiter":
                index = pending["index"] + 1
                return self._ask("accounts", _account_prompt(pending["accounts"][index], index, len(pending["accounts"])),
                                 revision=state["revision"], accounts=pending["accounts"], index=index)
            else:
                return "Bitte sage weiter, fertig oder ueberspringen. Konten richtest du im Dashboard ein; ich kann sie per Sprache nicht bestaetigen."
        else:
            self.pending = None
            return None
        if error:
            return error
        self.pending = None
        return self._guide(saved)
