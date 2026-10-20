"""Small compatibility checks for a Linux voice process without a desktop."""

import importlib.util
import json
import socket
import sys
import threading
import types
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

VOICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(VOICE))

from cloudtalk_voice import CloudTalkVoice


class HeadlessCompatibilityTests(unittest.TestCase):
    def test_cloudtalk_without_desktop_never_dials(self):
        with patch("cloudtalk_voice.os.startfile", None, create=True):
            voice = CloudTalkVoice()
            answer = voice.handle("ruf 01634923545 ueber cloudtalk an")
            self.assertIn("nicht verfuegbar", answer)
            self.assertIsNone(voice.pending)
            self.assertIsNone(voice.open_url)

    def test_voice_health_reports_browser_transport(self):
        # Load the existing voice test's isolated dependency stubs; no model is initialized.
        source = VOICE / "tests" / "test_personal_wake.py"
        spec = importlib.util.spec_from_file_location("isolated_voice_test_helpers", source)
        helpers = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helpers)
        voice_module = helpers.load_voice_module()
        service = voice_module.VoiceService.__new__(voice_module.VoiceService)
        service.status = {"state": "waiting_audio"}
        service.audio_transport = "browser"
        service.ptt_active = False
        import audio_level
        service.tts = types.SimpleNamespace(speaking=threading.Event(), level=audio_level.LevelMeter())
        service.input_level = audio_level.LevelMeter()
        service.trusted_until = 0
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        service.cfg = {"health_port": port}
        service._start_health()
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2) as response:
            status = json.load(response)
        self.assertEqual(status["audio_transport"], "browser")
        self.assertEqual(status["state"], "waiting_audio")
        self.assertEqual(status["phase"], "idle")
        self.assertIs(status["tts_active"], False)
        self.assertEqual(status["input_audio"], {"level": 0.0, "peak": 0.0, "low": 0.0, "mid": 0.0, "high": 0.0})
