"""Small deterministic cloud model router for Friday voice requests.

This module only selects a route. It neither checks credentials nor calls a
provider. The caller must enforce ``needs_confirmation`` before side effects.
"""
from __future__ import annotations

import re
import json
import sqlite3
import unicodedata
from collections.abc import Mapping
from pathlib import Path


ROUTE_BY_TIER = {
    "routine": "cloud_low",
    "complex": "cloud_high",
    "critical": "cloud_max",
}

# Only Kimi aliases already used by this repository are supplied by default.
# Other providers must pass model IDs observed in their own configuration.
DEFAULT_MODELS = {
    "kimi-coding": {
        "cloud_low": "kimi-for-coding",
        "cloud_high": "k3",
        "cloud_max": "k3",
    },
    "openai": {},
    "anthropic": {},
}

VOICE_TASK_KINDS = {
    "cloud_low": "voice-routine",
    "cloud_high": "voice-complex",
    "cloud_max": "voice-critical",
}


def _parse_model_target(value: object) -> tuple[str, str] | None:
    if not isinstance(value, str) or ":" not in value:
        return None
    provider, model = value.strip().split(":", 1)
    provider = provider.casefold()
    model = model.strip()
    if provider not in DEFAULT_MODELS or not model or any(char.isspace() for char in model):
        return None
    return provider, model


def load_dashboard_voice_routing(
    db_path: str | Path,
    *,
    fallback_provider: str = "kimi-coding",
    fallback_models: Mapping | None = None,
) -> dict[str, tuple[str, str | None]]:
    """Read voice targets from dashboard settings, with voice.json as fallback.

    Returns a route-to-(provider, model ID) map. Only explicit
    ``provider:model`` settings are accepted; legacy display names are ignored.
    This never creates or writes the dashboard database.
    """
    provider = fallback_provider.strip().casefold()
    if provider not in DEFAULT_MODELS:
        provider = "kimi-coding"
    targets: dict[str, tuple[str, str | None]] = {
        route: (provider, _model_for(provider, route, fallback_models))
        for route in VOICE_TASK_KINDS
    }

    try:
        path = Path(db_path)
        if not path.is_file():
            return targets
        with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=0.2) as db:
            row = db.execute("SELECT json FROM settings_areas WHERE area = ?", ("modelsRouting",)).fetchone()
        if row is None:
            return targets
        settings = json.loads(row[0])
    except (OSError, ValueError, sqlite3.Error, TypeError):
        return targets
    if not isinstance(settings, dict):
        return targets

    default_target = _parse_model_target(settings.get("defaultModel"))
    if default_target:
        targets = {route: default_target for route in VOICE_TASK_KINDS}

    routes = settings.get("routes")
    if isinstance(routes, list):
        by_task = {task: route for route, task in VOICE_TASK_KINDS.items()}
        for entry in routes:
            if not isinstance(entry, dict):
                continue
            task_kind = entry.get("taskKind")
            if not isinstance(task_kind, str) or task_kind not in by_task:
                continue
            target = _parse_model_target(entry.get("model"))
            if target:
                targets[by_task[task_kind]] = target
    return targets

_CRITICAL = re.compile(
    r"\b(?:medizinisch|medizin|diagnose|rechtlich|anwalt|gericht|steuerlich|"
    r"investition|investieren|sicherheitsl(?:ue|u)cke|datenverlust|notfall|"
    r"lebensgefahr|kritische entscheidung|hohes risiko|kritisch analysieren)\b"
)
_COMPLEX = re.compile(
    r"\b(?:analysiere|analyse|debugge|debugging|programmier|code|entwickle|"
    r"erstell\w*|generier\w*|powerpoint|prasentat\w*|presentation|bericht\w*|report\w*|"
    r"refactor\w*|refaktori\w*|troubleshoot\w*|problembehebung|fehlerbehebung|"
    r"verfasse|formuliere|aufsatz|langtext|"
    r"vergleiche|vergleichen|recherchiere|recherche|plane|planung|entwirf|"
    r"strategie|begr(?:ue|u)nde|erklaere ausf(?:ue|u)hrlich|erklare ausf(?:ue|u)hrlich|"
    r"schritt f(?:ue|u)r schritt|komplex|warum funktioniert)\b"
)
_SIDE_EFFECT = re.compile(
    r"\b(?:send\w*|schick\w*|versend\w*|anruf|ruf(?:e)?|telefonier\w*|buch\w*|reservier\w*|"
    r"bestaetige|bestatige|sage ab|k(?:ue|u)ndige|l(?:oe|o)sche|entferne|"
    r"kaufe|bestelle|veroeffentliche|veroffentliche|poste|posten|"
    r"(?:ue|u)berweise|(?:ue|u)berweisen|zahle|zahlen|bezahle|bezahlen|"
    r"(?:andere|aendere).{0,24}termin|termin.{0,24}(?:andern|verschieben)|"
    r"(?:verschiebe|verschieben).{0,24}termin|"
    r"(?:send|call|book|cancel|delete|remove|buy|purchase|publish|share|confirm))\b"
)
_BACKGROUND = re.compile(r"\b(?:im hintergrund|background|spaeter erledigen|spater erledigen)\b")
_MULTI_STEP = re.compile(
    r"\b(?:und dann|danach|anschliessend|zuerst|erstens|first.{0,20}then|"
    r"step by step|mehrere schritte|nacheinander)\b"
)


def _fold(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text.casefold())
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _model_for(provider: str, route: str, models: Mapping | None) -> str | None:
    selected = dict(DEFAULT_MODELS.get(provider, {}))
    if models:
        # Accept existing flat voice.json ``cloud_models`` or provider-scoped
        # mappings, so integration can migrate without changing this API.
        provider_models = models.get(provider)
        if isinstance(provider_models, Mapping):
            selected.update(provider_models)
        elif all(not isinstance(value, Mapping) for value in models.values()):
            selected.update(models)
    model = selected.get(route)
    return model.strip() if isinstance(model, str) and model.strip() else None


def route_request(
    text: str,
    *,
    provider: str = "kimi-coding",
    models: Mapping | None = None,
    credentials_available: bool | None = None,
) -> dict:
    """Classify text and return a cloud route without performing any action.

    ``credentials_available`` is an explicit caller-supplied fact. If omitted,
    ``credential_status`` stays ``unknown``; route selection never infers that
    an account, subscription, or API key exists.
    """
    if not isinstance(text, str):
        raise TypeError("text must be a string")
    provider = provider.strip().casefold()
    if provider not in DEFAULT_MODELS:
        raise ValueError("provider must be kimi-coding, openai, or anthropic")

    folded = _fold(text)
    critical = bool(_CRITICAL.search(folded))
    complex_request = bool(_COMPLEX.search(folded))
    # Unknown long or explicitly multi-step work should spend the stronger
    # model tier instead of being silently sent to the routine model.
    complex_request = complex_request or len(re.findall(r"\b\w+\b", folded)) >= 18 or bool(_MULTI_STEP.search(folded))
    side_effect = bool(_SIDE_EFFECT.search(folded))

    tier = "critical" if critical else "complex" if complex_request else "routine"
    route = ROUTE_BY_TIER[tier]
    background = bool(_BACKGROUND.search(folded))
    needs_confirmation = side_effect
    priority = {"routine": "P4", "complex": "P3", "critical": "P2"}[tier]
    if side_effect:
        priority = "P1" if critical else "P2"

    model = _model_for(provider, route, models)
    credential_status = (
        "unknown" if credentials_available is None
        else "available" if credentials_available
        else "missing"
    )
    reasons = {
        "routine": "Routine voice request routed to the fast tier.",
        "complex": "Complex cues routed to the stronger reasoning tier.",
        "critical": "High-impact cues routed to the strongest configured tier.",
    }
    answer = reasons[tier]
    if needs_confirmation:
        answer += " Explicit user confirmation is required before carrying out the requested action."
    if model is None:
        answer += " No model ID is configured for this provider and tier."
    if credential_status == "missing":
        answer += " Provider credentials are reported as unavailable."

    return {
        "route": route,
        "tier": tier,
        "background": background,
        "needs_confirmation": needs_confirmation,
        "priority": priority,
        "answer": answer,
        "provider": provider,
        "model": model,
        "credential_status": credential_status,
    }
