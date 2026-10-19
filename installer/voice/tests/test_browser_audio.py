"""Focused local bridge tests; no microphone or paid provider call."""

import asyncio
import json
import queue
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import InvalidStatus

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from browser_audio import BrowserAudioBridge, FRAME_BYTES


class FakeService:
    def __init__(self):
        self.audio_q = queue.Queue()
        self.input_level = SimpleNamespace(update=lambda samples: None)
        self.disconnected = 0
        self.status = {"state": "listening"}
        self.controls = []
        self.stop_audio = []

    def _queue_stop_audio(self, samples):
        self.stop_audio.append(samples.copy())

    def browser_control(self, action):
        self.controls.append(action)
        self.status["state"] = "paused" if action == "pause" else "listening"

    def browser_disconnected(self):
        self.disconnected += 1


async def check_auth_pcm_and_single_session():
    with tempfile.TemporaryDirectory() as directory:
        key = Path(directory) / "auth.key"
        key.write_text("private-key", encoding="ascii")
        service = FakeService()
        bridge = BrowserAudioBridge(service, str(key), 0)
        async with serve(bridge._handle, "127.0.0.1", 0, process_request=bridge._authorize,
                         max_size=FRAME_BYTES, max_queue=4, compression=None) as server:
            uri = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/audio"
            try:
                async with connect(uri):
                    pass
            except InvalidStatus as denied:
                assert denied.response.status_code == 401
            else:
                raise AssertionError("missing auth accepted")
            async with connect(uri, additional_headers={"Authorization": "Bearer private-key"}) as conn:
                assert json.loads(await conn.recv())["sampleRate"] == 16000
                try:
                    async with connect(uri, additional_headers={"Authorization": "Bearer private-key"}):
                        pass
                except InvalidStatus as occupied:
                    assert occupied.response.status_code == 409
                else:
                    raise AssertionError("second session accepted")
                frame = np.full(1280, 1234, dtype="<i2").tobytes()
                await conn.send(frame)
                await asyncio.sleep(0.02)
                assert service.audio_q.get_nowait()[0] == 1234
                assert service.stop_audio[0][0] == 1234
                await conn.send('{"type":"pause"}')
                assert json.loads(await conn.recv())["state"] == "paused"
                assert service.controls == ["pause"]
                await asyncio.to_thread(bridge.audio_start)
                assert json.loads(await conn.recv())["type"] == "audio_start"
                sent = asyncio.create_task(asyncio.to_thread(bridge.send_pcm, frame, threading.Event()))
                assert await conn.recv() == frame
                assert await sent
                await asyncio.to_thread(bridge.audio_end)
                assert json.loads(await conn.recv())["type"] == "audio_end"
                assert bridge.connected()
            await asyncio.sleep(0.02)
            assert not bridge.connected()
            assert service.disconnected == 1


async def check_invalid_frame_closes_without_queueing():
    with tempfile.TemporaryDirectory() as directory:
        key = Path(directory) / "auth.key"
        key.write_text("private-key", encoding="ascii")
        service = FakeService()
        bridge = BrowserAudioBridge(service, str(key), 0)
        async with serve(bridge._handle, "127.0.0.1", 0, process_request=bridge._authorize,
                         max_size=FRAME_BYTES, max_queue=4, compression=None) as server:
            uri = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/audio"
            async with connect(uri, additional_headers={"Authorization": "Bearer private-key"}) as conn:
                await conn.recv()
                await conn.send(b"short")
                try:
                    await conn.recv()
                except Exception:
                    pass
                else:
                    raise AssertionError("invalid frame accepted")
            assert service.audio_q.empty()


class BrowserAudioTests(unittest.TestCase):
    def test_auth_pcm_and_single_session(self):
        asyncio.run(check_auth_pcm_and_single_session())

    def test_invalid_frame_closes_without_queueing(self):
        asyncio.run(check_invalid_frame_closes_without_queueing())

    def test_pcm_sink_rejects_odd_audio(self):
        bridge = BrowserAudioBridge(FakeService(), "unused", 0)
        with self.assertRaises(ValueError):
            bridge.send_pcm(b"\x01", threading.Event())
