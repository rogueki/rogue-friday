import type { OrbLayers, OrbMode, OrbStatus } from "../contract-types";
import {
  arbitrateOrbState,
  layersFromStatus,
  normalizeProgress,
  toInternalLayers,
  type OrbInternalLayers,
} from "../machine/orbMachine";
import { clamp, type OrbPreset, type OrbSettings } from "../settings";

export type RGB = readonly [number, number, number];
export type Vec3 = readonly [number, number, number];

/** Ring groups, in PLAN §15.3 order. */
export const RING_NAMES = ["core", "gyro", "primary", "secondary", "telemetry"] as const;
export type RingName = (typeof RING_NAMES)[number];

/** Static rotation axes of the five ring groups (unit-ish vectors); the scene tilts the ring planes with them. */
export const RING_AXES: readonly Vec3[] = [
  [0.18, 0.2, 1],
  [0.55, 0.35, 0.76],
  [0.12, 0.3, 1],
  [0.86, 0.1, 0.5],
  [0.0, 0.0, 1],
];

export const HALO_CYAN: RGB = [0.1, 0.78, 1.0];

export interface VisualTargets {
  mode: OrbMode;
  /** Core emission 0..1.6 (HDR). */
  coreIntensity: number;
  /** 0 = gold, 1 = white-hot. */
  coreWhite: number;
  breathPeriod: number;
  breathAmplitude: number;
  /** Radians per second per ring group (index = RING_NAMES). Signed. */
  ringSpeeds: [number, number, number, number, number];
  ringAxes: readonly Vec3[];
  /** Speed multiplier of the second gyro ring relative to the first (1 = same, -1 = counter-rotating). */
  gyroCounter: number;
  innerSpeed: number;
  midSpeed: number;
  outerSpeed: number;
  /** Outer shell activity 0..1 (jitter, flicker, energy). */
  shellActivity: number;
  /** Outward push of outer fragments, in orb units. */
  radialOffset: number;
  /** Fraction of traces carrying an energy packet + flow speed. */
  packetRate: number;
  flowSpeed: number;
  /** 0 = packets flow outwards/free, 1 = pulled towards the core. */
  convergence: number;
  scanPlane: number;
  /** Core-to-shell energy arcs (thinking/working/transcribing only). */
  energyArcs: number;
  haloMode: "off" | "cyan" | "gold";
  haloLevel: number;
  /** 1 = cyan halo, 0 = gold/white halo (numeric twin of haloMode for damping). */
  haloCyan: number;
  /** Halo bars freeze softly while transcribing. */
  haloFreeze: number;
  /** Expanding golden waves from the core (speaking). */
  speakWaves: number;
  saturation: number;
  emission: number;
  accentColor: RGB;
  accentMix: number;
  /** Segments turn towards the camera (listening/syncing/success). */
  align: number;
  fracture: number;
  /** 0..1 or null when the progress orbit is hidden. */
  progress: number;
  progressMode: "none" | "determinate" | "indeterminate";
  progressVisible: number;
  approval: number;
  warning: number;
  error: number;
  telemetryGap: number;
  agentCount: number;
  /** Boot reveal 0..1. */
  reveal: number;
  audioGain: number;
  audioLevel: number;
  bloomIntensity: number;
  /** Global time/motion scale for rotation (0 for offline etc.). */
  motionScale: number;
  parallax: boolean;
}

export interface DeriveInput {
  layers: OrbLayers;
  status: OrbStatus;
  settings: OrbSettings;
  /** OS-level `prefers-reduced-motion`. */
  reducedMotion?: boolean;
}

const hex = (h: string): RGB => {
  const v = h.replace("#", "");
  const n = parseInt(v.length === 3 ? v.replace(/./g, (c) => c + c) : v, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const ACCENT_DEFAULTS: Partial<Record<OrbMode, { color: RGB; mix: number }>> = {
  listening: { color: HALO_CYAN, mix: 0.08 },
  transcribing: { color: HALO_CYAN, mix: 0.18 },
  thinking: { color: [0.62, 0.42, 1.0], mix: 0.16 },
  syncing: { color: HALO_CYAN, mix: 0.14 },
  waiting_approval: { color: hex("#ffb000"), mix: 0.18 },
  success: { color: hex("#fff3c4"), mix: 0.28 },
  warning: { color: hex("#ff7a12"), mix: 0.34 },
  error: { color: hex("#ff2d14"), mix: 0.26 },
};

const PRESET_TWEAKS: Record<OrbPreset, { emission: number; speed: number; saturationBias: number }> = {
  gold: { emission: 1, speed: 1, saturationBias: 0 },
  amber: { emission: 1.02, speed: 1, saturationBias: 0.12 },
  calm: { emission: 0.85, speed: 0.6, saturationBias: 0 },
  dense: { emission: 1.1, speed: 1.15, saturationBias: 0 },
};

interface Base {
  coreIntensity: number;
  coreWhite: number;
  breathPeriod: number;
  breathAmplitude: number;
  ringSpeeds: [number, number, number, number, number];
  gyroCounter: number;
  innerSpeed: number;
  midSpeed: number;
  outerSpeed: number;
  shellActivity: number;
  radialOffset: number;
  packetRate: number;
  flowSpeed: number;
  convergence: number;
  scanPlane: number;
  haloMode: "off" | "cyan" | "gold";
  haloLevel: number;
  haloFreeze: number;
  speakWaves: number;
  align: number;
}

const IDLE: Base = {
  coreIntensity: 0.62, coreWhite: 0.3, breathPeriod: 5.2, breathAmplitude: 0.02,
  ringSpeeds: [0.16, 0.1, 0.035, -0.028, 0.012], gyroCounter: 0.6,
  innerSpeed: 0.1, midSpeed: 0.012, outerSpeed: 0.006,
  shellActivity: 0.1, radialOffset: 0, packetRate: 0.1, flowSpeed: 0.12, convergence: 0,
  scanPlane: 0, haloMode: "off", haloLevel: 0, haloFreeze: 0, speakWaves: 0, align: 0,
};

function voiceBase(voice: OrbInternalLayers["voice"]): Partial<Base> {
  switch (voice) {
    case "listening":
      return {
        coreIntensity: 0.92, coreWhite: 0.55, breathPeriod: 2.8, breathAmplitude: 0.03,
        ringSpeeds: [0.3, 0.16, 0.05, -0.04, 0.015], haloMode: "cyan", haloLevel: 0.85, align: 0.5,
        packetRate: 0.3, convergence: 0.55, innerSpeed: 0.18,
      };
    case "transcribing":
      return {
        coreIntensity: 0.8, coreWhite: 0.5, breathPeriod: 3.6, ringSpeeds: [0.42, 0.3, 0.08, -0.07, 0.02],
        haloMode: "cyan", haloLevel: 0.32, haloFreeze: 1, scanPlane: 1, convergence: 0.8, packetRate: 0.55,
        flowSpeed: 0.3, innerSpeed: 0.26,
      };
    case "thinking":
      return {
        coreIntensity: 1.02, coreWhite: 0.85, breathPeriod: 3.2, ringSpeeds: [0.5, 1.15, 0.05, -0.045, 0.014],
        gyroCounter: -1, convergence: 1, packetRate: 0.45, flowSpeed: 0.26, innerSpeed: 0.42, midSpeed: 0.02,
      };
    case "speaking":
      return {
        coreIntensity: 0.95, coreWhite: 0.7, breathPeriod: 2.4, breathAmplitude: 0.035,
        ringSpeeds: [0.32, 0.2, 0.06, -0.05, 0.016], haloMode: "gold", haloLevel: 0.95, speakWaves: 1,
        packetRate: 0.4, flowSpeed: 0.28, innerSpeed: 0.22, midSpeed: 0.05,
      };
    default:
      return {};
  }
}

function workBase(work: OrbInternalLayers["work"]): Partial<Base> {
  switch (work) {
    case "syncing":
      return {
        shellActivity: 0.5, packetRate: 0.7, flowSpeed: 0.42, align: 0.6, radialOffset: 0.02,
        ringSpeeds: [0.3, 0.18, 0.2, -0.17, 0.05], outerSpeed: 0.05, midSpeed: 0.03,
      };
    case "working":
      return {
        coreIntensity: 0.88, coreWhite: 0.45, breathPeriod: 3.4, shellActivity: 1, radialOffset: 0.1,
        packetRate: 1, flowSpeed: 0.62, ringSpeeds: [0.55, 0.35, 0.34, -0.3, 0.07], innerSpeed: 0.45,
        midSpeed: 0.1, outerSpeed: 0.075,
      };
    default:
      return {};
  }
}

/** The voice layer drives core + halo, the work layer drives mid/outer + packets; the busier value wins per field. */
function composeBase(layers: OrbInternalLayers): Base {
  const v = voiceBase(layers.voice);
  const w = workBase(layers.work);
  const out: Base = { ...IDLE, ...w, ...v };
  // Fields that both layers influence take the busier value so parallel activity stays visible.
  out.packetRate = Math.max(w.packetRate ?? 0, v.packetRate ?? 0, IDLE.packetRate);
  out.flowSpeed = Math.max(w.flowSpeed ?? 0, v.flowSpeed ?? 0, IDLE.flowSpeed);
  out.shellActivity = Math.max(w.shellActivity ?? 0, IDLE.shellActivity);
  out.radialOffset = Math.max(w.radialOffset ?? 0, 0);
  out.outerSpeed = Math.max(w.outerSpeed ?? 0, IDLE.outerSpeed);
  out.midSpeed = Math.max(w.midSpeed ?? 0, v.midSpeed ?? 0, IDLE.midSpeed);
  out.coreIntensity = Math.max(w.coreIntensity ?? 0, v.coreIntensity ?? 0, IDLE.coreIntensity);
  out.innerSpeed = Math.max(w.innerSpeed ?? 0, v.innerSpeed ?? 0, IDLE.innerSpeed);
  out.align = Math.max(w.align ?? 0, v.align ?? 0);
  if (layers.voice !== "idle" && layers.work !== "idle") {
    const rs = out.ringSpeeds;
    const wr = w.ringSpeeds ?? IDLE.ringSpeeds;
    const vr = v.ringSpeeds ?? IDLE.ringSpeeds;
    out.ringSpeeds = rs.map((_, i) => (Math.abs(wr[i] ?? 0) > Math.abs(vr[i] ?? 0) ? wr[i] : vr[i])) as Base["ringSpeeds"];
    // Thinking keeps its dedicated counter-rotating gyro even while agents work.
    out.ringSpeeds[1] = vr[1] ?? out.ringSpeeds[1];
  }
  return out;
}

export function deriveVisualTargets({ layers: wireLayers, status, settings, reducedMotion }: DeriveInput): VisualTargets {
  const { layers, flashSuccess } = toInternalLayers({ status, layers: wireLayers });
  const mode = arbitrateOrbState({ layers, flashSuccess });
  const preset = PRESET_TWEAKS[settings.preset];
  const reduced = settings.animations === "reduced" || reducedMotion === true;
  const speedScale = settings.speed * preset.speed * (reduced ? 0.1 : 1);

  const base = composeBase(layers);
  let motion = 1;
  let emission = (0.2 + (0.8 * settings.intensity) / 70) * preset.emission;
  let saturation = clamp(1 + preset.saturationBias, 0, 1);
  let packetRate = base.packetRate;
  let shellActivity = base.shellActivity;
  let radialOffset = base.radialOffset;
  let coreIntensity = base.coreIntensity;
  let fracture = 0;
  let approval = 0;
  let warning = 0;
  let error = 0;
  let reveal = 1;
  let align = base.align;
  let haloLevel = base.haloLevel;
  let haloMode = base.haloMode;
  let scanPlane = base.scanPlane;
  let convergence = base.convergence;
  let speakWaves = base.speakWaves;

  if (mode === "waiting_approval" || layers.attention === "approval") {
    // Motion calms down deliberately; the amber ring carries the state.
    approval = 1;
    motion = Math.min(motion, 0.4);
    packetRate = Math.min(packetRate, 0.15);
    shellActivity = Math.min(shellActivity, 0.22);
    radialOffset = Math.min(radialOffset, 0.03);
    coreIntensity = Math.min(coreIntensity, 0.6);
  }
  if (layers.attention === "warning") {
    warning = 1;
    saturation = Math.min(saturation, 0.95);
  }
  if (layers.attention === "error") {
    error = 1;
    fracture = 0.75;
    packetRate = Math.max(packetRate * 0.5, 0.12);
    shellActivity = Math.max(shellActivity, 0.55);
  }
  if (mode === "success") {
    align = Math.max(align, 1);
    coreIntensity = Math.max(coreIntensity, 1.2);
    motion = Math.min(motion, 0.5);
    packetRate = Math.max(packetRate, 0.35);
  }
  if (mode === "paused") {
    motion = 0.05;
    emission *= 0.5;
    saturation = Math.min(saturation, 0.55);
    packetRate = 0;
    shellActivity = 0.05;
    radialOffset = 0;
    coreIntensity = Math.min(coreIntensity, 0.4);
    haloLevel = 0;
    haloMode = "off";
    scanPlane = 0;
    convergence = 0;
    speakWaves = 0;
    align = 0;
  }
  if (mode === "offline") {
    motion = 0;
    emission *= 0.22;
    saturation = 0.06;
    packetRate = 0;
    shellActivity = 0;
    radialOffset = 0;
    coreIntensity = 0.22;
    haloLevel = 0;
    haloMode = "off";
    scanPlane = 0;
    convergence = 0;
    speakWaves = 0;
    align = 0;
    approval = 0;
    warning = 0;
  }
  if (mode === "booting") {
    coreIntensity = 0.8;
    saturation = 0.55;
    emission *= 0.75;
    reveal = 1;
    packetRate = 0.25;
  }

  const ringSpeeds = base.ringSpeeds.map((s) => s * motion * speedScale) as VisualTargets["ringSpeeds"];
  if (mode === "offline" || mode === "paused") {
    // Paused keeps only the outermost fragments barely alive; inner rings stand still (PLAN §19.14).
    ringSpeeds[0] = 0;
    ringSpeeds[1] = 0;
    ringSpeeds[2] = mode === "paused" ? ringSpeeds[2] : 0;
  }

  const accentDef = ACCENT_DEFAULTS[mode];
  const override = settings.statusAccentColors[mode];
  const accentColor: RGB = override ? hex(override) : (accentDef?.color ?? [1, 0.74, 0.2]);
  let accentMix = accentDef?.mix ?? 0;
  if (layers.attention === "error" && mode !== "error") accentMix = Math.max(accentMix, 0.15);

  const progress = normalizeProgress(status.progress);
  let progressMode: VisualTargets["progressMode"] = status.progressMode ?? (progress === null ? "none" : "determinate");
  if (progressMode === "determinate" && progress === null) progressMode = "none"; // never invent a percentage
  if (mode === "offline" || mode === "paused" || mode === "booting") progressMode = progressMode === "none" ? "none" : progressMode;

  const arcsRaw = Math.max(
    layers.voice === "thinking" ? 0.9 : 0,
    layers.voice === "transcribing" ? 0.5 : 0,
    layers.work === "working" ? 0.75 : 0,
    layers.work === "syncing" ? 0.3 : 0,
  );
  const energyArcs = mode === "offline" || mode === "paused" ? 0 : arcsRaw * (approval > 0 ? 0.2 : 1) * (reduced ? 0.4 : 1);

  const audioGain = settings.audioReactive && (layers.voice === "listening" || layers.voice === "speaking") ? 1 : 0;
  const telemetryGap = layers.health === "offline" ? 0.3 : layers.health === "degraded" ? 0.14 : 0.045;
  const agentCount = Math.max(layers.activeAgentIds.length, status.activeAgentCount ?? 0);

  return {
    mode,
    coreIntensity,
    coreWhite: base.coreWhite,
    breathPeriod: base.breathPeriod,
    breathAmplitude: reduced ? 0.01 : base.breathAmplitude,
    ringSpeeds,
    ringAxes: RING_AXES,
    gyroCounter: base.gyroCounter,
    innerSpeed: base.innerSpeed * motion * speedScale,
    midSpeed: base.midSpeed * motion * speedScale,
    outerSpeed: base.outerSpeed * motion * speedScale,
    shellActivity: shellActivity * (reduced ? 0.3 : 1) * (mode === "offline" ? 0 : 1),
    radialOffset: reduced ? 0 : radialOffset,
    packetRate: packetRate * (reduced ? 0.4 : 1),
    flowSpeed: base.flowSpeed * (reduced ? 0.4 : settings.speed) * (mode === "paused" ? 0 : 1),
    convergence,
    scanPlane: reduced ? scanPlane * 0.4 : scanPlane,
    energyArcs,
    haloMode,
    haloLevel,
    haloCyan: haloMode === "cyan" ? 1 : 0,
    haloFreeze: base.haloFreeze,
    speakWaves: reduced ? 0 : speakWaves,
    saturation,
    emission,
    accentColor,
    accentMix,
    align,
    fracture: reduced ? fracture * 0.5 : fracture,
    progress: progress ?? 0,
    progressMode,
    progressVisible: progressMode === "none" ? 0 : 1,
    approval,
    warning,
    error,
    telemetryGap,
    agentCount,
    reveal,
    audioGain,
    audioLevel: audioGain > 0 ? clamp(status.audioLevel ?? 0, 0, 1) : 0,
    bloomIntensity: settings.bloom ? 0.8 : 0,
    motionScale: reduced ? 0.1 : 1,
    parallax: settings.mouseParallax && !reduced && settings.animations === "full",
  };
}

/** Convenience for callers that only have a status (mode only) and no explicit layers. */
export function deriveFromStatus(status: OrbStatus, settings: OrbSettings, reducedMotion?: boolean): VisualTargets {
  return deriveVisualTargets({ layers: layersFromStatus(status), status, settings, reducedMotion });
}

export interface TransitionTimes {
  /** Total settle time (ms), PLAN §20.2. */
  durationMs: number;
  /** Damping time constants in seconds (settle ~ 3 tau). */
  intensity: number;
  motion: number;
  color: number;
  overlay: number;
}


/** Settle time for a mode change, from the PLAN §20.2 table; unspecified pairs default to 350 ms. */
export function transitionDurationMs(from: OrbMode, to: OrbMode): number {
  if (from === to) return 0;
  if (to === "error") return 160;
  if (from === "error") return 950;
  if (from === "offline") return 1300;
  if (to === "offline") return 700;
  if (from === "booting") return 1800;
  if (from === "idle" && to === "listening") return 170;
  if (from === "listening" && to === "transcribing") return 240;
  if (from === "transcribing" && to === "thinking") return 300;
  if (from === "thinking" && to === "working") return 420;
  if (from === "working" && to === "speaking") return 250;
  if (to === "success") return 160;
  if (from === "success") return 600;
  if (to === "waiting_approval" || from === "waiting_approval") return 520;
  if (to === "paused" || from === "paused") return 500;
  if (to === "working") return 450;
  return 350;
}

export function transitionTimeConstants(from: OrbMode, to: OrbMode): TransitionTimes {
  const durationMs = transitionDurationMs(from, to) || 350;
  const tau = durationMs / 1000 / 3;
  return {
    durationMs,
    intensity: tau,
    motion: tau * 1.5,
    color: tau * 1.2,
    overlay: to === "error" ? tau * 0.6 : tau * 0.9,
  };
}
