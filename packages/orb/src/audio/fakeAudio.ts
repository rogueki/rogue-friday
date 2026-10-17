import type { AnalyserContextLike, AnalyserSourceLike } from "./analyzer";
import { mulberry32 } from "../scene/rng";

/** Test doubles for the Web Audio slice the analyser uses; synthetic buffers, no browser needed. */
export interface FakeSignal {
  /** Fills `out` with the next block of samples (sample index `n0` of the stream). */
  fill(out: Float32Array, n0: number, sampleRate: number): void;
}

export const sine = (freq: number, amp: number): FakeSignal => ({
  fill(out, n0, sr) {
    for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * (n0 + i)) / sr);
  },
});

export const whiteNoise = (amp: number, seed = 1): FakeSignal => {
  const rand = mulberry32(seed);
  return {
    fill(out) {
      for (let i = 0; i < out.length; i++) out[i] = amp * (rand() * 2 - 1);
    },
  };
};

export const sum = (...signals: FakeSignal[]): FakeSignal => ({
  fill(out, n0, sr) {
    const tmp = new Float32Array(out.length);
    out.fill(0);
    for (const s of signals) {
      s.fill(tmp, n0, sr);
      for (let i = 0; i < out.length; i++) out[i]! += tmp[i]!;
    }
  },
});

export const dbToAmp = (db: number): number => Math.pow(10, db / 20);

/** Fake AnalyserNode: time data from the current signal, frequency data as a DFT in dB (WebAudio convention: |X|/N). */
export class FakeAnalyser {
  fftSize = 1024;
  smoothingTimeConstant = 0.8;
  minDecibels = -100;
  maxDecibels = -30;
  signal: FakeSignal = whiteNoise(0);
  private position = 0;
  private block: Float32Array = new Float32Array(0);
  private table: Float64Array = new Float64Array(0);
  constructor(readonly sampleRate: number) {}
  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }
  /** Advances the stream by one analysis block and returns it. */
  private next(): Float32Array {
    if (this.block.length !== this.fftSize) this.block = new Float32Array(this.fftSize);
    this.signal.fill(this.block, this.position, this.sampleRate);
    this.position += this.fftSize;
    return this.block;
  }
  getFloatTimeDomainData(out: Float32Array): void {
    out.set(this.next());
  }
  getFloatFrequencyData(out: Float32Array): void {
    const x = this.block.length === this.fftSize ? this.block : this.next();
    const n = this.fftSize;
    if (this.table.length !== n) {
      this.table = new Float64Array(2 * n);
      for (let j = 0; j < n; j++) {
        this.table[2 * j] = Math.cos((-2 * Math.PI * j) / n);
        this.table[2 * j + 1] = Math.sin((-2 * Math.PI * j) / n);
      }
    }
    const tab = this.table;
    for (let k = 0; k < out.length; k++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        const j = (k * i) % n;
        re += x[i]! * (tab[2 * j] as number);
        im += x[i]! * (tab[2 * j + 1] as number);
      }
      const mag = Math.sqrt(re * re + im * im) / n;
      out[k] = mag > 1e-9 ? 20 * Math.log10(mag) : -Infinity;
    }
  }
}

export function createFakeAudio(sampleRate = 16000, fftSize = 128) {
  const analyser = new FakeAnalyser(sampleRate);
  analyser.fftSize = fftSize;
  const disconnected: unknown[] = [];
  const connected: unknown[] = [];
  const context: AnalyserContextLike = { sampleRate, createAnalyser: () => analyser as unknown as AnalyserNode };
  const source: AnalyserSourceLike = {
    connect: (d) => {
      connected.push(d);
    },
    disconnect: (d) => {
      disconnected.push(d);
    },
  };
  return { analyser, context, source, connected, disconnected };
}
