#!/usr/bin/env python3
"""Offline speech-fixture probe against a disposable, listening Control API."""

import array
import ast
import contextlib
import hashlib
import io
import json
import queue
import re
import sys
import threading
import time
import types
import wave
from pathlib import Path

VOICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(VOICE))
from calendar_voice import CalendarVoice
from mail_voice import MailVoice
from research_voice import ResearchVoice

FIXTURES = Path(__file__).parent / "fixtures" / "audio"
TRANSCRIPTS = {
    "015132c1fb6a85f06c52899cc9d632149401d839826a79a3a0064b30b367d6d8": "Erstelle Termin Test am 21.10.2026 um 14 Uhr",
    "de4438aaabb8ebcf96a98c46b2ef5275f6364ae4701ed96ff45c6280a7f9ff0c": "Schreibe eine Mail an alex@example.test Betreff Test Text Hallo",
    "ccda043aec500186a704b2bdb9d71dfe9ba75bbc2fef1a321db8b56f8dba9c70": "Nein",
    "957d053f6bb25f231c9a7f53b8f046525ddb6175a7e29087444339a2071fad17": "Recherchiere Energiepreise Europa",
    "2f15cfbd007fa9e91466d22898d85e6d5c4fbe1aafa8c86f5eff697df26d000b": "Ja",
}


def _method(name):
    source = VOICE / "friday_voice.py"
    service = next(node for node in ast.parse(source.read_text(encoding="utf-8")).body
                   if isinstance(node, ast.ClassDef) and node.name == "VoiceService")
    method = next(node for node in service.body if isinstance(node, ast.FunctionDef) and node.name == name)
    method.returns = None
    for argument in method.args.args:
        argument.annotation = None
    namespace = {"time": time, "SR": 16000, "STOP_WORDS": re.compile(r"^stopp?$", re.I),
                 "log_event": lambda **_kwargs: None}
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), "exec"), namespace)
    return namespace[name]


def audio(name):
    with wave.open(str(FIXTURES / (name + ".wav")), "rb") as recorded:
        if (recorded.getframerate(), recorded.getnchannels(), recorded.getsampwidth()) != (16000, 1, 2):
            raise AssertionError("fixture is not PCM16/16kHz/mono")
        samples = array.array("h")
        samples.frombytes(recorded.readframes(recorded.getnframes()))
    if sys.byteorder != "little":
        samples.byteswap()
    normalized = array.array("f", (sample / 32768 for sample in samples))
    if max(abs(sample) for sample in normalized) < 0.01:
        raise AssertionError("fixture contains no audible signal")
    if hashlib.sha256(normalized.tobytes()).hexdigest() not in TRANSCRIPTS:
        raise AssertionError("unknown fixture audio")
    return normalized


class FixtureWhisper:
    def transcribe(self, samples, **options):
        assert options["language"] == "de" and options["beam_size"] == 1
        transcript = TRANSCRIPTS[hashlib.sha256(samples.tobytes()).hexdigest()]
        return [types.SimpleNamespace(text=transcript)], None


class VoiceProbe:
    _transcribe = _method("_transcribe")
    _handle_command = _method("_handle_command")
    cancel_active_interaction = _method("cancel_active_interaction")

    def __init__(self, root, guest=False):
        self.cfg = {"speaker_threshold": 0.4, "trusted_session_s": 15,
                    "speaker_verification_required": not guest, "stt_language": "de"}
        self.control_generation = 0
        self.control_cancel = threading.Event()
        self.manual_start_lock = threading.Lock()
        self.manual_start = threading.Event()
        self.manual_release = threading.Event()
        self.background_jobs = set()
        self.background_reply_ready = threading.Event()
        self.tts = types.SimpleNamespace(interrupt=lambda: None)
        self.preroll = []
        self.ring = []
        self.audio_q = queue.Queue()
        self.verifier = types.SimpleNamespace(score=lambda _audio: 0.8)
        self.status = {"rejected_speaker": 0, "commands": 0}
        self.trusted_until = 0
        self.whisper = FixtureWhisper()
        self.cloud_voice = False
        self.name = "Friday"
        self.history = []
        self.spoken = []
        self._say_if_current = lambda answer, _generation: self.spoken.append(answer) or True
        self._guest_answer = lambda _text: "Gastzugriff ohne Aktionen."
        self.mail_voice = MailVoice(str(root))
        self.calendar_voice = CalendarVoice(str(root), zone="Europe/Berlin")
        self.research_voice = ResearchVoice(str(root))
        empty = lambda: types.SimpleNamespace(handle=lambda _text: None, pending=None)
        self.cloudtalk_voice = empty()
        self.powerpoint_voice = empty()
        self.coding_voice = empty()
        self.content_studio_voice = empty()
        self.skills_onboarding_voice = empty()


def main():
    scenario, root = sys.argv[1], Path(sys.argv[2])
    voice = VoiceProbe(root, guest=scenario == "guest")
    command = "research" if scenario in ("research", "guest", "reject", "stop", "stop_after_yes", "unarmed", "no") else scenario
    with contextlib.redirect_stdout(io.StringIO()):
        voice._handle_command(audio(command), None)
        first = voice.spoken[-1]
        preview_id = voice.research_voice.pending["previewId"] if voice.research_voice.pending else None
        if scenario not in ("guest", "reject", "stop", "stop_after_yes"):
            if scenario != "unarmed":
                getattr(voice, command + "_voice").arm_confirmation()
            if scenario == "no":
                voice._handle_command(audio("no"), None)
            else:
                voice._handle_command(audio("yes"), None)
        elif scenario == "reject":
            voice.verifier.score = lambda _audio: 0.1
            voice._handle_command(audio("yes"), None)
        elif scenario == "stop":
            voice.cancel_active_interaction()
            voice._handle_command(audio("yes"), None)
        elif scenario == "stop_after_yes":
            voice.research_voice.arm_confirmation()
            voice._handle_command(audio("yes"), None)
            voice.cancel_active_interaction()
    for thread in voice.research_voice.discard_threads:
        thread.join(timeout=3)
    print(json.dumps({"scenario": scenario, "spoken": voice.spoken, "first": first,
                      "previewId": preview_id,
                      "pendingResearch": voice.research_voice.pending is not None,
                      "rejectedSpeakers": voice.status["rejected_speaker"],
                      "commands": voice.status["commands"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
