import { clamp01 } from "./frame";

/**
 * Audio -> visual mapping constants (owner order sections 9 and 14). All values are bounded; the scene never feeds raw
 * levels into a uniform. Kept in one place so the limits are testable.
 */
export const AUDIO_MAPPING = {
  /** coreScale = base + input * 0.08 */
  coreScale: 0.08,
  /** coreIntensity = base + input * 1.2 (clamped to the HDR maximum below) */
  coreIntensity: 1.2,
  coreIntensityMax: 1.75,
  /** waveAmplitude = input */
  waveAmplitude: 1,
  /** ringSpeed = base * (1 + input * k) */
  ringSpeed: 1.1,
  /** particleForce = input * k */
  particleForce: 0.9,
  /** bloom = base + input * k, upper bound */
  bloom: 0.45,
  bloomMax: 1.5,
  /** Peak detection for core kicks and radial pulses. */
  peakThreshold: 0.5,
  peakRise: 0.07,
  peakMinGapSec: 0.16,
} as const;

export const coreScaleFromAudio = (base: number, input: number): number => base + clamp01(input) * AUDIO_MAPPING.coreScale;

export const coreIntensityFromAudio = (base: number, input: number): number =>
  Math.min(AUDIO_MAPPING.coreIntensityMax, base + clamp01(input) * AUDIO_MAPPING.coreIntensity);

export const ringSpeedFromAudio = (base: number, input: number): number => base * (1 + clamp01(input) * AUDIO_MAPPING.ringSpeed);

export const particleForceFromAudio = (input: number): number => clamp01(input) * AUDIO_MAPPING.particleForce;

export const bloomFromAudio = (base: number, input: number): number =>
  Math.min(AUDIO_MAPPING.bloomMax, base + clamp01(input) * AUDIO_MAPPING.bloom);
