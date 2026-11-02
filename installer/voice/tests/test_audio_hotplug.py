"""Hotplug detection and recovery in ``VoiceService._audio_device_watcher``."""

import importlib.util
import json
import queue
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

VOICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(VOICE))


class FakePortAudioError(Exception):
    """Stand-in for ``sounddevice.PortAudioError``."""


class StopWatcher(BaseException):
    """Raised by the patched sleep to end the watcher loop."""


class FakeStream:
    """Input stream whose ``active`` flag follows start/stop/close."""

    def __init__(self, device, on_start=None, **kwargs):
        self.device = device
        self.on_start = on_start
        self.kwargs = kwargs
        self.active = False

    def start(self):
        self.active = True
        if self.on_start is not None:
            self.on_start()

    def stop(self):
        self.active = False

    def close(self):
        self.active = False


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
    (None, "input"): 9,
    (None, "output"): 11,
}


def fake_resolve(sd, selected, direction):
    index = DEVICE_INDEX[(selected, direction)]
    name = "Headset Mikrofon" if direction == "input" else "Headset Hoerer"
    return index, {"index": index, "name": name}


def load_voice_module():
    # Reuse the dependency stubs of the existing voice test instead of importing sounddevice here.
    source = VOICE / "tests" / "test_personal_wake.py"
    spec = importlib.util.spec_from_file_location("isolated_voice_hotplug_helpers", source)
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    return helpers.load_voice_module()


def make_fake_sounddevice(service):
    """Build a ``sounddevice`` namespace that records opened input streams."""
    created = []

    def open_input(device, **kwargs):
        stream = FakeStream(
            device,
            on_start=lambda: setattr(service, "last_audio_callback", time.monotonic()),
            **kwargs,
        )
        created.append(stream)
        return stream

    sd = types.SimpleNamespace(
        PortAudioError=FakePortAudioError,
        _terminate=Mock(),
        _initialize=Mock(),
        OutputStream=FakeOutputStream,
        InputStream=open_input,
        query_devices=lambda device, kind: {"max_output_channels": 2, "default_samplerate": 48000.0},
    )
    return sd, created


class AudioHotplugTests(unittest.TestCase):
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
        self.present = ["vdev_old_in", "vdev_old_out"]
        self.service = self.make_service()
        self.sd, self.created = make_fake_sounddevice(self.service)

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
        service.audio_input_device_name = None
        service.audio_output_device_name = None
        service.audio_input_flags = None
        service.last_audio_callback = time.monotonic()
        service.control_generation = 0
        service.control_cancel = threading.Event()
        service.audio_applied_revision = 0
        service.audio_error = None
        service.audio_q = queue.Queue()
        service.service_started_at = "2026-10-29T00:00:00Z"
        service._on_audio = lambda *args: None
        service.cancel_active_interaction = Mock()
        return service

    def watch(self, stop_after, hook=None, defaults=None):
        events = []
        calls = {"count": 0}

        def recorder(**kwargs):
            events.append(kwargs["event"])

        def fake_sleep(_seconds):
            calls["count"] += 1
            if hook is not None:
                hook(calls["count"])
            if calls["count"] >= stop_after:
                raise StopWatcher()

        with patch.object(self.voice_module, "sd", self.sd), patch(
            "audio_devices.inventory",
            side_effect=lambda sd: [{"id": item} for item in self.present],
        ), patch("audio_devices.resolve", fake_resolve), patch(
            "audio_devices.windows_default_endpoints", side_effect=defaults or (lambda: None)
        ), patch.object(
            self.voice_module, "log_event", recorder
        ), patch("time.sleep", fake_sleep):
            with self.assertRaises(StopWatcher):
                self.service._audio_device_watcher()
        return events

    def test_silent_stream_is_lost_and_restored_after_replug(self):
        self.present = ["vdev_old_out"]
        self.service.last_audio_callback = time.monotonic() - 10

        def hook(call):
            if call == 2:
                self.present.append("vdev_old_in")

        events = self.watch(4, hook)
        self.assertEqual(self.service.cancel_active_interaction.call_count, 1)
        self.assertGreaterEqual(self.sd._terminate.call_count, 1)
        self.assertIn("audio_device_lost", events)
        self.assertIn("audio_device_restored", events)
        self.assertEqual(self.service.input_stream.device, 1)
        self.assertTrue(self.service.input_stream.active)
        self.assertIsNone(self.service.audio_error)

    def test_absent_device_keeps_waiting_and_never_switches(self):
        self.present = ["vdev_other"]
        self.service.input_stream.active = False

        self.watch(3)
        self.assertEqual(self.service.status["state"], "waiting_audio")
        self.assertIsNone(self.service.input_stream)
        self.assertEqual(self.created, [])
        self.assertIsNone(self.service.audio_input_device_id)
        self.assertIsNone(self.service.audio_output_device_id)

    def test_healthy_stream_is_left_alone(self):
        self.service.last_audio_callback = time.monotonic()
        original = self.service.input_stream

        def hook(_call):
            self.service.last_audio_callback = time.monotonic()

        events = self.watch(3, hook)
        self.assertEqual(self.sd._terminate.call_count, 0)
        self.assertEqual(events, [])
        self.assertIs(self.service.input_stream, original)

    def test_apply_audio_reports_active_device_names(self):
        with patch.object(self.voice_module, "sd", self.sd), patch("audio_devices.resolve", fake_resolve):
            self.service.apply_audio("vdev_new_in", "vdev_new_out")
        self.assertEqual(self.service.audio_input_device_name, "Headset Mikrofon")
        self.assertEqual(self.service.audio_output_device_name, "Headset Hoerer")

    def follow_windows_default(self):
        self.saved_config = {"input_device_id": None, "output_device_id": None}
        self.config_path.write_text(json.dumps(self.saved_config), encoding="utf-8")
        self.service.config_disk_hash = self.voice_module.runtime_settings.file_hash(self.config_path)
        self.service.cfg = dict(self.saved_config)
        self.current = ("laptop-mic", "laptop-speaker")

        def keep_alive(_call):
            self.service.last_audio_callback = time.monotonic()

        return keep_alive

    def test_headset_becoming_windows_default_is_followed(self):
        keep_alive = self.follow_windows_default()
        original = self.service.input_stream

        def hook(call):
            keep_alive(call)
            if call == 1:
                self.current = ("headset-mic", "headset-speaker")

        events = self.watch(4, hook, defaults=lambda: self.current)
        self.assertEqual(events.count("audio_default_changed"), 1)
        self.assertGreaterEqual(self.sd._terminate.call_count, 1)
        self.assertFalse(original.active)
        self.assertIsNot(self.service.input_stream, original)
        self.assertEqual(self.service.input_stream.device, 9)
        self.assertTrue(self.service.input_stream.active)
        self.assertEqual(self.service.status["state"], "wake_only")

    def test_switch_waits_until_the_interaction_is_over(self):
        keep_alive = self.follow_windows_default()
        self.current = ("headset-mic", "headset-speaker")
        self.service.processing = True
        original = self.service.input_stream

        def hook(call):
            keep_alive(call)
            if call == 3:
                self.service.processing = False

        defaults = iter([("laptop-mic", "laptop-speaker")])
        events = self.watch(5, hook, defaults=lambda: next(defaults, self.current))
        self.assertEqual(events.count("audio_default_changed"), 1)
        self.assertIsNot(self.service.input_stream, original)

    def test_explicit_selection_ignores_windows_default(self):
        original = self.service.input_stream
        query = Mock(return_value=("headset-mic", "headset-speaker"))

        def hook(_call):
            self.service.last_audio_callback = time.monotonic()

        events = self.watch(3, hook, defaults=query)
        self.assertEqual(events, [])
        self.assertIs(self.service.input_stream, original)
        self.assertEqual(self.sd._terminate.call_count, 0)
        self.assertLessEqual(query.call_count, 1)
