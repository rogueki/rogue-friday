"""Rollback behaviour of ``VoiceService.apply_audio`` when a device switch fails."""

import importlib.util
import json
import queue
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch

VOICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(VOICE))


class FakePortAudioError(Exception):
    """Stand-in for ``sounddevice.PortAudioError``."""


class FakeStream:
    """Input stream that can fail on ``start`` like an unplugged device."""

    def __init__(self, device, fail_start=False, **kwargs):
        self.device = device
        self.fail_start = fail_start
        self.kwargs = kwargs
        self.started = False
        self.stopped = False
        self.closed = False

    def start(self):
        if self.fail_start:
            raise FakePortAudioError("unplugged")
        self.started = True

    def stop(self):
        self.stopped = True

    def close(self):
        self.closed = True


class FakeOutputStream:
    """Context-manager stand-in for ``sounddevice.OutputStream``."""

    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


DEVICE_INDEX = {
    ("vdev_old_in", "input"): 1,
    ("vdev_new_in", "input"): 5,
    ("vdev_old_out", "output"): 3,
    ("vdev_new_out", "output"): 7,
}


def fake_resolve(sd, selected, direction):
    index = DEVICE_INDEX[(selected, direction)]
    return index, {"index": index}


def load_voice_module():
    # Reuse the dependency stubs of the existing voice test instead of importing sounddevice here.
    source = VOICE / "tests" / "test_personal_wake.py"
    spec = importlib.util.spec_from_file_location("isolated_voice_rollback_helpers", source)
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    return helpers.load_voice_module()


def make_fake_sounddevice(failing):
    """Build a ``sounddevice`` namespace whose input streams fail for ``failing`` indexes."""
    created = []

    def open_input(device, **kwargs):
        stream = FakeStream(device, fail_start=device in failing, **kwargs)
        created.append(stream)
        return stream

    sd = types.SimpleNamespace(
        PortAudioError=FakePortAudioError,
        OutputStream=FakeOutputStream,
        InputStream=open_input,
        query_devices=lambda device, kind: {"max_output_channels": 2, "default_samplerate": 48000.0},
    )
    return sd, created


class ApplyAudioRollbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.voice_module = load_voice_module()

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.tmpdir = Path(self._tmpdir.name)
        self.config_path = self.tmpdir / "voice.json"
        self.saved_config = {"input_device_id": "vdev_old_in", "output_device_id": "vdev_old_out"}
        self.config_path.write_text(json.dumps(self.saved_config), encoding="utf-8")
        self.service = self.make_service()

    def make_service(self):
        voice = self.voice_module
        service = voice.VoiceService.__new__(voice.VoiceService)
        service.audio_transport = "device"
        service.manual_start_lock = threading.Lock()
        service.processing = False
        service.tts = types.SimpleNamespace(speaking=threading.Event(), output_device=3)
        service.status = {"state": "wake_only"}
        service.config_path = self.config_path
        service.config_disk_hash = voice.runtime_settings.file_hash(self.config_path)
        service.cfg = dict(self.saved_config)
        service.input_stream = FakeStream(1)
        service.input_stream.start()
        service.audio_input_device_id = "vdev_old_in"
        service.audio_output_device_id = "vdev_old_out"
        service.control_generation = 0
        service.control_cancel = threading.Event()
        service.audio_applied_revision = 0
        service.audio_error = None
        service.audio_q = queue.Queue()
        service.service_started_at = "2026-10-29T00:00:00Z"
        service._on_audio = lambda *args: None
        return service

    def config_text(self):
        return self.config_path.read_text(encoding="utf-8")

    def test_failed_new_input_restores_previous_devices(self):
        before = self.config_text()
        sd, _created = make_fake_sounddevice({5})
        with patch.object(self.voice_module, "sd", sd), patch("audio_devices.resolve", fake_resolve):
            with self.assertRaises(FakePortAudioError):
                self.service.apply_audio("vdev_new_in", "vdev_new_out")
        # The rollback reopened the old input and put the old devices back.
        self.assertEqual(self.service.input_stream.device, 1)
        self.assertTrue(self.service.input_stream.started)
        self.assertEqual(self.service.tts.output_device, 3)
        self.assertEqual(self.service.audio_input_device_id, "vdev_old_in")
        self.assertEqual(self.service.audio_output_device_id, "vdev_old_out")
        self.assertTrue(self.service.audio_error.startswith("Auswahl nicht angewendet"))
        self.assertEqual(self.service.audio_applied_revision, 0)
        self.assertEqual(self.config_text(), before)

    def test_failed_rollback_reports_waiting_audio(self):
        before = self.config_text()
        sd, _created = make_fake_sounddevice({5, 1})
        with patch.object(self.voice_module, "sd", sd), patch("audio_devices.resolve", fake_resolve):
            with self.assertRaises(RuntimeError) as caught:
                self.service.apply_audio("vdev_new_in", "vdev_new_out")
        self.assertIn("Rueckkehr fehlgeschlagen", str(caught.exception))
        self.assertEqual(self.service.status["state"], "waiting_audio")
        self.assertEqual(self.config_text(), before)

    def test_successful_switch_persists_selection(self):
        sd, _created = make_fake_sounddevice(set())
        with patch.object(self.voice_module, "sd", sd), patch("audio_devices.resolve", fake_resolve):
            result = self.service.apply_audio("vdev_new_in", "vdev_new_out")
        self.assertIs(result["applied"], True)
        self.assertEqual(result["revision"], 1)
        self.assertEqual(self.service.input_stream.device, 5)
        self.assertEqual(self.service.tts.output_device, 7)
        self.assertEqual(json.loads(self.config_text())["input_device_id"], "vdev_new_in")
