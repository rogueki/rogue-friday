import { describe, expect, it } from "vitest";
import { QUALITY_ORDER, QUALITY_PROFILES, getQualityProfile } from "./settings";

/** PLAN §51.6 GPU quality scaling: every step up draws more (and never less) of each countable element. */
describe("quality profiles", () => {
  const counts = ["circuitTraces", "plates", "outerTraces", "outerArcs", "particles", "dust", "packets", "haloBars", "agentMarkersMax", "circuitNodes"] as const;

  it.each(counts)("%s strictly grows from low to ultra", (key) => {
    const values = QUALITY_ORDER.map((level) => QUALITY_PROFILES[level][key]);
    for (let i = 1; i < values.length; i += 1) expect(values[i], `${key}: ${QUALITY_ORDER[i]} vs ${QUALITY_ORDER[i - 1]}`).toBeGreaterThan(values[i - 1] as number);
  });

  it("the device pixel ratio never shrinks with the level and low skips bloom", () => {
    const dpr = QUALITY_ORDER.map((level) => QUALITY_PROFILES[level].dpr);
    expect([...dpr].sort((a, b) => a - b)).toEqual(dpr);
    expect(QUALITY_PROFILES.low.bloom).toBe(false);
  });

  it("particle density scales particles and dust inside one level", () => {
    expect(getQualityProfile("high", 100).particles).toBeGreaterThan(getQualityProfile("high", 20).particles);
    expect(getQualityProfile("high", 100).dust).toBeGreaterThan(getQualityProfile("high", 20).dust);
  });
});
