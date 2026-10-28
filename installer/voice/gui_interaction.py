"""Rueckkanal fuer Aufnahmeinteraktionen zwischen Installer, Aufnahme und grafischem Assistenten.

Der Assistent schreibt eine Anfrage als JSON-Datei in den Lauf-Ordner und wartet auf genau eine
Antwort mit derselben Kennung. Damit braucht die Aufnahme keine Eingabe auf stdin und kein eigenes
Fenster: die Oberflaeche zeigt Aufforderung, Fortschritt und Aktionen an und schreibt die Antwort.

Nur Standardbibliothek, damit die Aufnahme auch ohne zusaetzliche Pakete laeuft und die Logik ohne
Audioabhaengigkeiten pruefbar bleibt.
"""
from __future__ import annotations

import datetime
import json
import os
import time
import uuid

REQUEST_VERSION = 1
RESPONSE_SUFFIX = ".response"
POLL_SECONDS = 0.25


class InteractionError(RuntimeError):
    """Die Interaktion konnte nicht uebergeben oder nicht beantwortet werden."""


class InteractionCancelled(InteractionError):
    """Der Benutzer oder der Installer hat die Aufnahme abgebrochen."""


class InteractionTimeout(InteractionError):
    """Niemand hat innerhalb der Frist geantwortet."""


def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def write_json_atomic(path: str, payload: dict) -> None:
    """Schreibt die Datei ueber eine Zwischendatei, damit nie halber JSON-Inhalt sichtbar ist."""
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def response_path(request_path: str) -> str:
    return request_path + RESPONSE_SUFFIX


def remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


class InteractionClient:
    """Schreibt Anfragen und wartet auf die Antwort des Assistenten."""

    def __init__(self, request_path: str, poll_seconds: float = POLL_SECONDS):
        if not request_path:
            raise InteractionError("Kein Pfad fuer die Interaktionsdatei angegeben.")
        self.request_path = os.path.abspath(request_path)
        self.response_path = response_path(self.request_path)
        self.poll_seconds = max(0.05, float(poll_seconds))

    def ask(self, prompt: str, *, title: str, kind: str = "record", block: str = "",
            index: int = 0, total: int = 0, detail: str = "",
            actions: tuple = ("ok", "replay", "skip", "cancel"), timeout: float = 1800.0) -> str:
        """Stellt eine Anfrage und liefert die gewaehlte Aktion ('ok', 'replay', 'cancel', 'skip')."""
        identifier = uuid.uuid4().hex[:12]
        request = {
            "v": REQUEST_VERSION,
            "id": identifier,
            "kind": kind,
            "title": title,
            "prompt": prompt,
            "detail": detail,
            "block": block,
            "index": int(index),
            "total": int(total),
            "actions": list(actions),
            "created": _now(),
        }
        # Eine liegen gebliebene Antwort darf die neue Anfrage nicht beantworten.
        remove_quietly(self.response_path)
        write_json_atomic(self.request_path, request)
        deadline = time.monotonic() + max(1.0, float(timeout))
        while time.monotonic() < deadline:
            action = self._read_response(identifier)
            if action:
                remove_quietly(self.response_path)
                if action == "cancel":
                    raise InteractionCancelled("Die Aufnahme wurde abgebrochen.")
                if action not in request["actions"]:
                    raise InteractionError(f"Unbekannte Aktion '{action}' fuer diese Aufnahme.")
                return action
            time.sleep(self.poll_seconds)
        raise InteractionTimeout("Der Assistent hat nicht auf die Aufnahme geantwortet.")

    def _read_response(self, identifier: str):
        try:
            with open(self.response_path, encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, ValueError):
            return None
        if not isinstance(payload, dict):
            return None
        if str(payload.get("id", "")) != identifier:
            # Veraltete Antwort einer frueheren Anfrage: verwerfen, weiter warten.
            remove_quietly(self.response_path)
            return None
        return str(payload.get("action", "")).strip() or None

    def close(self) -> None:
        remove_quietly(self.request_path)
        remove_quietly(self.response_path)
