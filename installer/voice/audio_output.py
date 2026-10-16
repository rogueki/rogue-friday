"""Prepare synthesized mono audio for the selected Windows output device."""

import math

import numpy as np
import sounddevice as sd
from scipy.signal import resample_poly


def for_output_device(audio: np.ndarray, source_rate: int, device=None) -> tuple[np.ndarray, int]:
    target_rate = round(sd.query_devices(device, "output")["default_samplerate"])
    if target_rate <= 0:
        raise ValueError("Ausgabegeraet meldet keine gueltige Abtastrate")
    if target_rate == source_rate:
        return audio, source_rate
    common = math.gcd(source_rate, target_rate)
    converted = resample_poly(audio, target_rate // common, source_rate // common)
    return converted.astype(np.float32, copy=False), target_rate
