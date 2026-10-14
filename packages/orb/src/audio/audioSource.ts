import type { MutableRefObject } from "react";

/** Pull-based audio level (0..1), read once per rendered frame inside the animation loop (never through React state). */
export type OrbAudioLevelReader = () => number;

/** Holder the renderers read every frame; `JarvisOrb` keeps it in sync with its `getAudioLevel` / `audioLevelRef` props. */
export type OrbAudioSourceRef = MutableRefObject<OrbAudioLevelReader | undefined>;

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * Level for this frame: the live reader when one is wired, otherwise the (React-rate) `status.audioLevel` target.
 * A throwing reader must not kill the render loop; it counts as silence.
 */
export function resolveAudioLevel(source: OrbAudioSourceRef | undefined, statusLevel: number): number {
  const read = source?.current;
  if (!read) return statusLevel;
  try {
    return clamp01(read());
  } catch {
    return 0;
  }
}

/** Builds the reader from the two public input styles (function wins over ref). */
export function toAudioLevelReader(getAudioLevel: OrbAudioLevelReader | undefined, audioLevelRef: { readonly current: number | null } | undefined): OrbAudioLevelReader | undefined {
  if (getAudioLevel) return getAudioLevel;
  if (audioLevelRef) return () => audioLevelRef.current ?? 0;
  return undefined;
}
