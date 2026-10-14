import { describe, expect, it } from "vitest";
import { pushAudioLevel, readAudioLevel, resetAudioLevels } from "./audioStore";

describe("readAudioLevel (orb per-frame reader)", () => {
  it("returns the latest level, clamps it and decays to 0 once events stop", () => {
    resetAudioLevels();
    expect(readAudioLevel(1_000)).toBe(0);
    pushAudioLevel("input", 0.4, 1_000);
    expect(readAudioLevel(1_100)).toBe(0.4);
    pushAudioLevel("input", 7, 1_200);
    expect(readAudioLevel(1_250)).toBe(1);
    expect(readAudioLevel(1_200 + 5_000)).toBe(0);
  });
});
