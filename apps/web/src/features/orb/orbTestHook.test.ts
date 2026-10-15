import { afterEach, describe, expect, it } from "vitest";
import { orbSettingsFromTestOverrides, readOrbTestOverrides } from "./orbTestHook";

afterEach(() => {
  delete window.__JARVIS_ORB_TEST__;
  window.history.replaceState(null, "", "/");
});

describe("orb test clock hook", () => {
  it("is empty without parameters", () => {
    expect(readOrbTestOverrides()).toBeUndefined();
    expect(orbSettingsFromTestOverrides(undefined)).toEqual({});
  });

  it("reads and validates the URL parameters", () => {
    window.history.replaceState(null, "", "/?orbTime=3.5&orbProgress=2&orbAudio=loud&orbFrameMs=40");
    expect(readOrbTestOverrides()).toEqual({ fixedTime: 3.5, animationProgress: 1, audioFixture: "loud", frameMs: 40 });
  });

  it("drops invalid values", () => {
    window.history.replaceState(null, "", "/?orbTime=abc&orbAudio=chaos&orbFrameMs=-4&orbProgress=");
    expect(readOrbTestOverrides()).toBeUndefined();
  });

  it("lets the window hook win over the URL", () => {
    window.history.replaceState(null, "", "/?orbTime=1");
    window.__JARVIS_ORB_TEST__ = { fixedTime: 9, audioFixture: "spike" };
    expect(readOrbTestOverrides()).toEqual({ fixedTime: 9, audioFixture: "spike" });
  });

  it("maps to orb settings; a progress without a fixed time freezes nothing", () => {
    expect(orbSettingsFromTestOverrides({ fixedTime: 2, animationProgress: 0.5, audioFixture: "tts", frameMs: 30 })).toEqual({
      testClock: { fixedTime: 2, animationProgress: 0.5 },
      audioFixture: "tts",
      testFrameMs: 30,
    });
    expect(orbSettingsFromTestOverrides({ animationProgress: 0.5 })).toEqual({});
  });
});
