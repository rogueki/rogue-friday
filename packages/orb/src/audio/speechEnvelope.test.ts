import { describe, expect, it } from "vitest";
import { createAudioFrame } from "./frame";
import { createSpeechEnvelopeSource } from "./speechEnvelope";

function sampleEnvelope(seed: number, seconds: number, hz = 100): number[] {
  const src = createSpeechEnvelopeSource({ seed, intensity: 1 });
  src.start(0);
  const frame = createAudioFrame();
  const out: number[] = [];
  for (let i = 0; i < seconds * hz; i++) {
    src.sample((i / hz) * 1000, frame);
    out.push(frame.rms);
  }
  return out;
}

/** Share of the signal power sitting in the single strongest frequency line (0.4..12 Hz); a pure sine is ~1. */
function dominantShare(x: number[], hz: number): number {
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  const v = x.map((s) => s - mean);
  const n = v.length;
  let total = 0;
  let best = 0;
  const maxK = Math.floor((12 * n) / hz);
  const minK = Math.max(1, Math.floor((0.4 * n) / hz));
  for (let k = minK; k <= maxK; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const a = (-2 * Math.PI * k * i) / n;
      re += v[i]! * Math.cos(a);
      im += v[i]! * Math.sin(a);
    }
    const p = re * re + im * im;
    total += p;
    if (p > best) best = p;
  }
  return best / total;
}

describe("speech envelope fallback", () => {
  it("is deterministic for a seed and different for another seed", () => {
    expect(sampleEnvelope(1, 8)).toEqual(sampleEnvelope(1, 8));
    expect(sampleEnvelope(1, 8)).not.toEqual(sampleEnvelope(2, 8));
  });

  it("does not depend on how often it is sampled", () => {
    const coarse = createSpeechEnvelopeSource({ seed: 5 });
    const fine = createSpeechEnvelopeSource({ seed: 5 });
    coarse.start(0);
    fine.start(0);
    const a = createAudioFrame();
    const b = createAudioFrame();
    for (let i = 1; i <= 100; i++) fine.sample(i * 5, b);
    coarse.sample(500, a);
    expect(a.rms).toBeCloseTo(b.rms, 10);
  });

  it("is not periodic: no dominant single frequency, unlike a sine", () => {
    const hz = 50;
    const env = sampleEnvelope(11, 40, hz);
    const sineWave = Array.from({ length: 40 * hz }, (_, i) => 0.5 + 0.5 * Math.sin((2 * Math.PI * 3.1 * i) / hz));
    expect(dominantShare(sineWave, hz)).toBeGreaterThan(0.9);
    expect(dominantShare(env, hz)).toBeLessThan(0.3);
  });

  it("has word gaps, sentence pauses and varying syllable intensity", () => {
    const hz = 100;
    const env = sampleEnvelope(3, 60, hz);
    // pauses = runs of near-silence
    const runs: number[] = [];
    let cur = 0;
    for (const v of env) {
      if (v < 0.03) cur += 1;
      else if (cur > 0) {
        runs.push(cur / hz);
        cur = 0;
      }
    }
    expect(runs.filter((r) => r >= 0.35).length).toBeGreaterThanOrEqual(3); // sentence pauses 350-700 ms
    expect(runs.filter((r) => r <= 0.25).length).toBeGreaterThan(8); // short gaps and syllable edges
    expect(Math.max(...runs)).toBeLessThan(1.0);
    // syllable peaks differ in intensity
    const peaks: number[] = [];
    for (let i = 2; i < env.length - 2; i++) if (env[i]! > env[i - 1]! && env[i]! >= env[i + 1]! && env[i]! > 0.1) peaks.push(env[i]!);
    const mean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const sd = Math.sqrt(peaks.reduce((a, b) => a + (b - mean) ** 2, 0) / peaks.length);
    expect(peaks.length).toBeGreaterThan(100);
    expect(sd).toBeGreaterThan(0.1);
    // syllable rate is human: 3-6 per second
    const rate = peaks.length / 60;
    expect(rate).toBeGreaterThan(2.5);
    expect(rate).toBeLessThan(7);
  });

  it("splits the energy into low / mid / high with fricative bursts for the high band", () => {
    const src = createSpeechEnvelopeSource({ seed: 9, intensity: 1 });
    src.start(0);
    const f = createAudioFrame();
    let highDominant = 0;
    let lowDominant = 0;
    for (let i = 0; i < 6000; i++) {
      src.sample(i * 10, f);
      if (f.rms < 0.2) continue;
      if (f.high > f.low) highDominant += 1;
      else lowDominant += 1;
      expect(f.peak).toBeGreaterThanOrEqual(f.rms * 0.99);
      expect(f.mid).toBeLessThanOrEqual(1);
    }
    expect(lowDominant).toBeGreaterThan(highDominant);
    expect(highDominant).toBeGreaterThan(0);
  });

  it("releases after stop() and cuts within 150 ms on barge-in", () => {
    const run = (interrupted: boolean) => {
      const src = createSpeechEnvelopeSource({ seed: 4, intensity: 1 });
      src.start(0);
      const f = createAudioFrame();
      for (let t = 0; t < 2000; t += 10) src.sample(t, f);
      src.stop(interrupted, 2000);
      const levels: number[] = [];
      for (let t = 2000; t <= 2500; t += 10) {
        src.sample(t, f);
        levels.push(f.rms);
      }
      return levels;
    };
    const barge = run(true);
    expect(barge[15]).toBeLessThan(0.01); // 150 ms after the stop
    const soft = run(false);
    expect(soft[15]).toBeLessThan(0.5);
    expect(soft[40]).toBeLessThan(0.01);
  });

  it("outputs silence while stopped and after dispose", () => {
    const src = createSpeechEnvelopeSource({ seed: 4 });
    const f = createAudioFrame();
    src.sample(100, f);
    expect(f.rms).toBe(0);
    src.start(0);
    src.sample(500, f);
    src.dispose();
    src.sample(600, f);
    expect(f.rms).toBe(0);
    expect(f.source).toBe("synthetic");
  });
});
