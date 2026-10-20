"""Private loopback PCM bridge for the headless Friday voice engine.

Node is the authenticated browser gateway. It connects to
``ws://127.0.0.1:<health_port+1>/audio``
with ``Authorization: Bearer <voice-bridge/auth.key>``; the browser never sees this key.
One connection owns both directions. Client binary messages are exactly 2,560 bytes of
signed little-endian PCM16, mono, 16 kHz (80 ms). Server binary messages have the same
format. Client JSON text messages are ``{"type":"stop"}``, ``{"type":"pause"}``,
and ``{"type":"resume"}``. Server JSON messages have ``type`` of ``status``,
``audio_start``, ``audio_end``, ``clear``, or ``beep``. ``status`` includes
``state``, ``sampleRate`` and ``frameMs``. ``clear`` discards queued speaker audio.
Audio frames are not recorded. On disconnect Friday cancels the active conversation.
The gateway must close this connection when the owner session is revoked or pauses.
"""

import asyncio
import hmac
import json
import os
import threading
import time
from http import HTTPStatus

import numpy as np
from websockets.exceptions import ConnectionClosed

FRAME_BYTES = 2560
FRAME_SECONDS = 0.08
MAX_INPUT_BACKLOG = 50  # four seconds; overflow closes the session instead of using stale speech


class BrowserAudioBridge:
    def __init__(self, service, key_path: str, port: int):
        self.service = service
        self.key_path = key_path
        self.port = port
        self._lock = threading.Lock()
        self._connection = None
        self._loop = None
        self._generation = 0
        self._last_frame = 0.0
        self._frame_tokens = 4.0

    def connected(self) -> bool:
        with self._lock:
            return self._connection is not None

    async def _authorize(self, connection, request):
        if request.path != "/audio":
            return connection.respond(HTTPStatus.NOT_FOUND, "Not Found")
        try:
            with open(self.key_path, encoding="ascii") as source:
                expected = source.read().strip()
        except (OSError, UnicodeError):
            return connection.respond(HTTPStatus.SERVICE_UNAVAILABLE, "Unavailable")
        supplied = request.headers.get("Authorization", "")
        if not expected or len(supplied) > 100 or not supplied.isascii() or not hmac.compare_digest(
                supplied, "Bearer " + expected):
            return connection.respond(HTTPStatus.UNAUTHORIZED, "Unauthorized")
        with self._lock:
            occupied = self._connection is not None
        if occupied:
            return connection.respond(HTTPStatus.CONFLICT, "Conflict")
        return None

    async def _handle(self, connection):
        with self._lock:
            occupied = self._connection is not None
            if not occupied:
                self._connection = connection
                self._loop = asyncio.get_running_loop()
                self._generation += 1
                generation = self._generation
                self._last_frame = time.monotonic()
                self._frame_tokens = 4.0
        if occupied:
            await connection.close(code=1008, reason="occupied")
            return
        await connection.send(json.dumps({"type": "status", "state": self.service.status.get("state", "listening"),
                                          "sampleRate": 16000, "frameMs": 80}))
        try:
            async for message in connection:
                if isinstance(message, str):
                    try:
                        command = json.loads(message)
                    except (ValueError, TypeError):
                        command = None
                    if not isinstance(command, dict) or command.get("type") not in ("stop", "pause", "resume", "start", "release") or len(command) != 1:
                        await connection.close(code=1003, reason="invalid control")
                        break
                    self.service.browser_control(command["type"])
                    await connection.send(json.dumps({"type": "status", "state": self.service.status["state"],
                                                      "sampleRate": 16000, "frameMs": 80}))
                    continue
                if not isinstance(message, bytes) or len(message) != FRAME_BYTES:
                    await connection.close(code=1003, reason="invalid frame")
                    break
                now = time.monotonic()
                # Token bucket: at most 12.5 live frames/s, with four frames of jitter.
                self._frame_tokens = min(4.0, self._frame_tokens + (now - self._last_frame) / FRAME_SECONDS)
                if self._frame_tokens < 1.0:
                    await connection.close(code=1008, reason="frame rate")
                    break
                self._frame_tokens -= 1.0
                self._last_frame = now
                if self.service.audio_q.qsize() >= MAX_INPUT_BACKLOG:
                    await connection.close(code=1008, reason="audio backlog")
                    break
                samples = np.frombuffer(message, dtype="<i2").copy()
                self.service.input_level.update(samples)
                self.service.audio_q.put_nowait(samples)
                self.service._queue_stop_audio(samples)
        except ConnectionClosed:
            pass
        finally:
            with self._lock:
                if self._generation == generation:
                    self._connection = None
                    self._loop = None
            self.service.browser_disconnected()

    def start(self):
        from websockets.asyncio.server import serve
        ready = threading.Event()
        startup_error = []

        async def run():
            try:
                async with serve(self._handle, "127.0.0.1", self.port,
                                 process_request=self._authorize, max_size=FRAME_BYTES,
                                 max_queue=4, write_limit=FRAME_BYTES * 4,
                                 compression=None, ping_interval=20, ping_timeout=10):
                    ready.set()
                    await asyncio.Future()
            except Exception as error:
                startup_error.append(error)
                ready.set()

        threading.Thread(target=lambda: asyncio.run(run()), name="friday-browser-audio", daemon=True).start()
        if not ready.wait(5) or startup_error:
            raise RuntimeError("Browser-Audio konnte nicht an Loopback gebunden werden") from (
                startup_error[0] if startup_error else None)

    def _send(self, payload, timeout: float = 2.0) -> bool:
        with self._lock:
            connection, loop = self._connection, self._loop
        if connection is None or loop is None:
            return False
        future = None
        try:
            future = asyncio.run_coroutine_threadsafe(connection.send(payload), loop)
            future.result(timeout=timeout)
            return True
        except Exception:
            if future is not None:
                future.cancel()
            try:
                asyncio.run_coroutine_threadsafe(connection.close(code=1011, reason="audio backpressure"), loop)
            except RuntimeError:
                pass
            return False

    def send_pcm(self, block: bytes, stop_flag: threading.Event) -> bool:
        if len(block) % 2:
            raise ValueError("PCM16 block has an odd byte count")
        for offset in range(0, len(block), FRAME_BYTES):
            if stop_flag.is_set() or not self.connected():
                return False
            frame = block[offset:offset + FRAME_BYTES]
            if len(frame) < FRAME_BYTES:
                frame += bytes(FRAME_BYTES - len(frame))
            if not self._send(frame):
                return False
            # Bound outstanding browser audio without relying on unbounded transport buffering.
            if stop_flag.wait(FRAME_SECONDS):
                return False
        return True

    def clear(self):
        self._send('{"type":"clear"}', timeout=0.2)

    def audio_start(self):
        self._send('{"type":"audio_start"}', timeout=0.2)

    def audio_end(self):
        self._send('{"type":"audio_end"}', timeout=0.2)

    def status(self, state: str):
        self._send(json.dumps({"type": "status", "state": state,
                               "sampleRate": 16000, "frameMs": 80}), timeout=0.2)

    def beep(self, frequency: int, duration_ms: int):
        self._send(json.dumps({"type": "beep", "frequency": frequency, "durationMs": duration_ms}), timeout=0.2)
