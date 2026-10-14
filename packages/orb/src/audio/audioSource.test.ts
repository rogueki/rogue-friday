import { describe, expect, it } from "vitest";
import { resolveAudioLevel, toAudioLevelReader, type OrbAudioSourceRef } from "./audioSource";

const holder = (read?: () => number): OrbAudioSourceRef => ({ current: read });

describe("audio source", () => {
  it("falls back to the status level without a reader", () => {
    expect(resolveAudioLevel(undefined, 0.4)).toBe(0.4);
    expect(resolveAudioLevel(holder(), 0.25)).toBe(0.25);
  });

  it("reads the live value on every call (no caching) and clamps to 0..1", () => {
    let level = 0.2;
    const source = holder(() => level);
    expect(resolveAudioLevel(source, 0.9)).toBe(0.2);
    level = 0.7;
    expect(resolveAudioLevel(source, 0.9)).toBe(0.7);
    level = 3;
    expect(resolveAudioLevel(source, 0)).toBe(1);
    level = -1;
    expect(resolveAudioLevel(source, 0.5)).toBe(0);
    level = Number.NaN;
    expect(resolveAudioLevel(source, 0.5)).toBe(0);
  });

  it("treats a throwing reader as silence instead of breaking the frame loop", () => {
    const source = holder(() => {
      throw new Error("analyser gone");
    });
    expect(resolveAudioLevel(source, 0.8)).toBe(0);
  });

  it("builds a reader from a function or a ref (function wins)", () => {
    const ref = { current: 0.3 as number | null };
    expect(toAudioLevelReader(undefined, undefined)).toBeUndefined();
    expect(toAudioLevelReader(undefined, ref)?.()).toBe(0.3);
    ref.current = null;
    expect(toAudioLevelReader(undefined, ref)?.()).toBe(0);
    expect(toAudioLevelReader(() => 0.9, ref)?.()).toBe(0.9);
  });
});
