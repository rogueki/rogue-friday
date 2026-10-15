import type { AudioFixtureName, OrbSettings } from "@jarvis/orb";

/**
 * Deterministic orb test clock (PLAN §52.1) for the 3D scene, reachable from the browser in test builds only.
 *
 * Active only when the server reports `meta.features.devScenarios` (the dev scenario console; off in production
 * configs), so a production dashboard ignores every parameter below.
 *
 * - URL query: `?orbTime=3.2&orbProgress=0.5&orbAudio=loud&orbFrameMs=40`
 * - Window hook: `window.__JARVIS_ORB_TEST__ = { fixedTime, animationProgress, audioFixture, frameMs }` followed by
 *   `window.dispatchEvent(new Event("jarvis-orb-test"))` to change it without a reload.
 */
export interface OrbTestOverrides {
  /** Seconds since scene start; freezes the scene (no wall clock, no damping). */
  fixedTime?: number;
  /** 0..1 position inside the entry animation (boot reveal, error/success impulse). */
  animationProgress?: number;
  /** PLAN §52.3: silence | normal | loud | tts | spike. */
  audioFixture?: AudioFixtureName;
  /** Synthetic frame time in ms fed to the adaptive quality controller (GPU load simulation, PLAN §51.6). */
  frameMs?: number;
}

export const ORB_TEST_EVENT = "jarvis-orb-test";

declare global {
  interface Window {
    __JARVIS_ORB_TEST__?: OrbTestOverrides;
  }
}

const AUDIO_FIXTURES: readonly AudioFixtureName[] = ["silence", "normal", "loud", "tts", "spike"];

function finite(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** Merges the URL parameters with the window hook (the hook wins) into validated overrides; `undefined` when nothing is set. */
export function readOrbTestOverrides(): OrbTestOverrides | undefined {
  if (typeof window === "undefined") return undefined;
  const query = new URLSearchParams(window.location.search);
  const hook = window.__JARVIS_ORB_TEST__ ?? {};
  const fixedTime = finite(hook.fixedTime ?? query.get("orbTime"));
  const progress = finite(hook.animationProgress ?? query.get("orbProgress"));
  const audio = hook.audioFixture ?? query.get("orbAudio");
  const frameMs = finite(hook.frameMs ?? query.get("orbFrameMs"));
  const result: OrbTestOverrides = {
    ...(fixedTime !== undefined && fixedTime >= 0 ? { fixedTime } : {}),
    ...(progress !== undefined ? { animationProgress: Math.min(1, Math.max(0, progress)) } : {}),
    ...(audio && (AUDIO_FIXTURES as readonly string[]).includes(audio) ? { audioFixture: audio as AudioFixtureName } : {}),
    ...(frameMs !== undefined && frameMs > 0 ? { frameMs } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Orb settings for the overrides (animationProgress only has an effect together with fixedTime, as in the orb). */
export function orbSettingsFromTestOverrides(overrides: OrbTestOverrides | undefined): Partial<OrbSettings> {
  if (!overrides) return {};
  return {
    ...(overrides.fixedTime !== undefined
      ? { testClock: { fixedTime: overrides.fixedTime, ...(overrides.animationProgress !== undefined ? { animationProgress: overrides.animationProgress } : {}) } }
      : {}),
    ...(overrides.audioFixture ? { audioFixture: overrides.audioFixture } : {}),
    ...(overrides.frameMs !== undefined ? { testFrameMs: overrides.frameMs } : {}),
  };
}
