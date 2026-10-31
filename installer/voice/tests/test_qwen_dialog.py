"""Tests for the Qwen realtime bridge: no network, the session is faked."""

import asyncio
import pathlib
import sys
import time
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from qwen_dialog import QwenDialog
from qwen_realtime import AudioDelta, RealtimeError, ResponseDone, ServerError, TextDelta, ToolCall

TOOL_SPEC = {"type": "function", "name": "task_create", "description": "Aufgabe anlegen",
             "parameters": {"type": "object", "properties": {}}}


class FakeSession:
    """Replays predefined rounds of events; commit and send_tool_result release the next round."""

    def __init__(self, rounds, *, fail_connect=()):
        self.rounds = list(rounds)
        self.fail_connect = list(fail_connect)
        self.calls = []
        self.instructions = ""
        self.tools = []
        self.connected = False
        self.connect_count = 0
        self.close_count = 0
        self.connect_config = None
        self._queue = asyncio.Queue()
        self._next_round = 0

    def _record(self, name, *args):
        self.calls.append((name,) + args)

    def _release_round(self):
        if self._next_round < len(self.rounds):
            self._queue.put_nowait(self.rounds[self._next_round])
            self._next_round += 1

    async def connect(self):
        if self.fail_connect:
            self._record("connect_failed")
            raise self.fail_connect.pop(0)
        self.connected = True
        self.connect_count += 1
        self.connect_config = (self.instructions, list(self.tools))
        self._record("connect")

    async def reconnect(self):
        self._record("reconnect")
        await self.connect()

    async def append_audio(self, pcm):
        self._record("append_audio", len(pcm))

    async def commit(self):
        self._record("commit")
        self._release_round()

    async def add_system_text(self, text):
        self._record("add_system_text", text)

    async def send_tool_result(self, call_id, output):
        self._record("send_tool_result", call_id, output)
        self._release_round()

    async def cancel(self):
        self._record("cancel")

    async def respond(self):
        self._record("respond")

    async def close(self):
        self.connected = False
        self.close_count += 1
        self._record("close")

    async def events(self):
        while self.connected:
            round_events = await self._queue.get()
            for event in round_events:
                yield event


class FakeOrchestrator:
    def __init__(self):
        self.tool_calls = []
        self.touched = 0
        self.busy = []

    def instructions(self, assistant_name, address):
        return "INSTR"

    def tool_specs(self):
        return [dict(TOOL_SPEC)]

    def call_tool(self, name, arguments):
        self.tool_calls.append((name, arguments))
        return {"status": "angenommen"}

    def touch(self):
        self.touched += 1

    def set_busy(self, busy):
        self.busy.append(busy)


class QwenDialogTest(unittest.TestCase):
    def setUp(self):
        self._dialogs = []

    def tearDown(self):
        for dialog in self._dialogs:
            dialog.close()

    def _dialog(self, session, orchestrator=None, **kwargs):
        if orchestrator is None:
            orchestrator = FakeOrchestrator()
        dialog = QwenDialog(session, orchestrator, assistant_name="Friday", address="Chef", **kwargs)
        self._dialogs.append(dialog)
        return dialog

    def test_simple_turn_speaks_sentences(self):
        session = FakeSession([[
            TextDelta("Guten Tag. "),
            TextDelta("Wie kann ich"),
            TextDelta(" helfen?"),
            AudioDelta(b"\x00\x00"),
            ResponseDone("r1", "completed"),
        ]])
        orchestrator = FakeOrchestrator()
        dialog = self._dialog(session, orchestrator)
        said = []
        result = dialog.turn(b"\x00\x00" * 160, said.append, lambda: False)
        self.assertEqual(result, "Guten Tag. Wie kann ich helfen?")
        self.assertEqual(said, ["Guten Tag.", "Wie kann ich helfen?"])
        self.assertEqual(session.connect_config, ("INSTR", [TOOL_SPEC]))
        self.assertEqual(session.calls,
                         [("connect",), ("append_audio", 320), ("commit",)])
        self.assertEqual(orchestrator.touched, 1)

    def test_persona_precedes_the_conversation_rules(self):
        session = FakeSession([[ResponseDone("r1", "completed")]])
        dialog = QwenDialog(session, FakeOrchestrator(), assistant_name="Friday", persona="Du bist Friday, die KI von Erik.")
        self._dialogs.append(dialog)
        dialog.turn(b"", [].append, lambda: False)
        self.assertEqual(session.connect_config[0].splitlines(), ["Du bist Friday, die KI von Erik.", "INSTR"])

    def test_tool_round_sends_result_and_speaks_answer(self):
        session = FakeSession([
            [ToolCall("c1", "task_create", {"domain": "research", "auftrag": "x y z"}, "{}"),
             ResponseDone("r1", "completed")],
            [TextDelta("Laeuft."), ResponseDone("r2", "completed")],
        ])
        orchestrator = FakeOrchestrator()
        dialog = self._dialog(session, orchestrator)
        said = []
        result = dialog.turn(b"\x00\x00", said.append, lambda: False)
        self.assertEqual(result, "Laeuft.")
        self.assertEqual(orchestrator.tool_calls, [("task_create", {"domain": "research", "auftrag": "x y z"})])
        self.assertIn(("send_tool_result", "c1", {"status": "angenommen"}), session.calls)

    def test_cancel_stops_further_sentences(self):
        session = FakeSession([[
            TextDelta("Eins. "),
            TextDelta("Zwei. "),
            ResponseDone("r1", "completed"),
        ]])
        dialog = self._dialog(session)
        said = []
        seen = []

        def cancelled():
            seen.append(1)
            return len(seen) > 1

        result = dialog.turn(b"\x00\x00", said.append, cancelled)
        self.assertEqual([call for call in session.calls if call[0] == "cancel"], [("cancel",)])
        self.assertEqual(result, "Eins.")
        self.assertEqual(said, ["Eins."])

    def test_server_error_surfaces_as_realtime_error(self):
        session = FakeSession([[ServerError("quota", "Kontingent")]])
        dialog = self._dialog(session)
        with self.assertRaises(RealtimeError) as context:
            dialog.turn(b"\x00\x00", [].append, lambda: False)
        self.assertEqual(context.exception.kind, "quota")

    def test_aborted_turn_drops_the_connection(self):
        session = FakeSession([[ServerError("protocol", "kaputt")],
                               [TextDelta("Wieder da."), ResponseDone("r2", "completed")]])
        dialog = self._dialog(session)
        with self.assertRaises(RealtimeError):
            dialog.turn(b"\x00\x00", [].append, lambda: False)
        self.assertFalse(session.connected)
        self.assertEqual(dialog.turn(b"\x00\x00", [].append, lambda: False), "Wieder da.")
        self.assertEqual(session.connect_count, 2)

    def test_connect_retries_once_on_retryable_error(self):
        session = FakeSession([[TextDelta("Hallo."), ResponseDone("r1", "completed")]],
                              fail_connect=[RealtimeError("network", "x")])
        dialog = self._dialog(session)
        said = []
        self.assertEqual(dialog.turn(b"\x00\x00", said.append, lambda: False), "Hallo.")
        self.assertIn(("reconnect",), session.calls)
        self.assertEqual(session.connect_count, 1)

    def test_connect_auth_error_is_not_retried(self):
        session = FakeSession([], fail_connect=[RealtimeError("auth", "nein")])
        dialog = self._dialog(session)
        with self.assertRaises(RealtimeError) as context:
            dialog.turn(b"\x00\x00", [].append, lambda: False)
        self.assertEqual(context.exception.kind, "auth")
        self.assertNotIn(("reconnect",), session.calls)

    def test_second_turn_reuses_connection(self):
        session = FakeSession([
            [TextDelta("Eins."), ResponseDone("r1", "completed")],
            [TextDelta("Zwei."), ResponseDone("r2", "completed")],
        ])
        dialog = self._dialog(session)
        dialog.turn(b"\x00\x00", [].append, lambda: False)
        dialog.turn(b"\x00\x00", [].append, lambda: False)
        self.assertEqual(session.connect_count, 1)

    def test_idle_session_closes_and_reconnects(self):
        session = FakeSession([
            [TextDelta("Eins."), ResponseDone("r1", "completed")],
            [TextDelta("Zwei."), ResponseDone("r2", "completed")],
        ])
        dialog = self._dialog(session, idle_close_s=0.05)
        dialog.turn(b"\x00\x00", [].append, lambda: False)
        time.sleep(0.3)
        self.assertEqual(session.close_count, 1)
        self.assertFalse(session.connected)
        dialog.turn(b"\x00\x00", [].append, lambda: False)
        self.assertEqual(session.connect_count, 2)

    def test_warm_up_connects_without_turn(self):
        session = FakeSession([])
        dialog = self._dialog(session)
        dialog.warm_up()
        time.sleep(0.2)
        self.assertEqual(session.connect_count, 1)

    def test_warm_up_swallows_errors(self):
        session = FakeSession([], fail_connect=[RealtimeError("auth", "nein")])
        dialog = self._dialog(session)
        dialog.warm_up()
        time.sleep(0.2)
        self.assertEqual(session.connect_count, 0)

    def test_note_requires_connection(self):
        session = FakeSession([[TextDelta("Hallo."), ResponseDone("r1", "completed")]])
        dialog = self._dialog(session)
        dialog.note("x")
        time.sleep(0.1)
        self.assertNotIn("add_system_text", [call[0] for call in session.calls])
        dialog.turn(b"\x00\x00", [].append, lambda: False)
        dialog.note("x")
        time.sleep(0.2)
        self.assertIn(("add_system_text", "x"), session.calls)

    def test_turn_timeout_reports_network_error(self):
        session = FakeSession([[TextDelta("Ha")]])  # no ResponseDone, the turn never finishes
        dialog = self._dialog(session, turn_timeout_s=0.2)
        with self.assertRaises(RealtimeError) as context:
            dialog.turn(b"\x00\x00", [].append, lambda: False)
        self.assertEqual(context.exception.kind, "network")


if __name__ == "__main__":
    unittest.main()
