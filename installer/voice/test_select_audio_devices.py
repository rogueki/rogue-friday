"""The installer's device step must never stop the installation: a device that cannot be used falls back to the
Windows default (real fresh install 2026-11-01: two nameless "Input ()" WDM-KS pins aborted the run)."""
import io
import json
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HOSTAPIS = [{"name": "MME"}, {"name": "Windows WASAPI"}, {"name": "Windows WDM-KS"}]


def device(name, api, inputs=0, outputs=0):
    return {"name": name, "hostapi": api, "max_input_channels": inputs, "max_output_channels": outputs,
            "default_samplerate": 48000}


class FakeSounddevice(types.ModuleType):
    class PortAudioError(Exception):
        pass

    def __init__(self, devices):
        super().__init__("sounddevice")
        self.devices = devices
        self.default = types.SimpleNamespace(device=(0, 1))

    def query_devices(self, selection=None, kind=None):
        if selection is None:
            return self.devices
        matches = [d for d in self.devices if f'{d["name"]}, {HOSTAPIS[d["hostapi"]]["name"]}' == selection
                   and d[f"max_{kind}_channels"] > 0]
        if len(matches) != 1:
            raise ValueError(f"No or multiple devices matching {selection!r}")
        return matches[0]

    def query_hostapis(self, index=None):
        return HOSTAPIS if index is None else HOSTAPIS[index]


def run(devices, *args):
    fake = FakeSounddevice(devices)
    sys.modules["sounddevice"] = fake
    sys.modules.pop("select_audio_devices", None)
    import select_audio_devices
    with tempfile.TemporaryDirectory() as tmp:
        config_path = Path(tmp) / "voice.json"
        config_path.write_text(json.dumps({"input_device": None, "output_device": None}), encoding="utf-8")
        sys.argv = ["select_audio_devices.py", str(config_path), *args]
        out = io.StringIO()
        with redirect_stdout(out):
            select_audio_devices.main()
        return json.loads(config_path.read_text(encoding="utf-8")), out.getvalue()


COLLEAGUE = [
    device("Mikrofon (Realtek(R) Audio)", 0, inputs=2),
    device("Lautsprecher (Realtek(R) Audio)", 0, outputs=2),
    device("Mikrofon (Realtek(R) Audio)", 1, inputs=2),
    device("Lautsprecher (Realtek(R) Audio)", 1, outputs=2),
    device("Input ()", 2, inputs=2),
    device("Input ()", 2, inputs=2),
]


class SelectAudioDevicesTest(unittest.TestCase):
    def tearDown(self):
        sys.modules.pop("sounddevice", None)
        sys.modules.pop("select_audio_devices", None)

    def test_unrelated_duplicate_does_not_block_the_chosen_microphone(self):
        config, _ = run(COLLEAGUE, "--input-name", "Mikrofon (Realtek(R) Audio)",
                        "--output-name", "Lautsprecher (Realtek(R) Audio)")
        self.assertEqual(config["input_device"], "Mikrofon (Realtek(R) Audio), MME")
        self.assertTrue(str(config["input_device_id"]).startswith("vdev_"))
        self.assertTrue(str(config["output_device_id"]).startswith("vdev_"))

    def test_ambiguous_mme_name_falls_through_to_wasapi(self):
        devices = [device("Mikrofon (2- USB Audio Device)", 0, inputs=1),
                   device("Mikrofon (2- USB Audio Device)", 0, inputs=1),
                   device("Mikrofon (2- USB Audio Device)", 1, inputs=1)]
        config, _ = run(devices, "--input-name", "Mikrofon (2- USB Audio Device)")
        self.assertEqual(config["input_device"], "Mikrofon (2- USB Audio Device), Windows WASAPI")
        self.assertTrue(str(config["input_device_id"]).startswith("vdev_"))

    def test_unusable_device_falls_back_to_windows_default_without_failing(self):
        config, out = run(COLLEAGUE, "--input-name", "Headset Mikrofon (nicht angeschlossen)")
        self.assertIsNone(config["input_device"])
        self.assertIsNone(config["input_device_id"])
        self.assertIn("Windows-Standardgerät", out)

    def test_only_ambiguous_candidates_fall_back_instead_of_aborting(self):
        config, out = run(COLLEAGUE, "--input-name", "Input ()  ")
        self.assertIsNone(config["input_device_id"])
        self.assertIn("Windows-Standardgerät", out)


if __name__ == "__main__":
    unittest.main()
