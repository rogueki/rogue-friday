import { describe, expect, it } from "vitest";
import { createAudioFrame } from "./frame";
import { createServiceLevelSource } from "./serviceLevelSource";

describe("service level source", () => {
  it("smooths 4 Hz pushes into a continuous per-frame signal", () => {
    const src = createServiceLevelSource();
    const f = createAudioFrame();
    const levels = [0.1, 0.8, 0.2, 0.9, 0.3, 0.7];
    const out: number[] = [];
    let t = 0;
    for (let i = 0; i < levels.length * 15; i++) {
      t += 1000 / 60;
      if (i % 15 === 0) src.push(levels[i / 15]!, t);
      src.sample(t, f);
      out.push(f.rms);
    }
    let maxStep = 0;
    for (let i = 1; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i]! - out[i - 1]!));
    expect(maxStep).toBeLessThan(0.2); // the raw pushes jump by up to 0.7
    expect(Math.max(...out)).toBeGreaterThan(0.6);
    expect(f.source).toBe("service-level");
  });

  it("estimates bands from a scalar (flagged as derived) and takes real bands when delivered", () => {
    const src = createServiceLevelSource();
    const f = createAudioFrame();
    src.push(0.6, 0);
    for (let t = 16; t < 600; t += 16) src.sample(t, f);
    expect(f.bandsDerived).toBe(true);
    expect(f.low).toBeGreaterThan(0);
    expect(f.high).toBeLessThan(f.low + 0.01);
    const real = createServiceLevelSource();
    real.push({ level: 0.5, low: 0.9, mid: 0.2, high: 0.05, peak: 0.7 }, 0);
    for (let t = 16; t < 900; t += 16) real.sample(t, f);
    expect(f.bandsDerived).toBe(false);
    expect(f.low).toBeGreaterThan(f.mid);
    expect(f.mid).toBeGreaterThan(f.high);
    expect(f.peak).toBeGreaterThan(f.rms);
  });

  it("decays to silence when the pushes stop (stale)", () => {
    const src = createServiceLevelSource();
    const f = createAudioFrame();
    src.push(0.9, 0);
    for (let t = 16; t < 700; t += 16) src.sample(t, f);
    expect(f.rms).toBeGreaterThan(0.7);
    for (let t = 700; t < 3000; t += 16) src.sample(t, f);
    expect(f.rms).toBeLessThan(0.01);
    expect(f.gateOpen).toBe(false);
  });

  it("clamps garbage input and survives dispose", () => {
    const src = createServiceLevelSource();
    const f = createAudioFrame();
    src.push(Number.NaN, 0);
    src.push(5, 10);
    for (let t = 16; t < 300; t += 16) src.sample(t, f);
    expect(f.rms).toBeLessThanOrEqual(1);
    src.dispose();
    src.push(1, 400);
    expect(() => src.sample(500, f)).not.toThrow();
  });
});
