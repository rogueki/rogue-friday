import asyncio
import base64
import json
import pathlib
import sys
import unittest
from http import HTTPStatus
from unittest.mock import patch

from websockets.asyncio.client import connect as ws_connect
from websockets.asyncio.server import serve

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import qwen_realtime
from qwen_realtime import (
    AudioDelta, QwenRealtimeSession, RealtimeError, ResponseDone, TextDelta, ToolCall)

KEY = "test-key"
INSTRUCTIONS = "Du bist Friday."
IDLE_REASON = "Your session was closed because no response was generated for 180 seconds."


class ConfigTest(unittest.TestCase):
    def test_realtime_url_uses_region_host(self):
        self.assertEqual(
            qwen_realtime.realtime_url("ap-southeast-1"),
            "wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus")
        self.assertEqual(
            qwen_realtime.realtime_url("cn-beijing"),
            "wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus")
        with self.assertRaises(ValueError):
            qwen_realtime.realtime_url("eu-central-1")

    def test_classify_maps_server_messages(self):
        self.assertEqual(qwen_realtime.classify(1007, IDLE_REASON), "idle")
        self.assertEqual(qwen_realtime.classify("InvalidParameter", "Model not exist."), "model")
        self.assertEqual(qwen_realtime.classify("InvalidApiKey", ""), "auth")
        self.assertEqual(qwen_realtime.classify("Throttling.RateQuota", ""), "rate")
        self.assertEqual(qwen_realtime.classify("Arrearage", ""), "quota")
        self.assertEqual(qwen_realtime.classify(429, "insufficient_quota"), "quota")
        self.assertEqual(qwen_realtime.classify(429, ""), "rate")
        self.assertEqual(qwen_realtime.classify("X", "boom"), "protocol")

    def test_session_config_omits_voice_unless_set(self):
        config = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS).session_config()
        self.assertNotIn("voice", config)
        self.assertEqual(config["modalities"], ["text", "audio"])
        self.assertIsNone(config["turn_detection"])
        voiced = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS, voice="ethan").session_config()
        self.assertEqual(voiced["voice"], "ethan")

    def test_repr_hides_key_and_empty_key_is_rejected(self):
        session = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS)
        self.assertNotIn(KEY, repr(session))
        with self.assertRaises(ValueError):
            QwenRealtimeSession("", instructions=INSTRUCTIONS)

    def test_load_key_uses_cloud_secret(self):
        with patch.object(qwen_realtime.cloud_secret, "load_secret", return_value="k") as load:
            self.assertEqual(qwen_realtime.load_key("x"), "k")
        load.assert_called_once_with("x", linux_file=qwen_realtime.LINUX_SECRET_FILE,
                                     label="Alibaba-Token-Plan")


class MissingWebsocketsTest(unittest.IsolatedAsyncioTestCase):
    async def test_missing_package_is_a_realtime_error(self):
        # An install updated before websockets was added must get the local fallback, not an ImportError.
        session = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS)
        with patch.dict(sys.modules, {"websockets.asyncio.client": None}):
            with self.assertRaises(RealtimeError) as raised:
                await session.connect()
        self.assertEqual(raised.exception.kind, "protocol")
        self.assertFalse(session.connected)


class RealtimeSessionTest(unittest.IsolatedAsyncioTestCase):
    async def test_turn_streams_text_audio_tool_call_and_idle_close(self):
        headers = []
        messages = []

        async def handler(connection):
            headers.append(connection.request.headers["Authorization"])
            await connection.send(json.dumps({"type": "session.created"}))
            answered = False
            async for raw in connection:
                message = json.loads(raw)
                messages.append(message)
                if message.get("type") == "response.create" and not answered:
                    answered = True
                    await connection.send(json.dumps({"type": "response.audio_transcript.delta", "delta": "Hal"}))
                    await connection.send(json.dumps({
                        "type": "response.audio.delta",
                        "delta": base64.b64encode(b"\x01\x00\x02\x00").decode()}))
                    await connection.send(json.dumps({
                        "type": "response.output_item.done",
                        "item": {"type": "function_call", "call_id": "c1", "name": "task_create",
                                 "arguments": json.dumps({"domain": "mail"})}}))
                    await connection.send(json.dumps({
                        "type": "response.done", "response": {"id": "r1", "status": "completed"}}))
                elif message.get("type") == "response.create":
                    await connection.close(1007, IDLE_REASON)
                    return

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            session = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS, url=f"ws://127.0.0.1:{port}")
            try:
                await session.connect()
                await session.append_audio(bytes(6400))
                await session.commit()
                stream = session.events()
                events = []
                async for event in stream:
                    events.append(event)
                    if isinstance(event, ResponseDone):
                        break
                self.assertEqual(events, [
                    TextDelta("Hal"),
                    AudioDelta(b"\x01\x00\x02\x00"),
                    ToolCall("c1", "task_create", {"domain": "mail"}, '{"domain": "mail"}'),
                    ResponseDone("r1", "completed")])
                await session.send_tool_result("c1", {"status": "angenommen"})
                with self.assertRaises(RealtimeError) as caught:
                    await anext(stream)
                self.assertEqual(caught.exception.kind, "idle")
            finally:
                await session.close()

        self.assertEqual(headers, ["Bearer test-key"])
        self.assertEqual([message.get("type") for message in messages], [
            "session.update", "input_audio_buffer.append", "input_audio_buffer.append",
            "input_audio_buffer.commit", "response.create",
            "conversation.item.create", "response.create"])
        self.assertEqual([len(base64.b64decode(message["audio"])) for message in messages[1:3]], [3200, 3200])
        result = messages[5]["item"]
        self.assertEqual(result["call_id"], "c1")
        self.assertEqual(json.loads(result["output"]), {"status": "angenommen"})

    async def test_handshake_401_is_auth_error_without_key(self):
        async def handler(connection):
            await connection.send(json.dumps({"type": "session.created"}))

        def reject(connection, request):
            return connection.respond(HTTPStatus.UNAUTHORIZED, "nein\n")

        async with serve(handler, "127.0.0.1", 0, process_request=reject) as server:
            port = server.sockets[0].getsockname()[1]
            session = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS, url=f"ws://127.0.0.1:{port}")
            with self.assertRaises(RealtimeError) as caught:
                await session.connect()
            self.assertEqual(caught.exception.kind, "auth")
            self.assertNotIn(KEY, str(caught.exception))
            self.assertFalse(session.connected)

    async def test_server_error_on_handshake_is_quota(self):
        async def handler(connection):
            await connection.send(json.dumps({
                "type": "error",
                "error": {"code": "Arrearage", "message": "Account has an overdue payment"}}))
            await connection.wait_closed()

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            session = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS, url=f"ws://127.0.0.1:{port}")
            with self.assertRaises(RealtimeError) as caught:
                await session.connect()
            self.assertEqual(caught.exception.kind, "quota")
            self.assertFalse(session.connected)

    async def test_close_during_events_ends_without_exception(self):
        async def handler(connection):
            await connection.send(json.dumps({"type": "session.created"}))
            await connection.wait_closed()

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            session = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS, url=f"ws://127.0.0.1:{port}")
            await session.connect()

            async def drain():
                async for _ in session.events():
                    pass

            task = asyncio.create_task(drain())
            await asyncio.sleep(0.1)
            await session.close()
            await asyncio.wait_for(task, timeout=5)
            self.assertFalse(session.connected)

    async def test_reconnect_retries_until_connected(self):
        async def handler(connection):
            await connection.send(json.dumps({"type": "session.created"}))
            await connection.wait_closed()

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            calls = []
            delays = []

            async def flaky(*args, **kwargs):
                calls.append(args)
                if len(calls) == 1:
                    raise OSError("kein Netz")
                return await ws_connect(*args, **kwargs)

            async def sleep(delay):
                delays.append(delay)

            session = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS, url=f"ws://127.0.0.1:{port}",
                                          connect=flaky)
            try:
                await session.reconnect(sleep=sleep)
                self.assertEqual(len(calls), 2)
                self.assertEqual(delays, [0.5])
                self.assertTrue(session.connected)
            finally:
                await session.close()

    async def test_reconnect_stops_immediately_on_auth_error(self):
        async def handler(connection):
            await connection.wait_closed()

        def reject(connection, request):
            return connection.respond(HTTPStatus.UNAUTHORIZED, "nein\n")

        async with serve(handler, "127.0.0.1", 0, process_request=reject) as server:
            port = server.sockets[0].getsockname()[1]
            delays = []

            async def sleep(delay):
                delays.append(delay)

            session = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS, url=f"ws://127.0.0.1:{port}")
            with self.assertRaises(RealtimeError) as caught:
                await session.reconnect(sleep=sleep)
            self.assertEqual(caught.exception.kind, "auth")
            self.assertEqual(delays, [])

    async def test_odd_pcm_length_is_rejected(self):
        session = QwenRealtimeSession(KEY, instructions=INSTRUCTIONS)
        with self.assertRaises(ValueError):
            await session.append_audio(b"\x00")


if __name__ == "__main__":
    unittest.main()
