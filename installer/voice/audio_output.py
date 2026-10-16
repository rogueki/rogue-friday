"""Prepare synthesized mono audio for the selected Windows output device."""

import math

import numpy as np
import sounddevice as sd
from scipy.signal import resample_poly

OUTPUT_TAIL_SECONDS = 0.55


def for_output_device(audio: np.ndarray, source_rate: int, device=None) -> tuple[np.ndarray, int]:
    target_rate = round(sd.query_devices(device, "output")["default_samplerate"])
    if target_rate <= 0:
        raise ValueError("Ausgabegeraet meldet keine gueltige Abtastrate")
    if target_rate != source_rate:
        common = math.gcd(source_rate, target_rate)
        audio = resample_poly(audio, target_rate // common, source_rate // common)
    # Bluetooth devices can drop the last phoneme when the stream closes at the final sample.
    tail = np.zeros(round(OUTPUT_TAIL_SECONDS * target_rate), dtype=np.float32)
    return np.concatenate((audio.astype(np.float32, copy=False), tail)), target_rate
