import json
import ast
import datetime
import re
import sqlite3
import time
import types
import uuid
from contextlib import closing
import tempfile
import unittest
from pathlib import Path

from memory_outbox import MemoryOutbox, private_intent


def event(event_id="voice-1", text="Shopping am Montag"):
    return {"eventId": event_id, "contractVersion": "2.0.0", "eventType": "user_utterance",
            "actor": {"type": "user", "id": "owner", "role": None}, "identityId": "owner", "channel": "voice",
            "sessionId": "session-1", "dialogId": "dialog-1", "correlationId": None, "source": "voice/friday",
            "occurredAt": "2026-10-19T10:00:00Z", "outcome": "completed", "captureEligibility": "eligible",
            "redaction": "required", "payload": {"kind": "text", "text": text}}


class MemoryOutboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "voice-memory.sqlite"
        self.outbox = MemoryOutbox(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_redacts_before_persistence_and_private_never_queues(self):
        self.assertTrue(self.outbox.enqueue(event(text="Mein Passwort ist hunter2")))
        self.assertFalse(self.outbox.enqueue({**event("private"), "captureEligibility": "private"}))
        self.assertEqual(self.outbox.pending_count(), 1)
        with closing(sqlite3.connect(self.path)) as db:
            stored = db.execute("SELECT json FROM events").fetchone()[0]
        self.assertNotIn("hunter2", stored)
        self.assertIn("[Zugangsdaten entfernt]", stored)
        self.assertTrue(self.outbox.enqueue(event("normal", "Shopping am Montag")))
        with closing(sqlite3.connect(self.path)) as db:
            normal = json.loads(db.execute("SELECT json FROM events WHERE id='normal'").fetchone()[0])
        self.assertEqual(normal["payload"]["text"], "Shopping am Montag")

    def test_failure_retry_restart_and_duplicate(self):
        self.outbox.enqueue(event())
        self.assertEqual(self.outbox.drain(lambda _: False), 0)
        self.assertEqual(MemoryOutbox(self.path).pending_count(), 1)
        self.assertTrue(self.outbox.enqueue(event()))
        with self.assertRaisesRegex(ValueError, "conflict"):
            self.outbox.enqueue(event(text="changed"))
        received = []
        self.assertEqual(MemoryOutbox(self.path).drain(lambda item: received.append(item) or True), 1)
        self.assertEqual(received[0]["eventId"], "voice-1")
        self.assertEqual(self.outbox.pending_count(), 0)

    def test_aborted_action_marker_is_durable(self):
        marker = {**event("stop"), "eventType": "action_result", "actor": {"type": "assistant", "id": "friday", "role": None},
                  "outcome": "aborted", "payload": {"kind": "action", "actionId": "dialog.cancel", "targetId": None, "externalId": None}}
        self.outbox.enqueue(marker)
        self.assertEqual(self.outbox.pending_count(), 1)

    def test_unexpected_fields_never_enter_spool(self):
        candidate = event("extra")
        candidate["rawTranscript"] = "hidden phrase"
        candidate["actor"]["credential"] = "hidden phrase"
        candidate["payload"]["rawAudio"] = "hidden phrase"
        self.outbox.enqueue(candidate)
        with closing(sqlite3.connect(self.path)) as db:
            stored = db.execute("SELECT json FROM events WHERE id='extra'").fetchone()[0]
        self.assertNotIn("hidden phrase", stored)
        self.assertNotIn("rawTranscript", stored)
        self.assertNotIn("rawAudio", stored)

    def test_api_private_mode_is_checked_before_voice_spool(self):
        api = Path(self.temp.name) / "memory" / "outbox.sqlite"
        self.assertFalse(MemoryOutbox.capture_allowed(api))
        api.parent.mkdir()
        with closing(sqlite3.connect(api)) as db:
            db.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            db.commit()
            self.assertEqual(MemoryOutbox.capture_policy(api), "unknown")
            db.execute("INSERT INTO metadata VALUES('capture_settings',?)", (json.dumps({
                "enabled": True, "privateMode": True, "channels": {"voice": True}}),))
            db.commit()
        self.assertEqual(MemoryOutbox.capture_policy(api), "disabled")
        self.assertFalse(MemoryOutbox.capture_allowed(api))

    def test_verified_voice_transcript_private_intent_blocks_entire_session(self):
        source = Path(__file__).with_name("friday_voice.py")
        service = next(node for node in ast.parse(source.read_text(encoding="utf-8")).body
                       if isinstance(node, ast.ClassDef) and node.name == "VoiceService")
        methods = {node.name: node for node in service.body if isinstance(node, ast.FunctionDef)}
        command = methods["_handle_command"]
        capture_node = next(node for node in command.body if isinstance(node, ast.If) and
                            "memory_capture_error" in ast.unparse(node.test))
        command.body = [node for node in command.body if node.lineno <= capture_node.lineno] + [ast.Return(value=None)]
        for method in (command, methods["_queue_memory_event"]):
            method.returns = None
            for arg in method.args.args:
                arg.annotation = None
        namespace = {"time": time, "uuid": uuid, "datetime": datetime, "private_intent": private_intent,
                     "np": types.SimpleNamespace(concatenate=lambda arrays: arrays[1]), "SR": 16000,
                     "STOP_WORDS": re.compile(r"^stopp?$", re.I), "is_goodbye": lambda text: False, "log_event": lambda **kwargs: None,
                     "record_latency": lambda *args: None,
                     "INSTALL_ROOT": self.temp.name, "os": __import__("os")}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[command, methods["_queue_memory_event"]], type_ignores=[])),
                     str(source), "exec"), namespace)
        transcripts = iter(("Friday, bitte speichere dieses Gespräch nicht", "Und was ist morgen?"))
        self.outbox.enqueue(event("prior", "Vorherige Frage"))
        voice = types.SimpleNamespace(
            control_generation=0, control_cancel=types.SimpleNamespace(is_set=lambda: False),
            cfg={"speaker_threshold": 0.4, "trusted_session_s": 10},
            verifier=types.SimpleNamespace(score=lambda _: 0.8),
            status={"rejected_speaker": 0}, trusted_until=0,
            _transcribe=lambda _: next(transcripts), memory_capture_error=None,
            memory_session_id="session-1", memory_dialog_private=False, memory_session_private=False,
            memory_outbox=self.outbox, mail_voice=types.SimpleNamespace(handles_text=lambda _: False),
        )
        voice._queue_memory_event = lambda *args, **kwargs: namespace["_queue_memory_event"](voice, *args, **kwargs)
        self.outbox.capture_allowed = lambda _: True
        namespace["_handle_command"](voice, [0] * 16000, None)
        self.assertTrue(voice.memory_session_private)
        self.assertTrue(voice.memory_dialog_private)
        self.assertEqual(self.outbox.pending_count(), 0)
        voice._queue_memory_event("assistant_response", {"kind": "text", "text": "Antwort auf private Frage"})
        self.assertEqual(self.outbox.pending_count(), 0)
        namespace["_handle_command"](voice, [0] * 16000, None)
        self.assertTrue(voice.memory_dialog_private)
        voice._queue_memory_event("assistant_response", {"kind": "text", "text": "Folgeantwort"})
        self.assertEqual(self.outbox.pending_count(), 0)
        self.assertTrue(private_intent("Do not save this conversation"))


if __name__ == "__main__":
    unittest.main()
