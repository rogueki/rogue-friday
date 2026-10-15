"""Tests fuer den Pegelmesser (`audio_level.py`): Skalierung, Glaettung, Veraltung, Datenschutz.

Ausfuehren: python3 -m pytest installer/voice/tests/test_audio_level.py   oder   python3 installer/voice/tests/test_audio_level.py
"""
import os
import sys

import numpy as np

VOICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOICE not in sys.path:
    sys.path.insert(0, VOICE)

import audio_level as al  # noqa: E402


class FakeClock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def sine(amplitude: float, n: int = 1280) -> np.ndarray:
    return (amplitude * np.sin(np.linspace(0, 2 * np.pi * 20, n))).astype(np.float32)


def test_silence_and_empty_are_zero():
    assert al.normalized_rms(np.zeros(1280, dtype=np.int16)) == 0.0
    assert al.normalized_rms(np.array([], dtype=np.float32)) == 0.0


def test_full_scale_clamps_to_one_and_floor_to_zero():
    assert al.normalized_rms(np.full(1280, 32767, dtype=np.int16)) == 1.0
    assert al.normalized_rms(np.full(1280, 1, dtype=np.int16)) == 0.0  # ca. -90 dBFS, unter dem Boden


def test_int16_and_float_scale_agree():
    wave = sine(0.1)
    as_int = (wave * 32768).astype(np.int16)
    assert abs(al.normalized_rms(wave) - al.normalized_rms(as_int)) < 0.01


def test_level_is_monotonic_and_in_range():
    values = [al.normalized_rms(sine(a)) for a in (0.001, 0.01, 0.05, 0.2, 0.8)]
    assert values == sorted(values)
    assert all(0.0 <= v <= 1.0 for v in values)
    assert 0.3 < al.normalized_rms(sine(0.1)) < 0.8  # normale Sprache


def test_non_finite_input_does_not_leak_nan():
    bad = np.array([np.nan, np.inf, 1.0], dtype=np.float32)
    assert al.normalized_rms(bad) == 0.0


def test_smoothing_attacks_fast_and_releases_slowly():
    clock = FakeClock()
    meter = al.LevelMeter(clock)
    loud = sine(0.5)
    meter.update(loud)
    first = meter.value()
    assert 0.0 < first < al.normalized_rms(loud)  # nicht sofort am Ziel
    for _ in range(10):
        meter.update(loud)
    peak = meter.value()
    assert abs(peak - al.normalized_rms(loud)) < 0.02
    meter.update(np.zeros(1280, dtype=np.float32))
    after_one_silent_block = meter.value()
    assert after_one_silent_block < peak
    assert after_one_silent_block > peak * 0.5  # Release ist langsamer als Attack


def test_value_goes_to_zero_when_no_blocks_arrive():
    clock = FakeClock()
    meter = al.LevelMeter(clock)
    meter.update(sine(0.5))
    assert meter.value() > 0
    clock.t += al.STALE_S + 0.1
    assert meter.value() == 0.0


def test_reset_and_initial_value():
    meter = al.LevelMeter(FakeClock())
    assert meter.value() == 0.0
    meter.update(sine(0.5))
    meter.reset()
    assert meter.value() == 0.0


def test_meter_keeps_no_audio():
    meter = al.LevelMeter(FakeClock())
    meter.update(sine(0.5))
    held = [v for v in vars(meter).values() if isinstance(v, (np.ndarray, bytes, bytearray, list))]
    assert held == []


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", name)
            except Exception as exc:  # noqa: BLE001 - Laeufer ohne pytest
                failed += 1
                print("FAIL", name, repr(exc))
    sys.exit(1 if failed else 0)
