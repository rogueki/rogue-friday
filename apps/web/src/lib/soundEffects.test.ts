import { afterEach, describe, expect, it, vi } from "vitest";
import { playDashboardSound } from "./soundEffects";

afterEach(() => vi.unstubAllGlobals());

describe("playDashboardSound cleanup", () => {
  it("closes the audio context when resume is rejected", async () => {
    const close = vi.fn(() => Promise.resolve());
    class RejectedAudioContext {
      currentTime = 0;
      destination = {};
      createOscillator() { return { type: "", frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }; }
      createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }; }
      resume() { return Promise.reject(new Error("autoplay blocked")); }
      close = close;
    }
    vi.stubGlobal("AudioContext", RejectedAudioContext);

    playDashboardSound(true, "approval");
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a created context if oscillator setup throws", () => {
    const close = vi.fn(() => Promise.resolve());
    class FailingAudioContext {
      close = close;
      createOscillator(): never { throw new Error("audio node unavailable"); }
    }
    vi.stubGlobal("AudioContext", FailingAudioContext);

    playDashboardSound(true, "alert");
    expect(close).toHaveBeenCalledOnce();
  });
});
