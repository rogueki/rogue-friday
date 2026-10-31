"""Bridge between the thread-based voice service and one Qwen Audio realtime session.

The session lives on a private asyncio loop. Each spoken turn is sent only after the local wake word, end-of-speech
detection and speaker check; the answer text is spoken by the local voice sentence by sentence.
"""

import asyncio
import concurrent.futures
import re
import threading

from qwen_realtime import ERROR_KINDS, AudioDelta, RealtimeError, ResponseDone, ServerError, TextDelta, ToolCall

SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")


class QwenDialog:
    def __init__(self, session, orchestrator, *, assistant_name: str, address: str | None = None, persona: str = "",
                 idle_close_s: float = 60.0, turn_timeout_s: float = 45.0):
        self._session = session
        self._orchestrator = orchestrator
        self._assistant_name = assistant_name
        self._address = address
        self._persona = persona.strip()
        self._idle_close_s = idle_close_s
        self._turn_timeout_s = turn_timeout_s
        self._loop = None
        self._thread = None
        self._start_lock = threading.Lock()
        self._idle_handle = None
        self._turn_lock = None

    @property
    def connected(self) -> bool:
        return self._session.connected

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._start_lock:
            if self._loop is None:
                loop = asyncio.new_event_loop()
                thread = threading.Thread(target=loop.run_forever, name="qwen-dialog", daemon=True)
                thread.start()
                self._loop = loop
                self._thread = thread
            return self._loop

    def _run(self, coro, timeout):
        future = asyncio.run_coroutine_threadsafe(coro, self._ensure_loop())
        try:
            return future.result(timeout)
        except concurrent.futures.TimeoutError:
            future.cancel()
            raise RealtimeError("network", "Zeitueberschreitung im Gespraech") from None

    async def _connect(self) -> None:
        if self._session.connected:
            return
        rules = self._orchestrator.instructions(self._assistant_name, self._address)
        self._session.instructions = f"{self._persona}\n{rules}" if self._persona else rules
        self._session.tools = self._orchestrator.tool_specs()
        try:
            await self._session.connect()
        except RealtimeError as error:
            if not error.retryable:
                raise
            await self._session.reconnect()

    async def _warm(self) -> None:
        self._cancel_idle()
        try:
            await self._connect()
        except RealtimeError:
            pass  # the turn itself reports the error

    def warm_up(self) -> None:
        asyncio.run_coroutine_threadsafe(self._warm(), self._ensure_loop())

    def turn(self, pcm16: bytes, say, cancelled) -> str:
        return self._run(self._turn(pcm16, say, cancelled), self._turn_timeout_s)

    async def _turn(self, pcm16: bytes, say, cancelled) -> str:
        if self._turn_lock is None:
            self._turn_lock = asyncio.Lock()
        async with self._turn_lock:
            self._cancel_idle()
            self._orchestrator.touch()
            self._orchestrator.begin_user_turn()
            await self._connect()
            try:
                await self._session.append_audio(pcm16)
                await self._session.commit()
                return await self._consume(say, cancelled)
            except (RealtimeError, asyncio.CancelledError):
                # The aborted response may still stream; a fresh connection keeps its events out of the next turn.
                await self._session.close()
                raise
            finally:
                self._schedule_idle()

    async def _consume(self, say, cancelled) -> str:
        buffer = ""
        spoken = []
        tool_round = False
        cancel_sent = False
        async for event in self._session.events():
            if cancelled() and not cancel_sent:
                await self._session.cancel()
                cancel_sent = True
            if isinstance(event, TextDelta):
                if cancel_sent:
                    continue
                buffer += event.text
                matches = list(SENTENCE_END.finditer(buffer))
                if not matches:
                    continue
                cut = matches[-1].end()
                complete, buffer = buffer[:cut], buffer[cut:]
                for sentence in SENTENCE_END.split(complete):
                    sentence = sentence.strip()
                    if not sentence:
                        continue
                    say(sentence)
                    spoken.append(sentence)
            elif isinstance(event, AudioDelta):
                # the local voice speaks the text; the cloud audio is only requested so the text arrives in time
                continue
            elif isinstance(event, ToolCall):
                if cancel_sent:
                    continue
                result = await asyncio.to_thread(self._orchestrator.call_tool, event.name, event.arguments)
                await self._session.send_tool_result(event.call_id, result)
                tool_round = True
            elif isinstance(event, ServerError):
                raise RealtimeError(event.kind if event.kind in ERROR_KINDS else "protocol", event.message)
            elif isinstance(event, ResponseDone):
                if tool_round and not cancel_sent:
                    tool_round = False  # the answer to the tool result is still on its way
                    continue
                break
        tail = buffer.strip()
        if tail and not cancel_sent:
            say(tail)
            spoken.append(tail)
        return " ".join(spoken)

    def note(self, text: str) -> None:
        loop = self._loop
        if loop is None or not loop.is_running():
            return
        asyncio.run_coroutine_threadsafe(self._note(text), loop)

    async def _note(self, text: str) -> None:
        if not self._session.connected:
            return
        try:
            await self._session.add_system_text(text)
        except RealtimeError:
            pass

    def close(self) -> None:
        loop = self._loop
        if loop is None or not loop.is_running():
            return
        try:
            self._run(self._close(), 5.0)
        except RealtimeError:
            pass

    async def _close(self) -> None:
        self._cancel_idle()
        try:
            await self._session.close()
        except RealtimeError:
            pass

    def _schedule_idle(self) -> None:
        self._idle_handle = self._loop.call_later(self._idle_close_s,
                                                  lambda: asyncio.ensure_future(self._idle_close()))

    def _cancel_idle(self) -> None:
        if self._idle_handle is not None:
            self._idle_handle.cancel()
            self._idle_handle = None

    async def _idle_close(self) -> None:
        self._idle_handle = None
        # the server drops idle sessions after 180 s anyway; closing at 60 s keeps cost and state predictable
        await self._session.close()
