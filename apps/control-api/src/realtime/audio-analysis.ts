/**
 * Level analysis of proxied PCM16 frames. Mirrors `installer/voice/audio_level.py` (same dBFS scale, same smoothing) so
 * the Control API and the voice service report comparable numbers. Only numbers leave this module; the samples are
 * analysed and dropped.
 */

export interface AudioLevels {
  /** Smoothed RMS 0..1. */
  level: number;
  /** Peak 0..1 with slow decay. */
  peak: number;
  /** Frequency bands 0..1: < 250 Hz, 250..2000 Hz, > 2000 Hz. */
  low: number;
  mid: number;
  high: number;
}

export const SILENCE: Readonly<AudioLevels> = Object.freeze({ level: 0, peak: 0, low: 0, mid: 0, high: 0 });

const FLOOR_DB = -60;
const CEIL_DB = -6;
const ATTACK = 0.6;
const RELEASE = 0.15;
const PEAK_DECAY = 0.85;
const BAND_EDGES_HZ = [250, 2000] as const;
const FFT_SIZE = 2048;

const unit = (amplitude: number): number => {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(amplitude) - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
};

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < size / 2; k += 1) {
        const a = start + k;
        const b = a + size / 2;
        const tRe = (re[b] as number) * wRe - (im[b] as number) * wIm;
        const tIm = (re[b] as number) * wIm + (im[b] as number) * wRe;
        re[b] = (re[a] as number) - tRe;
        im[b] = (im[a] as number) - tIm;
        re[a] = (re[a] as number) + tRe;
        im[a] = (im[a] as number) + tIm;
        const next = wRe * stepRe - wIm * stepIm;
        wIm = wRe * stepIm + wIm * stepRe;
        wRe = next;
      }
    }
  }
}

/** Instantaneous (unsmoothed) levels of one little-endian PCM16 mono frame. */
export function analyzePcm16(frame: Uint8Array, sampleRate = 16_000): AudioLevels {
  const count = Math.min(Math.floor(frame.byteLength / 2), FFT_SIZE);
  if (count < 16 || sampleRate <= 0) return { ...SILENCE };
  const view = new DataView(frame.buffer, frame.byteOffset, count * 2);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  let sumSquares = 0;
  let peak = 0;
  let windowEnergy = 0;
  for (let i = 0; i < count; i += 1) {
    const sample = view.getInt16(i * 2, true) / 32768;
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (count - 1));
    windowEnergy += window * window;
    re[i] = sample * window;
  }
  fft(re, im);
  const power = [0, 0, 0];
  // Parseval for the zero-padded, windowed block: mean-square of band = 2 * sum(|X|^2) / (N * sum(w^2)).
  const scale = 2 / (FFT_SIZE * windowEnergy);
  for (let k = 1; k < FFT_SIZE / 2; k += 1) {
    const frequency = (k * sampleRate) / FFT_SIZE;
    const band = frequency < BAND_EDGES_HZ[0] ? 0 : frequency < BAND_EDGES_HZ[1] ? 1 : 2;
    power[band] = (power[band] as number) + ((re[k] as number) ** 2 + (im[k] as number) ** 2) * scale;
  }
  return {
    level: unit(Math.sqrt(sumSquares / count)),
    peak: unit(peak),
    low: unit(Math.sqrt(power[0] as number)),
    mid: unit(Math.sqrt(power[1] as number)),
    high: unit(Math.sqrt(power[2] as number)),
  };
}

/** Attack/release smoothing across frames (fast rise, slow fall) so the numbers do not flicker. */
export class LevelSmoother {
  private current: AudioLevels = { ...SILENCE };

  push(next: AudioLevels): AudioLevels {
    const smooth = (previous: number, target: number): number => previous + (target - previous) * (target > previous ? ATTACK : RELEASE);
    this.current = {
      level: smooth(this.current.level, next.level),
      peak: Math.max(next.peak, this.current.peak * PEAK_DECAY),
      low: smooth(this.current.low, next.low),
      mid: smooth(this.current.mid, next.mid),
      high: smooth(this.current.high, next.high),
    };
    return this.value();
  }

  value(): AudioLevels {
    const round = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    return { level: round(this.current.level), peak: round(this.current.peak), low: round(this.current.low), mid: round(this.current.mid), high: round(this.current.high) };
  }

  reset(): void {
    this.current = { ...SILENCE };
  }
}
