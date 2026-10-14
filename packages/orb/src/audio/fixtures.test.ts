import { describe, expect, it } from "vitest";
import { AUDIO_FIXTURE_NAMES, AudioSmoother, audioFixtureLevel, smoothAudioLevel } from "./fixtures";

function stats(name: Parameters<typeof audioFixtureLevel>[0], seconds = 20) {
  const values: number[] = [];
  for (let t = 0; t < seconds; t += 0.02) values.push(audioFixtureLevel(name, t));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { min: Math.min(...values), max: Math.max(...values), mean };
}

describe("audio fixtures", () => {
  it("are deterministic and within 0..1", () => {
    for (const name of AUDIO_FIXTURE_NAMES) {
      for (let t = 0; t < 10; t += 0.137) {
        const v = audioFixtureLevel(name, t);
        expect(v).toBe(audioFixtureLevel(name, t));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("silence stays near zero", () => {
    expect(stats("silence").max).toBeLessThan(0.02);
  });

  it("loud speech is louder than normal speech", () => {
    expect(stats("loud").mean).toBeGreaterThan(stats("normal").mean * 1.5);
    expect(stats("loud").max).toBeGreaterThan(0.85);
  });

  it("speech has dynamics (pauses and peaks)", () => {
    const n = stats("normal");
    expect(n.max - n.min).toBeGreaterThan(0.3);
  });

  it("tts has a steady mid level", () => {
    const s = stats("tts");
    expect(s.mean).toBeGreaterThan(0.15);
    expect(s.max).toBeLessThan(0.75);
  });

  it("spike reaches ~1 and decays", () => {
    expect(audioFixtureLevel("spike", 0.04)).toBeGreaterThan(0.95);
    expect(audioFixtureLevel("spike", 0.6)).toBeLessThan(0.2);
  });
});

describe("smoothing", () => {
  it("attacks faster than it releases", () => {
    const up = smoothAudioLevel(0, 1, 0.06);
    const down = smoothAudioLevel(1, 0, 0.06);
    expect(up).toBeGreaterThan(0.6);
    expect(1 - down).toBeLessThan(0.3);
  });

  it("is frame-rate independent", () => {
    const a = new AudioSmoother();
    for (let i = 0; i < 10; i++) a.step(1, 0.01);
    const b = new AudioSmoother();
    for (let i = 0; i < 2; i++) b.step(1, 0.05);
    expect(a.level).toBeCloseTo(b.level, 5);
  });

  it("does not jitter on a constant input", () => {
    const s = new AudioSmoother();
    let prev = 0;
    for (let i = 0; i < 100; i++) {
      const v = s.step(0.5, 0.016);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});
