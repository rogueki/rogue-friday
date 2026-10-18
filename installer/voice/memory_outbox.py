"""Private, sanitized durable delivery queue for verified voice events."""
from __future__ import annotations

import copy
from contextlib import closing, contextmanager
from datetime import datetime
import json
import re
import sqlite3
import threading
from pathlib import Path
from typing import Callable


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$")
_CUE = re.compile(
    r"\b(?:password|passwort|passphrase|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|secret|"
    r"geheimnis|otp|einmalcode|private[ _-]?key|bearer|authorization|kennwort|zugangsdaten)\b|"
    r"\bpin\s*(?:[:=]|is\b|lautet\b)", re.I)
_VALUE = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|(?:\d[ -]*?){13,19})\b")
_PRIVATE_INTENT = re.compile(
    r"\b(?:(?:dieses |diese )?(?:gespr[aä]ch|unterhaltung|chat) nicht speichern|"
    r"(?:bitte )?(?:speichere|speicher|speichern sie|merke|merk) (?:dieses |diese |das )?(?:gespr[aä]ch|unterhaltung|chat) nicht|"
    r"(?:nicht speichern|nicht merken|vergiss (?:dieses |diese )?(?:gespr[aä]ch|unterhaltung|chat))|private[rnms]? modus|"
    r"do not (?:store|remember|save) (?:this |the )?(?:conversation|chat)|off the record)\b", re.I)


def private_intent(text: str) -> bool:
    return bool(_PRIVATE_INTENT.search(text)) if isinstance(text, str) else False


def _redact(value: str) -> str:
    if _CUE.search(value):
        return "[Zugangsdaten entfernt]"
    return _VALUE.sub("[Geheimnis entfernt]", value)


def _safe_event(candidate: dict) -> dict:
    # Rebuild the schema-shaped event so an unexpected caller field cannot enter the spool.
    event = {key: copy.deepcopy(candidate.get(key)) for key in (
        "eventId", "contractVersion", "eventType", "actor", "identityId", "channel",
        "sessionId", "dialogId", "correlationId", "source", "occurredAt", "outcome",
        "captureEligibility", "redaction", "payload")}
    if event.get("captureEligibility") != "eligible":
        raise ValueError("Private event must not be queued")
    if event.get("identityId") != "owner" or event.get("channel") != "voice" or event.get("source") != "voice/friday":
        raise ValueError("Voice event is not owner-bound")
    if not isinstance(event.get("contractVersion"), str) or not re.fullmatch(r"\d+\.\d+\.\d+", event["contractVersion"]):
        raise ValueError("Invalid contract version")
    if not isinstance(event.get("eventId"), str) or not _ID.fullmatch(event["eventId"]):
        raise ValueError("Invalid event ID")
    try:
        datetime.fromisoformat(event["occurredAt"].replace("Z", "+00:00"))
    except (KeyError, AttributeError, ValueError):
        raise ValueError("Invalid timestamp") from None
    for key in ("eventId", "identityId", "sessionId", "dialogId", "correlationId"):
        value = event.get(key)
        if value is not None and (not isinstance(value, str) or not _ID.fullmatch(value) or _CUE.search(value) or _VALUE.search(value)):
            raise ValueError("Invalid event metadata")
    for key in ("channel", "source"):
        value = event.get(key)
        if not isinstance(value, str) or not _LABEL.fullmatch(value) or _CUE.search(value) or _VALUE.search(value):
            raise ValueError("Invalid event source")
    if event.get("eventType") not in ("user_utterance", "assistant_response", "action_result") or event.get("outcome") not in (
            "completed", "aborted", "uncertain"):
        raise ValueError("Invalid event outcome")
    actor = event.get("actor")
    if not isinstance(actor, dict) or actor.get("type") not in ("user", "assistant") or not isinstance(actor.get("id"), str) or not _ID.fullmatch(actor["id"]):
        raise ValueError("Invalid actor")
    if (event["eventType"] == "user_utterance" and actor["type"] != "user") or (
            event["eventType"] != "user_utterance" and actor["type"] != "assistant"):
        raise ValueError("Event/actor mismatch")
    if actor["id"] != ("owner" if event["eventType"] == "user_utterance" else "friday"):
        raise ValueError("Voice actor is not owner-bound")
    payload = event.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Invalid payload")
    if event["eventType"] == "action_result":
        if payload.get("kind") != "action" or not isinstance(payload.get("actionId"), str):
            raise ValueError("Event/payload mismatch")
        event["payload"] = {key: (_redact(payload[key]) if isinstance(payload.get(key), str) else None)
                            for key in ("actionId", "targetId", "externalId")}
        event["payload"]["kind"] = "action"
    else:
        if payload.get("kind") != "text" or not isinstance(payload.get("text"), str) or len(payload["text"]) > 200_000:
            raise ValueError("Event/payload mismatch")
        event["payload"] = {"kind": "text", "text": _redact(payload["text"])}
    event["actor"] = {"type": actor["type"], "id": actor["id"],
                      "role": _redact(actor["role"]) if isinstance(actor.get("role"), str) else None}
    event["redaction"] = "complete"
    return event


class MemoryOutbox:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._drain_lock = threading.Lock()
        with self._transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=5)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        return db

    @contextmanager
    def _transaction(self):
        db = self._connect()
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def enqueue(self, candidate: dict) -> bool:
        if candidate.get("captureEligibility") != "eligible":
            return False
        event = _safe_event(candidate)
        serialized = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
        with self._transaction() as db:
            previous = db.execute("SELECT json FROM events WHERE id=?", (event["eventId"],)).fetchone()
            if previous:
                if previous[0] != serialized:
                    raise ValueError("Event ID conflict")
                return True
            db.execute("INSERT INTO events(id,json) VALUES (?,?)", (event["eventId"], serialized))
        return True

    def drain(self, sender: Callable[[dict], bool]) -> int:
        sent = 0
        with self._drain_lock:
            while True:
                with self._transaction() as db:
                    row = db.execute("SELECT id,json FROM events ORDER BY created_at,id LIMIT 1").fetchone()
                if not row:
                    return sent
                try:
                    accepted = sender(json.loads(row[1]))
                except Exception:
                    return sent
                if not accepted:
                    return sent
                with self._transaction() as db:
                    db.execute("DELETE FROM events WHERE id=? AND json=?", (row[0], row[1]))
                sent += 1

    def pending_count(self) -> int:
        with self._transaction() as db:
            return int(db.execute("SELECT COUNT(*) FROM events").fetchone()[0])

    def purge(self) -> int:
        with self._drain_lock, self._transaction() as db:
            count = int(db.execute("SELECT COUNT(*) FROM events").fetchone()[0])
            db.execute("DELETE FROM events")
            return count

    def purge_session(self, session_id: str) -> int:
        with self._drain_lock, self._transaction() as db:
            rows = db.execute("SELECT id,json FROM events").fetchall()
            ids = [event_id for event_id, raw in rows if json.loads(raw).get("sessionId") == session_id]
            db.executemany("DELETE FROM events WHERE id=?", [(event_id,) for event_id in ids])
            return len(ids)

    @staticmethod
    def capture_policy(api_outbox: str | Path, channel: str = "voice") -> str:
        """Read the current durable switch; unknown always blocks delivery without losing queued work."""
        path = Path(api_outbox)
        if not path.is_file():
            return "unknown"
        try:
            with closing(sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=1)) as db:
                row = db.execute("SELECT value FROM metadata WHERE key='capture_settings'").fetchone()
            if row is None:
                return "unknown"
            settings = json.loads(row[0])
            if not isinstance(settings, dict) or not isinstance(settings.get("enabled"), bool) or \
                    not isinstance(settings.get("privateMode"), bool) or \
                    not isinstance(settings.get("channels"), dict) or \
                    not isinstance(settings["channels"].get(channel), bool):
                return "unknown"
            return "allowed" if settings["enabled"] and not settings["privateMode"] and settings["channels"][channel] else "disabled"
        except (OSError, sqlite3.Error, ValueError, TypeError, AttributeError):
            return "unknown"

    @staticmethod
    def capture_allowed(api_outbox: str | Path, channel: str = "voice") -> bool:
        return MemoryOutbox.capture_policy(api_outbox, channel) == "allowed"
