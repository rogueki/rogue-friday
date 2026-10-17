"use client";

import type { OrbSettings } from "@friday/orb";
import { useMemo, useSyncExternalStore } from "react";

/**
 * Visual debug overrides of the Orb lab (bloom, particle density, animation speed). They end up in the orb settings, so
 * they are the only debug values that go through React; mode, audio level, progress and agent count go straight to the
 * controller. The store is only read while the dev scenario features are on.
 */
export interface OrbDebugVisuals {
  /** 0..100: 0 switches bloom off, otherwise it is also the global emission. */
  bloom: number;
  /** 0..100 */
  particleDensity: number;
  /** 0.25..2 */
  speed: number;
}

export const DEFAULT_DEBUG_VISUALS: OrbDebugVisuals = { bloom: 70, particleDensity: 60, speed: 1 };

let overrides: Partial<OrbDebugVisuals> = {};
const listeners = new Set<() => void>();

export function setOrbDebugVisuals(patch: Partial<OrbDebugVisuals>): void {
  overrides = { ...overrides, ...patch };
  for (const listener of listeners) listener();
}

export function resetOrbDebugVisuals(): void {
  overrides = {};
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = (): Partial<OrbDebugVisuals> => overrides;

export function orbSettingsFromDebugVisuals(visuals: Partial<OrbDebugVisuals>): Partial<OrbSettings> {
  return {
    ...(visuals.bloom !== undefined ? { bloom: visuals.bloom > 0, intensity: visuals.bloom } : {}),
    ...(visuals.particleDensity !== undefined ? { particleDensity: visuals.particleDensity } : {}),
    ...(visuals.speed !== undefined ? { speed: visuals.speed } : {}),
  };
}

/** Orb settings overrides from the debug panel; empty (and inert) unless `enabled`. */
export function useOrbDebugSettings(enabled: boolean): Partial<OrbSettings> {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => (enabled ? orbSettingsFromDebugVisuals(current) : {}), [enabled, current]);
}

export function useOrbDebugVisuals(): Partial<OrbDebugVisuals> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
