import unittest

from audio_devices import inventory, legacy_id, resolve


class FakeAudio:
    class Defaults:
        device = (0, 1)
    default = Defaults()

    def __init__(self, swapped=False):
        self.devices = [
            {"hostapi": 0, "name": "Headset Mic", "max_input_channels": 1,
             "max_output_channels": 0, "default_samplerate": 48000},
            {"hostapi": 0, "name": "Headset Output", "max_input_channels": 0,
             "max_output_channels": 2, "default_samplerate": 48000},
        ]
        if swapped:
            self.devices.reverse()
            self.default.device = (1, 0)

    def query_devices(self):
        return self.devices

    def query_hostapis(self):
        return [{"name": "Windows WASAPI"}]


class AudioDeviceIdentityTest(unittest.TestCase):
    def test_identity_survives_portaudio_reorder(self):
        original = FakeAudio()
        moved = FakeAudio(swapped=True)
        mic_id = next(item["id"] for item in inventory(original) if item["kind"] == "input")
        speaker_id = next(item["id"] for item in inventory(original) if item["kind"] == "output")
        self.assertEqual(resolve(moved, mic_id, "input")[0], 1)
        self.assertEqual(resolve(moved, speaker_id, "output")[0], 0)

    def test_missing_explicit_device_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "nicht verbunden"):
            resolve(FakeAudio(), "vdev_" + "a" * 26, "input")

    def test_legacy_name_maps_to_stable_id(self):
        original = FakeAudio()
        selected = legacy_id(original, "Headset Mic, Windows WASAPI", "input")
        self.assertEqual(selected, next(item["id"] for item in inventory(original) if item["kind"] == "input"))
        self.assertEqual(resolve(FakeAudio(swapped=True), selected, "input")[0], 1)

    def test_identical_names_on_same_backend_are_rejected_not_swapped(self):
        host = FakeAudio()
        host.devices.append(dict(host.devices[0]))
        with self.assertRaisesRegex(ValueError, "Mehrdeutiges"):
            inventory(host)


if __name__ == "__main__":
    unittest.main()
