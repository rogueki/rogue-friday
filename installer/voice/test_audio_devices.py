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
        mic_id = next(item["id"] for item in inventory(host) if item["kind"] == "input")
        host.devices.append(dict(host.devices[0]))
        self.assertNotIn(mic_id, [item["id"] for item in inventory(host)])
        with self.assertRaisesRegex(ValueError, "Mehrdeutiges"):
            resolve(host, mic_id, "input")

    def test_unselected_duplicate_does_not_break_the_list(self):
        # Real host 2026-11-01: two nameless "Input ()" WDM-KS pins stopped the installer although the user had
        # picked a different microphone.
        host = FakeAudio()
        host.default = type("Defaults", (), {"device": (0, 1)})()  # the class-level default is shared across tests
        host.devices += [{"hostapi": 1, "name": "Input ()", "max_input_channels": 2,
                          "max_output_channels": 0, "default_samplerate": 44100} for _ in range(2)]
        host.query_hostapis = lambda: [{"name": "Windows WASAPI"}, {"name": "Windows WDM-KS"}]
        items = inventory(host)
        self.assertEqual(sorted(item["rawName"] for item in items), ["Headset Mic", "Headset Output"])
        self.assertEqual(legacy_id(host, "Headset Mic, Windows WASAPI", "input"),
                         next(item["id"] for item in items if item["kind"] == "input"))
        self.assertEqual(resolve(host, None, "input")[1]["rawName"], "Headset Mic")


if __name__ == "__main__":
    unittest.main()
