"""Datenschutzfreier Pegelmesser fuer das Status-JSON des Voice-Dienstes (`input_level`, `output_level`).

Es wird ausschliesslich eine einzelne Zahl 0..1 gehalten (geglaettete RMS-Lautstaerke der letzten Bloecke). Das Audio
selbst wird weder gespeichert noch weitergegeben: `update()` liest den Block, rechnet und verwirft ihn.

Abbildung: RMS -> dBFS -> linear von FLOOR_DB (-60 dBFS = 0.0) bis CEIL_DB (-6 dBFS = 1.0). Die Skala folgt dem
Lautstaerkeempfinden; normale Sprache am Mikrofon liegt bei etwa 0.4..0.8, Raumrauschen nahe 0.
Glaettung: schneller Anstieg (Attack), langsamer Abfall (Release), damit die Anzeige nicht flackert.
"""
import math
import threading
import time

import numpy as np

FLOOR_DB = -60.0
CEIL_DB = -6.0
ATTACK = 0.6    # Anteil des Abstands zum neuen Wert, der pro Block uebernommen wird, wenn der Pegel steigt
RELEASE = 0.15  # dito, wenn er faellt
STALE_S = 0.5   # kein neuer Block seit so langer Zeit (Stream steht, TTS zu Ende): Pegel gilt als 0


def normalized_rms(samples: np.ndarray) -> float:
    """Normalisierte Lautstaerke 0..1 eines Blocks. int16 wird auf +-1 skaliert, Float-Daten gelten als +-1."""
    if samples.size == 0:
        return 0.0
    block = samples.astype(np.float32)
    if np.issubdtype(samples.dtype, np.integer):
        block = block / 32768.0
    rms = float(np.sqrt(np.mean(np.square(block))))
    if not math.isfinite(rms) or rms <= 0.0:
        return 0.0
    db = 20.0 * math.log10(rms)
    return min(1.0, max(0.0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)))


class LevelMeter:
    """Geglaetteter Pegel. `update()` aus dem Audio-Thread, `value()` aus dem HTTP-Thread."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._level = 0.0
        self._updated = float("-inf")

    def update(self, samples: np.ndarray) -> None:
        target = normalized_rms(samples)
        with self._lock:
            rate = ATTACK if target > self._level else RELEASE
            self._level += (target - self._level) * rate
            self._updated = self._clock()

    def value(self) -> float:
        with self._lock:
            if self._clock() - self._updated > STALE_S:
                return 0.0
            return round(self._level, 3)

    def reset(self) -> None:
        with self._lock:
            self._level = 0.0
            self._updated = float("-inf")
