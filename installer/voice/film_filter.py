"""JARVIS-Filmcharakter als Streaming-Filter: Hochpass, Praesenzanhebung, dezenter Digital-Chorus,
kurzer heller Raumhall. Zustandsbehaftet, damit Chunk-Grenzen beim Streaming nicht hoerbar sind."""
import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt, sosfilt_zi


class FilmFilter:
    CHORUS = ((11.0, 0.35, 0.55), (17.0, 0.45, 0.83))  # (Basis-ms, Tiefe-ms, LFO-Hz)

    def __init__(self, sr: int, enabled: bool = True):
        self.sr = sr
        self.enabled = enabled
        self.hp = butter(2, 90, "highpass", fs=sr, output="sos")
        self.bp = butter(2, [2500, 6000], "bandpass", fs=sr, output="sos")
        self.hp_zi = sosfilt_zi(self.hp) * 0.0
        self.bp_zi = sosfilt_zi(self.bp) * 0.0
        self.hist = np.zeros(int(0.03 * sr), dtype=np.float64)  # Delay-Historie > max. Chorus-Verzoegerung
        self.pos = 0
        t = np.arange(int(0.32 * sr)) / sr
        ir = np.random.default_rng(7).standard_normal(len(t)) * np.exp(-t / 0.07)
        ir = sosfilt(butter(2, 7000, "lowpass", fs=sr, output="sos"), ir)
        ir[0] = 0.0
        self.ir = ir / np.sqrt(np.sum(ir ** 2))
        self.tail = np.zeros(len(self.ir) - 1)

    def _delay(self, buf: np.ndarray, n: int, base_ms: float, depth_ms: float, rate_hz: float) -> np.ndarray:
        k = np.arange(n)
        delay = (base_ms + depth_ms * np.sin(2 * np.pi * rate_hz * (self.pos + k) / self.sr)) * self.sr / 1000
        idx = len(self.hist) + k - delay
        i0 = np.floor(idx).astype(int)
        frac = idx - i0
        return buf[i0] * (1 - frac) + buf[i0 + 1] * frac

    @staticmethod
    def _limit(x: np.ndarray) -> np.ndarray:
        return (np.tanh(1.2 * x) / np.tanh(1.2)).astype(np.float32)

    def process(self, chunk: np.ndarray) -> np.ndarray:
        x = np.asarray(chunk, dtype=np.float64).reshape(-1)
        if not self.enabled or len(x) == 0:
            return x.astype(np.float32)
        x, self.hp_zi = sosfilt(self.hp, x, zi=self.hp_zi)
        presence, self.bp_zi = sosfilt(self.bp, x, zi=self.bp_zi)
        x = x + 0.25 * presence
        buf = np.concatenate([self.hist, x])
        chorus = sum(0.5 * self._delay(buf, len(x), *p) for p in self.CHORUS)
        self.hist = buf[-len(self.hist):]
        self.pos += len(x)
        y = 0.82 * x + 0.18 * chorus
        wet = fftconvolve(y, self.ir)
        wet[:len(self.tail)] += self.tail
        self.tail = wet[len(y):]
        return self._limit(0.9 * y + 0.1 * wet[:len(y)])

    def flush(self) -> np.ndarray:
        """Hallfahne nach dem letzten Chunk (ca. 0,3 s)."""
        if not self.enabled:
            return np.zeros(0, dtype=np.float32)
        out = self._limit(0.1 * self.tail)
        self.tail = np.zeros_like(self.tail)
        return out
