import type { OrbSettings as WireOrbSettings } from "@jarvis/sdk";
import type { OrbMode } from "./contract-types";

export type OrbPreset = "gold" | "amber" | "calm" | "dense";
export type OrbQualitySetting = "auto" | "low" | "medium" | "high" | "ultra";
export type OrbQualityLevel = Exclude<OrbQualitySetting, "auto">;
export type OrbAnimations = "full" | "reduced" | "off";
export type OrbRenderer = "auto" | "3d" | "2d";
export type AudioFixtureName = "silence" | "normal" | "loud" | "tts" | "spike";

export interface OrbTestClock {
  /** Seconds since scene start. When set the scene is a pure function of this value (no damping, no wall clock). */
  fixedTime?: number;
  /** 0..1 position inside an entry animation (boot reveal, error/success impulse). */
  animationProgress?: number;
}

export interface OrbSettings {
  preset: OrbPreset;
  /** Orb scale inside its container, 0.5..1.5 (1 = orb + rings fill ~80 % of the panel). */
  size: number;
  /** 0..100, global emission. */
  intensity: number;
  /** 0.25..2 multiplier for rotation and flow speeds. */
  speed: number;
  /** 0..100 */
  particleDensity: number;
  audioReactive: boolean;
  mouseParallax: boolean;
  bloom: boolean;
  quality: OrbQualitySetting;
  animations: OrbAnimations;
  renderer: OrbRenderer;
  /** Per-mode secondary accent colour override as CSS hex (`#rrggbb`). */
  statusAccentColors: Partial<Record<OrbMode, string>>;
  testClock?: OrbTestClock;
  audioFixture?: AudioFixtureName;
}

export const DEFAULT_ORB_SETTINGS: OrbSettings = {
  preset: "gold",
  size: 1,
  intensity: 70,
  speed: 1,
  particleDensity: 60,
  audioReactive: true,
  mouseParallax: true,
  bloom: true,
  quality: "auto",
  animations: "full",
  renderer: "auto",
  statusAccentColors: {},
};

/** Maps the persisted wire settings (`@jarvis/sdk` OrbSettings, PLAN §42.3) onto the visual props of this package. */
export function orbSettingsFromWire(w: WireOrbSettings): Partial<OrbSettings> {
  const presets: readonly OrbPreset[] = ["gold", "amber", "calm", "dense"];
  return {
    preset: presets.find((p) => p === w.preset) ?? "gold",
    size: w.size,
    intensity: w.intensity,
    speed: w.speed,
    particleDensity: w.particleDensity,
    audioReactive: w.audioReactive,
    mouseParallax: w.mouseParallax,
    bloom: w.bloom,
    animations: w.animations,
    quality: w.quality,
    renderer: w.renderMode,
    statusAccentColors: w.statusColors as OrbSettings["statusAccentColors"],
  };
}

export function resolveSettings(partial?: Partial<OrbSettings>): OrbSettings {
  const merged: OrbSettings = { ...DEFAULT_ORB_SETTINGS, ...partial };
  merged.intensity = clamp(merged.intensity, 0, 100);
  merged.particleDensity = clamp(merged.particleDensity, 0, 100);
  merged.speed = clamp(merged.speed, 0.25, 2);
  merged.size = clamp(merged.size, 0.5, 1.5);
  return merged;
}

export interface QualityProfile {
  level: OrbQualityLevel;
  dpr: number;
  circuitTraces: number;
  plates: number;
  outerTraces: number;
  outerArcs: number;
  particles: number;
  dust: number;
  packets: number;
  haloBars: number;
  agentMarkersMax: number;
  circuitNodes: number;
  bloom: boolean;
  /** Fraction of the drawing buffer used for the bloom mip chain. */
  bloomResolutionScale: number;
  noiseOctaves: number;
  lineWidthPx: number;
}

export const QUALITY_PROFILES: Record<OrbQualityLevel, QualityProfile> = {
  low: {
    level: "low", dpr: 1, circuitTraces: 260, plates: 80, outerTraces: 100, outerArcs: 5, particles: 300,
    dust: 60, packets: 24, haloBars: 96, agentMarkersMax: 4, circuitNodes: 250, bloom: false,
    bloomResolutionScale: 0.25, noiseOctaves: 1, lineWidthPx: 1.5,
  },
  medium: {
    level: "medium", dpr: 1.25, circuitTraces: 560, plates: 130, outerTraces: 210, outerArcs: 7, particles: 600,
    dust: 120, packets: 50, haloBars: 128, agentMarkersMax: 6, circuitNodes: 450, bloom: true,
    bloomResolutionScale: 0.35, noiseOctaves: 2, lineWidthPx: 1.5,
  },
  high: {
    level: "high", dpr: 1.75, circuitTraces: 820, plates: 190, outerTraces: 320, outerArcs: 10, particles: 900,
    dust: 200, packets: 80, haloBars: 144, agentMarkersMax: 8, circuitNodes: 700, bloom: true,
    bloomResolutionScale: 0.5, noiseOctaves: 3, lineWidthPx: 1.5,
  },
  ultra: {
    level: "ultra", dpr: 2, circuitTraces: 1250, plates: 300, outerTraces: 480, outerArcs: 14, particles: 1400,
    dust: 300, packets: 120, haloBars: 160, agentMarkersMax: 12, circuitNodes: 1000, bloom: true,
    bloomResolutionScale: 0.75, noiseOctaves: 4, lineWidthPx: 1.5,
  },
};

export interface QualityHints {
  /** Level chosen by the adaptive controller; only used when the setting is `auto`. */
  measured?: OrbQualityLevel;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  coarsePointer?: boolean;
}

export const QUALITY_ORDER: OrbQualityLevel[] = ["low", "medium", "high", "ultra"];

/** Resolve the effective quality level. `auto` never starts at `ultra` (PLAN §22.1). */
export function resolveQuality(setting: OrbQualitySetting, hints: QualityHints = {}): OrbQualityLevel {
  if (setting !== "auto") return setting;
  if (hints.measured) return hints.measured === "ultra" ? "high" : hints.measured;
  if (hints.coarsePointer) return "medium";
  if ((hints.hardwareConcurrency ?? 8) <= 4 || (hints.deviceMemory ?? 8) <= 4) return "medium";
  return "high";
}

export function getQualityProfile(level: OrbQualityLevel, particleDensity: number): QualityProfile {
  const base = QUALITY_PROFILES[level];
  const k = 0.25 + 1.5 * (clamp(particleDensity, 0, 100) / 100);
  return {
    ...base,
    particles: Math.round(base.particles * k),
    dust: Math.round(base.dust * k),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
