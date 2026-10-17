"""Datenschutzfreier Pegelmesser fuer das Status-JSON des Voice-Dienstes (`input_level`, `output_level`).

Es wird ausschliesslich eine einzelne Zahl 0..1 gehalten (geglaettete RMS-Lautstaerke der letzten Bloecke). Das Audio
selbst wird weder gespeichert noch weitergegeben: `update()` liest den Block, rechnet und verwirft ihn.

Abbildung: RMS -> dBFS -> linear von FLOOR_DB (-60 dBFS = 0.0) bis CEIL_DB (-6 dBFS = 1.0). Die Skala folgt dem
Lautstaerkeempfinden; normale Sprache am Mikrofon liegt bei etwa 0.4..0.8, Raumrauschen nahe 0.
Glaettung: schneller Anstieg (Attack), langsamer Abfall (Release), damit die Anzeige nicht flackert.

Zusaetzlich (rein additiv, ebenfalls nur Zahlen 0..1): `peak` (Spitzenpegel mit langsamem Abfall) und drei Frequenzbaender
`low` (< 250 Hz), `mid` (250..2000 Hz), `high` (> 2000 Hz) aus einer FFT des letzten Blocks. Das Band-Spektrum wird
nach der Berechnung verworfen. Die Bandgrenzen haengen von der Abtastrate ab (Standard 16 kHz, TTS-Aufrufer uebergeben
die echte Rate).
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
PEAK_DECAY = 0.85  # Faktor pro Block, mit dem der Spitzenpegel zurueckfaellt, wenn der Block leiser ist
BAND_EDGES_HZ = (250.0, 2000.0)  # low | mid | high
BANDS = ("low", "mid", "high")
DEFAULT_SAMPLE_RATE = 16000


def _to_float(samples: np.ndarray) -> np.ndarray:
    block = samples.astype(np.float32)
    if np.issubdtype(samples.dtype, np.integer):
        block = block / 32768.0
    return block


def _db_to_unit(power_rms: float) -> float:
    if not math.isfinite(power_rms) or power_rms <= 0.0:
        return 0.0
    db = 20.0 * math.log10(power_rms)
    return min(1.0, max(0.0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)))


def normalized_rms(samples: np.ndarray) -> float:
    """Normalisierte Lautstaerke 0..1 eines Blocks. int16 wird auf +-1 skaliert, Float-Daten gelten als +-1."""
    if samples.size == 0:
        return 0.0
    block = _to_float(samples)
    return _db_to_unit(float(np.sqrt(np.mean(np.square(block)))))


def normalized_peak(samples: np.ndarray) -> float:
    """Spitzenpegel 0..1 eines Blocks (groesster Betrag, gleiche dBFS-Skala wie `normalized_rms`)."""
    if samples.size == 0:
        return 0.0
    block = _to_float(samples)
    return _db_to_unit(float(np.max(np.abs(block))))


def band_levels(samples: np.ndarray, sample_rate: int = DEFAULT_SAMPLE_RATE) -> dict[str, float]:
    """Pegel 0..1 der Baender low/mid/high (gleiche dBFS-Skala). Hann-Fenster, Parseval-normierte Bandleistung."""
    zero = {band: 0.0 for band in BANDS}
    if samples.size < 16 or sample_rate <= 0:
        return zero
    block = _to_float(samples)
    if not np.all(np.isfinite(block)):
        return zero
    window = np.hanning(block.size).astype(np.float32)
    spectrum = np.abs(np.fft.rfft(block * window)) ** 2
    freqs = np.fft.rfftfreq(block.size, d=1.0 / sample_rate)
    # Parseval: Gesamtleistung = 2 * sum(|X|^2) / (N * sum(w^2)); DC und Nyquist zaehlen nur einfach (vernachlaessigbar).
    scale = 2.0 / (block.size * float(np.sum(window ** 2)))
    edges = (0.0, *BAND_EDGES_HZ, float("inf"))
    levels = {}
    for index, band in enumerate(BANDS):
        mask = (freqs >= edges[index]) & (freqs < edges[index + 1])
        power = float(np.sum(spectrum[mask])) * scale
        levels[band] = _db_to_unit(math.sqrt(max(power, 0.0)))
    return levels


class LevelMeter:
    """Geglaetteter Pegel. `update()` aus dem Audio-Thread, `value()` aus dem HTTP-Thread."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._level = 0.0
        self._peak = 0.0
        self._bands = {band: 0.0 for band in BANDS}
        self._updated = float("-inf")

    def update(self, samples: np.ndarray, sample_rate: int = DEFAULT_SAMPLE_RATE) -> None:
        target = normalized_rms(samples)
        peak = normalized_peak(samples)
        bands = band_levels(samples, sample_rate)
        with self._lock:
            rate = ATTACK if target > self._level else RELEASE
            self._level += (target - self._level) * rate
            self._peak = max(peak, self._peak * PEAK_DECAY)
            for band in BANDS:
                rate = ATTACK if bands[band] > self._bands[band] else RELEASE
                self._bands[band] += (bands[band] - self._bands[band]) * rate
            self._updated = self._clock()

    def value(self) -> float:
        with self._lock:
            if self._clock() - self._updated > STALE_S:
                return 0.0
            return round(self._level, 3)

    def snapshot(self) -> dict[str, float]:
        """`{level, peak, low, mid, high}`, alles 0..1; nach STALE_S ohne neuen Block ueberall 0."""
        with self._lock:
            if self._clock() - self._updated > STALE_S:
                return {"level": 0.0, "peak": 0.0, "low": 0.0, "mid": 0.0, "high": 0.0}
            return {"level": round(self._level, 3), "peak": round(min(1.0, self._peak), 3),
                    **{band: round(self._bands[band], 3) for band in BANDS}}

    def reset(self) -> None:
        with self._lock:
            self._level = 0.0
            self._peak = 0.0
            self._bands = {band: 0.0 for band in BANDS}
            self._updated = float("-inf")
