import { describe, expect, it } from "vitest";
import { AUDIO_MAPPING, bloomFromAudio, coreIntensityFromAudio, coreScaleFromAudio, particleForceFromAudio, ringSpeedFromAudio } from "./audioMapping";

describe("audio mapping (owner order sections 9 and 14)", () => {
  it("follows the order's formulas", () => {
    expect(coreScaleFromAudio(1, 0.5)).toBeCloseTo(1 + 0.5 * 0.08);
    expect(coreIntensityFromAudio(0.5, 0.5)).toBeCloseTo(0.5 + 0.5 * 1.2);
    expect(particleForceFromAudio(0.5)).toBeCloseTo(0.5 * AUDIO_MAPPING.particleForce);
    expect(ringSpeedFromAudio(0.4, 1)).toBeGreaterThan(0.4);
    expect(bloomFromAudio(0.8, 1)).toBeGreaterThan(0.8);
  });

  it("is bounded for any input (loud is bigger, never unbounded)", () => {
    for (const x of [-5, 0, 0.3, 1, 2, 1e9, Number.NaN]) {
      expect(coreScaleFromAudio(1, x)).toBeLessThanOrEqual(1.08);
      expect(coreScaleFromAudio(1, x)).toBeGreaterThanOrEqual(1);
      expect(coreIntensityFromAudio(1, x)).toBeLessThanOrEqual(AUDIO_MAPPING.coreIntensityMax);
      expect(particleForceFromAudio(x)).toBeLessThanOrEqual(AUDIO_MAPPING.particleForce);
      expect(bloomFromAudio(0.8, x)).toBeLessThanOrEqual(AUDIO_MAPPING.bloomMax);
    }
    expect(coreIntensityFromAudio(0.8, 0.2)).toBeLessThan(coreIntensityFromAudio(0.8, 0.9));
  });
});
