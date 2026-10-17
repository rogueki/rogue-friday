import type { OrbLayers, OrbMode, OrbStatus } from "../contract-types";
import {
  arbitrateOrbState,
  layersFromStatus,
  normalizeProgress,
  toInternalLayers,
  type OrbInternalLayers,
} from "../machine/orbMachine";
import { attentionFlags, toMachineLayers } from "../controller/layers";
import type { OrbControllerState } from "../controller/types";
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
  /** Core emission 0..1.8 (HDR). Base value; the breath cycle and the audio mapping modulate it per frame. */
  coreIntensity: number;
  /** 0 = gold, 1 = white-hot. */
  coreWhite: number;
  /** Core breath cycle in seconds (idle 4.5-6 s, order section 8). */
  breathPeriod: number;
  /** Half range of the core scale cycle around 1.0025 (idle 0.0325 -> 0.97..1.035). */
  breathAmplitude: number;
  /** Brightness swing of the breath: 0.28 -> brightness cycles between 72 % and 100 % of `coreIntensity`. */
  breathDepth: number;
  /** CoreEnergyNoise turbulence 0..1. */
  coreNoise: number;
  /**
   * Radians per second per ring group, signed (negative = clockwise as seen by the user). Index:
   * 0 inner ring A, 1 inner ring B, 2 outer ring A (primary), 3 outer ring B (secondary), 4 telemetry ring.
   */
  ringSpeeds: [number, number, number, number, number];
  ringAxes: readonly Vec3[];
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
  /** Occasional data impulses travelling along ring segments (0 = rare, 1 = continuous). */
  pulseRate: number;
  /** HorizontalScan (transcribing). */
  scanPlane: number;
  /** RadialScan wedge (transcribing). */
  radialScan: number;
  /** AnalysisSweep (thinking): contracting sweeps between the inner rings. */
  analysisSweep: number;
  /** Two counter-rotating sweep rings (syncing). */
  syncSweep: number;
  /** Circuit lines light up one after the other (thinking). */
  circuitSeq: number;
  /** Telemetry ring shows incoming and outgoing data (syncing). */
  telemetryDual: number;
  /** Core-to-shell energy arcs (thinking/working/transcribing only). */
  energyArcs: number;
  /** InputWaveRing opening (listening) and OutputWaveRing (speaking). */
  waveIn: number;
  waveOut: number;
  /** RadialPulseRings triggered by audio peaks (listening/speaking). */
  radialPulse: number;
  /** Slow focus ring moving outwards (waiting for approval). */
  focus: number;
  /** Slow amber warning pulse (degraded operation). */
  warnPulse: number;
  /** Energy particles stream to the core (transcribing). */
  particleInward: number;
  /** Energy particles are pushed outwards by the audio (listening/speaking). */
  particleDrive: number;
  /** Transparent holographic shells. */
  shells: number;
  saturation: number;
  emission: number;
  accentColor: RGB;
  accentMix: number;
  /** Segments turn towards the camera (listening/transcribing/syncing/success). */
  align: number;
  fracture: number;
  /** 0..1 or null when the progress orbit is hidden. */
  progress: number;
  progressMode: "none" | "determinate" | "indeterminate";
  progressVisible: number;
  /** Approval ring + glyph. */
  approval: number;
  warning: number;
  error: number;
  /** Some outer rings fade while operation is degraded (the orb stays alive). */
  outerReduce: number;
  telemetryGap: number;
  agentCount: number;
  /** Boot reveal 0..1. */
  reveal: number;
  /** Per-direction audio gates (microphone only drives listening, TTS only speaking). */
  audioGainIn: number;
  audioGainOut: number;
  /** Legacy single-level path: 1 while listening/speaking and reactive audio is on. */
  audioGain: number;
  audioLevel: number;
  /** 1 under reduced motion: audio shows only as a calm ring (no core/particle bursts). */
  calm: number;
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
  listening: { color: HALO_CYAN, mix: 0.06 },
  transcribing: { color: HALO_CYAN, mix: 0.14 },
  thinking: { color: [0.62, 0.42, 1.0], mix: 0.16 },
  syncing: { color: HALO_CYAN, mix: 0.12 },
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
  breathDepth: number;
  coreNoise: number;
  ringSpeeds: [number, number, number, number, number];
  midSpeed: number;
  outerSpeed: number;
  shellActivity: number;
  radialOffset: number;
  packetRate: number;
  flowSpeed: number;
  convergence: number;
  pulseRate: number;
  scanPlane: number;
  radialScan: number;
  analysisSweep: number;
  syncSweep: number;
  circuitSeq: number;
  telemetryDual: number;
  waveIn: number;
  waveOut: number;
  radialPulse: number;
  particleInward: number;
  particleDrive: number;
  shells: number;
  align: number;
}

/**
 * Idle lives (owner order section 8): core scale 0.97-1.035 over a 4.5-6 s cycle, core brightness 72-100 %, inner ring A
 * 8-14 s per revolution clockwise, inner ring B 13-21 s counter-clockwise, outer ring 22-35 s. Rad/s = 2 pi / period.
 */
export const IDLE: Base = {
  coreIntensity: 0.8, coreWhite: 0.32, breathPeriod: 5.25, breathAmplitude: 0.0325, breathDepth: 0.28, coreNoise: 0.35,
  ringSpeeds: [-0.571, 0.37, -0.22, 0.19, -0.18], midSpeed: 0.05, outerSpeed: 0.035,
  shellActivity: 0.18, radialOffset: 0, packetRate: 0.16, flowSpeed: 0.16, convergence: 0, pulseRate: 0.3,
  scanPlane: 0, radialScan: 0, analysisSweep: 0, syncSweep: 0, circuitSeq: 0, telemetryDual: 0,
  waveIn: 0, waveOut: 0, radialPulse: 0, particleInward: 0, particleDrive: 0, shells: 0.35, align: 0,
};

function voiceBase(voice: OrbInternalLayers["voice"]): Partial<Base> {
  switch (voice) {
    case "listening":
      return {
        coreIntensity: 1.0, coreWhite: 0.62, breathPeriod: 2.6, breathAmplitude: 0.035, breathDepth: 0.18, coreNoise: 0.5,
        ringSpeeds: [-0.85, 0.55, -0.3, 0.26, -0.22], midSpeed: 0.07, packetRate: 0.35, flowSpeed: 0.3, convergence: 0.1,
        pulseRate: 0.65, waveIn: 1, radialPulse: 0.8, particleDrive: 1, shells: 0.45, align: 0.45, shellActivity: 0.3,
      };
    case "transcribing":
      return {
        coreIntensity: 0.88, coreWhite: 0.55, breathPeriod: 1.9, breathAmplitude: 0.018, breathDepth: 0.16, coreNoise: 0.65,
        ringSpeeds: [-0.7, 0.5, -0.22, 0.2, -0.2], midSpeed: 0.06, packetRate: 0.6, flowSpeed: 0.35, convergence: 0.85,
        pulseRate: 0.7, scanPlane: 1, radialScan: 1, particleInward: 1, shells: 0.5, align: 0.85, shellActivity: 0.25,
      };
    case "thinking":
      return {
        coreIntensity: 1.05, coreWhite: 0.88, breathPeriod: 3.0, breathAmplitude: 0.03, breathDepth: 0.22, coreNoise: 1,
        ringSpeeds: [-1.1, 1.25, -0.2, 0.18, -0.2], midSpeed: 0.08, packetRate: 0.5, flowSpeed: 0.28, convergence: 1,
        pulseRate: 0.9, analysisSweep: 1, circuitSeq: 1, shells: 0.6, radialOffset: 0.03, shellActivity: 0.35,
      };
    case "speaking":
      return {
        coreIntensity: 1.0, coreWhite: 0.72, breathPeriod: 2.4, breathAmplitude: 0.03, breathDepth: 0.2, coreNoise: 0.6,
        ringSpeeds: [-0.9, 0.6, -0.3, 0.28, -0.22], midSpeed: 0.06, packetRate: 0.45, flowSpeed: 0.3, pulseRate: 0.7,
        waveOut: 1, radialPulse: 1, particleDrive: 1, shells: 0.5, shellActivity: 0.3,
      };
    default:
      return {};
  }
}

function workBase(work: OrbInternalLayers["work"]): Partial<Base> {
  switch (work) {
    case "syncing":
      return {
        coreIntensity: 0.9, breathPeriod: 3.2, breathDepth: 0.34, breathAmplitude: 0.03, shellActivity: 0.5, packetRate: 0.75,
        flowSpeed: 0.45, align: 0.3, radialOffset: 0.02, ringSpeeds: [-0.7, 0.45, -0.5, 0.45, -0.6], midSpeed: 0.07,
        outerSpeed: 0.06, pulseRate: 0.85, syncSweep: 1, telemetryDual: 1, shells: 0.45,
      };
    case "working":
      return {
        coreIntensity: 0.92, coreWhite: 0.45, breathPeriod: 3.4, breathAmplitude: 0.03, breathDepth: 0.22, shellActivity: 1,
        radialOffset: 0.1, packetRate: 1, flowSpeed: 0.62, ringSpeeds: [-0.9, 0.7, -0.55, 0.5, -0.35], midSpeed: 0.1,
        outerSpeed: 0.09, pulseRate: 1, circuitSeq: 0.4, shells: 0.5,
      };
    default:
      return {};
  }
}

const MAX_FIELDS: readonly (keyof Base)[] = [
  "shellActivity", "radialOffset", "packetRate", "flowSpeed", "pulseRate", "shells", "align", "midSpeed", "outerSpeed",
  "convergence", "circuitSeq", "coreNoise", "coreIntensity",
];

/** The voice layer drives core + voice rings, the work layer the outer layers + packets; the busier value wins per field. */
function composeBase(layers: OrbInternalLayers): Base {
  const v = voiceBase(layers.voice);
  const w = workBase(layers.work);
  const out: Base = { ...IDLE, ...w, ...v };
  for (const key of MAX_FIELDS) {
    (out as unknown as Record<string, number>)[key] = Math.max(IDLE[key] as number, (w[key] as number | undefined) ?? 0, (v[key] as number | undefined) ?? 0);
  }
  // Core look follows the voice layer when it is active, otherwise the work layer (core is never both).
  if (layers.voice === "idle" && layers.work !== "idle") {
    out.coreWhite = w.coreWhite ?? IDLE.coreWhite;
    out.breathPeriod = w.breathPeriod ?? IDLE.breathPeriod;
    out.breathAmplitude = w.breathAmplitude ?? IDLE.breathAmplitude;
    out.breathDepth = w.breathDepth ?? IDLE.breathDepth;
  }
  // Per ring the faster layer wins, so a speaking core can sit inside working outer rings.
  if (layers.voice !== "idle" && layers.work !== "idle") {
    const wr = w.ringSpeeds ?? IDLE.ringSpeeds;
    const vr = v.ringSpeeds ?? IDLE.ringSpeeds;
    out.ringSpeeds = vr.map((_, i) => (Math.abs(wr[i] ?? 0) > Math.abs(vr[i] ?? 0) ? wr[i] : vr[i])) as Base["ringSpeeds"];
    if (layers.voice === "thinking") {
      out.ringSpeeds[0] = vr[0] as number; // thinking keeps its dedicated counter-rotating inner rings
      out.ringSpeeds[1] = vr[1] as number;
    }
  }
  return out;
}

export interface AttentionInput {
  approval: boolean;
  warning: boolean;
  error: boolean;
}

export interface ComposeInput {
  layers: OrbInternalLayers;
  flashSuccess: boolean;
  /** Parallel attention items (the single `layers.attention` only ranks them). */
  flags: AttentionInput;
  progress: number | null;
  progressMode?: "none" | "determinate" | "indeterminate";
  /** Legacy single audio level of the status (used when no controller/reader feeds frames). */
  audioLevel: number;
  activeAgentCount: number;
  settings: OrbSettings;
  reducedMotion?: boolean;
}

/** Pure derivation shared by the wire path (`deriveVisualTargets`) and the controller path. */
export function composeVisualTargets(input: ComposeInput): VisualTargets {
  const { layers, flashSuccess, flags, settings } = input;
  const mode = arbitrateOrbState({ layers, flashSuccess });
  const preset = PRESET_TWEAKS[settings.preset];
  const reduced = settings.animations === "reduced" || input.reducedMotion === true;
  const speedScale = settings.speed * preset.speed * (reduced ? 0.1 : 1);

  const base = composeBase(layers);
  let motion = 1;
  let emission = (0.2 + (0.8 * settings.intensity) / 70) * preset.emission;
  let saturation = clamp(1 + preset.saturationBias, 0, 1);
  let packetRate = base.packetRate;
  let shellActivity = base.shellActivity;
  let radialOffset = base.radialOffset;
  let coreIntensity = base.coreIntensity;
  let breathPeriod = base.breathPeriod;
  let breathAmplitude = base.breathAmplitude;
  let breathDepth = base.breathDepth;
  let pulseRate = base.pulseRate;
  let fracture = 0;
  let approval = 0;
  let warning = 0;
  let error = 0;
  let outerReduce = 0;
  let warnPulse = 0;
  let focus = 0;
  let reveal = 1;
  let align = base.align;
  let scanPlane = base.scanPlane;
  let radialScan = base.radialScan;
  let analysisSweep = base.analysisSweep;
  let syncSweep = base.syncSweep;
  let circuitSeq = base.circuitSeq;
  let telemetryDual = base.telemetryDual;
  let convergence = base.convergence;
  let waveIn = base.waveIn;
  let waveOut = base.waveOut;
  let radialPulse = base.radialPulse;
  let particleInward = base.particleInward;
  let particleDrive = base.particleDrive;
  let shells = base.shells;
  let coreNoise = base.coreNoise;

  if (flags.approval) {
    // Slow concentrated pulse, rings slower, ring-shaped focus moving outwards; the amber ring + glyph carry the state.
    approval = 1;
    focus = 1;
    motion = Math.min(motion, 0.55);
    packetRate = Math.min(packetRate, 0.2);
    shellActivity = Math.min(shellActivity, 0.25);
    radialOffset = Math.min(radialOffset, 0.03);
    pulseRate = Math.min(pulseRate, 0.25);
    if (layers.voice === "idle") {
      coreIntensity = Math.min(coreIntensity, 0.78);
      breathPeriod = 4.4;
      breathAmplitude = 0.022;
      breathDepth = 0.34;
    }
  }
  if (flags.warning) {
    // Degraded operation stays alive: slower pulse, a few outer rings reduced, a subtle amber pulse, one broken ring.
    warning = 1;
    outerReduce = 1;
    warnPulse = 1;
    saturation = Math.min(saturation, 0.95);
    if (layers.voice === "idle") {
      breathPeriod = Math.max(breathPeriod, 7.2);
      breathAmplitude = Math.min(breathAmplitude, 0.03);
      breathDepth = Math.max(breathDepth, 0.34);
      coreIntensity = Math.min(coreIntensity, 0.8);
    }
    motion = Math.min(motion, 0.72);
  }
  if (flags.error) {
    error = 1;
    fracture = 0.75;
    packetRate = Math.max(packetRate * 0.5, 0.12);
    shellActivity = Math.max(shellActivity, 0.4);
    motion = Math.min(motion, 0.6);
    // The core stays visible and steady: no flicker, no breath swing beyond the idle cycle.
    coreIntensity = Math.max(coreIntensity, 0.78);
    breathDepth = Math.min(breathDepth, 0.25);
  }
  if (mode === "success") {
    align = Math.max(align, 1);
    coreIntensity = Math.max(coreIntensity, 1.25);
    motion = Math.min(motion, 0.5);
    packetRate = Math.max(packetRate, 0.35);
  }
  const frozen = (m: OrbMode) => m === "offline" || m === "paused";
  if (mode === "paused") {
    motion = 0.05;
    emission *= 0.5;
    saturation = Math.min(saturation, 0.55);
    packetRate = 0;
    shellActivity = 0.05;
    radialOffset = 0;
    coreIntensity = Math.min(coreIntensity, 0.4);
    breathDepth = 0.1;
    scanPlane = radialScan = analysisSweep = syncSweep = circuitSeq = telemetryDual = convergence = 0;
    waveIn = waveOut = radialPulse = particleInward = particleDrive = align = pulseRate = coreNoise = 0;
    shells = 0.15;
  }
  if (mode === "offline") {
    motion = 0;
    emission *= 0.22;
    saturation = 0.06;
    packetRate = 0;
    shellActivity = 0;
    radialOffset = 0;
    coreIntensity = 0.22;
    breathDepth = 0;
    scanPlane = radialScan = analysisSweep = syncSweep = circuitSeq = telemetryDual = convergence = 0;
    waveIn = waveOut = radialPulse = particleInward = particleDrive = align = pulseRate = coreNoise = 0;
    shells = 0;
    approval = 0;
    warning = 0;
    focus = 0;
    warnPulse = 0;
    outerReduce = 0;
  }
  if (mode === "booting") {
    coreIntensity = 0.8;
    saturation = 0.55;
    emission *= 0.75;
    reveal = 1;
    packetRate = 0.25;
  }

  const ringSpeeds = base.ringSpeeds.map((s) => s * motion * speedScale) as VisualTargets["ringSpeeds"];
  if (mode === "offline") ringSpeeds.fill(0);
  if (mode === "paused") {
    // Paused keeps only the outermost rings barely alive; inner rings stand still (PLAN §19.14).
    ringSpeeds[0] = 0;
    ringSpeeds[1] = 0;
  }

  const accentDef = ACCENT_DEFAULTS[mode];
  const override = settings.statusAccentColors[mode];
  const accentColor: RGB = override ? hex(override) : (accentDef?.color ?? [1, 0.74, 0.2]);
  let accentMix = accentDef?.mix ?? 0;
  if (flags.error && mode !== "error") accentMix = Math.max(accentMix, 0.15);

  const progress = normalizeProgress(input.progress);
  let progressMode: VisualTargets["progressMode"] = input.progressMode ?? (progress === null ? "none" : "determinate");
  if (progressMode === "determinate" && progress === null) progressMode = "none"; // never invent a percentage

  const arcsRaw = Math.max(
    layers.voice === "thinking" ? 0.9 : 0,
    layers.voice === "transcribing" ? 0.5 : 0,
    layers.work === "working" ? 0.75 : 0,
    layers.work === "syncing" ? 0.3 : 0,
  );
  const energyArcs = frozen(mode) ? 0 : arcsRaw * (approval > 0 ? 0.2 : 1) * (reduced ? 0.4 : 1);

  const reactive = settings.audioReactive && !frozen(mode);
  const audioGainIn = reactive && layers.voice === "listening" ? 1 : 0;
  const audioGainOut = reactive && layers.voice === "speaking" ? 1 : 0;
  const audioGain = audioGainIn > 0 || audioGainOut > 0 ? 1 : 0;
  const telemetryGap = layers.health === "offline" ? 0.3 : layers.health === "degraded" || flags.warning ? 0.14 : 0.045;
  const agentCount = Math.max(layers.activeAgentIds.length, input.activeAgentCount);
  const r = reduced ? 0.4 : 1;

  return {
    mode,
    coreIntensity,
    coreWhite: base.coreWhite,
    breathPeriod,
    breathAmplitude: reduced ? Math.min(breathAmplitude, 0.012) : breathAmplitude,
    breathDepth: reduced ? breathDepth * 0.5 : breathDepth,
    coreNoise: coreNoise * (reduced ? 0.5 : 1),
    ringSpeeds,
    ringAxes: RING_AXES,
    midSpeed: base.midSpeed * motion * speedScale,
    outerSpeed: base.outerSpeed * motion * speedScale,
    shellActivity: shellActivity * (reduced ? 0.3 : 1) * (mode === "offline" ? 0 : 1),
    radialOffset: reduced ? 0 : radialOffset,
    packetRate: packetRate * r,
    flowSpeed: base.flowSpeed * (reduced ? 0.4 : settings.speed) * (mode === "paused" ? 0 : 1),
    convergence,
    pulseRate: pulseRate * r,
    scanPlane: scanPlane * r,
    radialScan: radialScan * r,
    analysisSweep: analysisSweep * r,
    syncSweep: syncSweep * r,
    circuitSeq: circuitSeq * r,
    telemetryDual: telemetryDual * r,
    energyArcs,
    waveIn,
    waveOut,
    radialPulse: reduced ? 0 : radialPulse,
    focus: reduced ? focus * 0.5 : focus,
    warnPulse: reduced ? warnPulse * 0.5 : warnPulse,
    particleInward: reduced ? 0 : particleInward,
    particleDrive: reduced ? 0 : particleDrive,
    shells,
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
    outerReduce,
    telemetryGap,
    agentCount,
    reveal,
    audioGainIn,
    audioGainOut,
    audioGain,
    audioLevel: audioGain > 0 ? clamp(input.audioLevel, 0, 1) : 0,
    calm: reduced ? 1 : 0,
    bloomIntensity: settings.bloom ? 0.8 * settings.bloomStrength : 0,
    motionScale: reduced ? 0.1 : 1,
    parallax: settings.mouseParallax && !reduced && settings.animations === "full",
  };
}

export function deriveVisualTargets({ layers: wireLayers, status, settings, reducedMotion }: DeriveInput): VisualTargets {
  const internal = toInternalLayers({ status, layers: wireLayers });
  return composeVisualTargets({
    layers: internal.layers,
    flashSuccess: internal.flashSuccess,
    flags: {
      approval: internal.layers.attention === "approval",
      warning: internal.layers.attention === "warning",
      error: internal.layers.attention === "error",
    },
    progress: status.progress ?? null,
    progressMode: status.progressMode ?? undefined,
    audioLevel: status.audioLevel ?? 0,
    activeAgentCount: status.activeAgentCount ?? 0,
    settings,
    reducedMotion,
  });
}

/** Derivation straight from the controller layers: parallel states (speaking + background agents + approval) stay intact. */
export function deriveVisualTargetsFromController(state: OrbControllerState, settings: OrbSettings, reducedMotion?: boolean): VisualTargets {
  const agentCount = state.status.activeAgentCount ?? 0;
  const machine = toMachineLayers(state.layers, agentCount);
  const status = state.status;
  const targets = composeVisualTargets({
    layers: machine.layers,
    flashSuccess: machine.flashSuccess,
    flags: attentionFlags(state.layers),
    progress: status.progress ?? null,
    progressMode: status.progressMode,
    audioLevel: Math.max(status.inputAudioLevel, status.outputAudioLevel),
    activeAgentCount: agentCount,
    settings,
    reducedMotion,
  });
  // An explicit override (debug panel, demos) names the exact mode the layers were built from.
  return state.overrideMode && state.overrideMode !== targets.mode ? { ...targets, mode: state.overrideMode } : targets;
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
  if (to === "error") return 140;
  if (from === "error") return 950;
  if (from === "offline") return 1300;
  if (to === "offline") return 700;
  if (from === "booting") return 1800;
  if (from === "idle" && to === "listening") return 170;
  if (from === "listening" && to === "transcribing") return 240;
  if (from === "transcribing" && to === "thinking") return 300;
  if (from === "thinking" && to === "working") return 380;
  if (from === "working" && to === "speaking") return 250;
  if (from === "speaking" && to === "idle") return 480;
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
