import type { OrbAudioFrame, OrbAudioLevels } from "../controller/types";

export const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN -> 0

export function createAudioFrame(): OrbAudioFrame {
  return { rms: 0, peak: 0, low: 0, mid: 0, high: 0, gateOpen: false, source: "none" };
}

export function clearAudioFrame(f: OrbAudioFrame): void {
  f.rms = 0;
  f.peak = 0;
  f.low = 0;
  f.mid = 0;
  f.high = 0;
  f.gateOpen = false;
  f.source = "none";
  f.bandsDerived = false;
}

export function copyAudioFrame(from: OrbAudioFrame, to: OrbAudioFrame): void {
  to.rms = from.rms;
  to.peak = from.peak;
  to.low = from.low;
  to.mid = from.mid;
  to.high = from.high;
  to.gateOpen = from.gateOpen;
  to.source = from.source;
  to.bandsDerived = from.bandsDerived;
}

export function createInputs(): { input: OrbAudioFrame; output: OrbAudioFrame; speechEnvelopeActive: boolean } {
  return { input: createAudioFrame(), output: createAudioFrame(), speechEnvelopeActive: false };
}

/** Cheap deterministic hash noise 0..1 (no Math.random). */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth 1D value noise 0..1. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash01(i + seed * 17.13) * (1 - u) + hash01(i + 1 + seed * 17.13) * u;
}

export interface NormalisedLevels {
  rms: number;
  peak: number;
  low: number;
  mid: number;
  high: number;
  /** low/mid/high were not delivered and are estimated from the scalar. */
  derived: boolean;
}

/** Scalar or banded level fact -> clamped numbers; missing bands are flagged as derived. */
export function normaliseLevels(input: number | OrbAudioLevels, out: NormalisedLevels): NormalisedLevels {
  if (typeof input === "number") {
    out.rms = clamp01(input);
    out.peak = out.rms;
    out.low = out.mid = out.high = out.rms;
    out.derived = true;
    return out;
  }
  const rms = clamp01(input.rms ?? input.level ?? input.peak ?? 0);
  out.rms = rms;
  out.peak = clamp01(input.peak ?? rms);
  const hasBands = input.low !== undefined || input.mid !== undefined || input.high !== undefined;
  out.low = clamp01(input.low ?? rms);
  out.mid = clamp01(input.mid ?? rms);
  out.high = clamp01(input.high ?? rms);
  out.derived = !hasBands;
  return out;
}
