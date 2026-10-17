import { AUDIO_MAPPING } from "../audio/audioMapping";
import { noise1 } from "../audio/frame";
import type { OrbAudioFrame } from "../controller/types";
import type { OrbMode } from "../contract-types";
import { transitionTimeConstants, type RGB, type TransitionTimes, type VisualTargets } from "../visual/deriveVisualTargets";

/** Independently animated scene groups (owner order section 4); each has its own drift generator. */
export const GROUP = {
  core: 0,
  innerA: 1,
  innerB: 2,
  circuit: 3,
  outerA: 4,
  outerB: 5,
  telemetry: 6,
  fragments: 7,
  particles: 8,
  shells: 9,
} as const;
export const GROUP_COUNT = 10;
/** Floats per group in `LiveParams.drift`: rotation x, y, z (rad) and a vertical offset (orb units). */
export const DRIFT_STRIDE = 4;

/** Data impulse targets: one per ring layer; the scheduler never lights all of them at the same time. */
export const PULSE_RINGS = 7;
export const RADIAL_POOL = 6;
const PULSE_SLOT_S = 1.1;
const PULSE_DURATION_S = 2.6;
const PULSE_POOL = 4;
/** Lifetime of an expanding radial pulse ring in seconds. */
export const RADIAL_LIFE_S = 1.5;

/**
 * Mutable per-frame state of the orb. Lives in a ref, is written exclusively by `stepLiveParams` (called from
 * `useFrame`) and read by the scene components. There is no React state involved on the frame path, and the step
 * itself allocates nothing.
 */
export interface LiveParams {
  time: number;
  mode: OrbMode;
  prevMode: OrbMode;
  tau: TransitionTimes;

  coreIntensity: number;
  coreWhite: number;
  breathPeriod: number;
  breathAmplitude: number;
  breathDepth: number;
  coreNoise: number;
  midSpeed: number;
  outerSpeed: number;
  ringSpeeds: [number, number, number, number, number];
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
  energyArcs: number;
  waveIn: number;
  waveOut: number;
  radialPulse: number;
  focus: number;
  warnPulse: number;
  particleInward: number;
  particleDrive: number;
  shells: number;
  saturation: number;
  emission: number;
  accent: [number, number, number];
  accentMix: number;
  align: number;
  fracture: number;
  progress: number;
  progressVisible: number;
  progressMode: number;
  approval: number;
  warning: number;
  error: number;
  outerReduce: number;
  telemetryGap: number;
  agentCount: number;
  reveal: number;
  bloomIntensity: number;
  parallax: number;
  gainIn: number;
  gainOut: number;
  calm: number;

  /** Audio of the active channel after gating (0..1): overall level, plus the bands of input and output. */
  audio: number;
  inRms: number;
  inPeak: number;
  inLow: number;
  inMid: number;
  inHigh: number;
  outRms: number;
  outPeak: number;
  outLow: number;
  outMid: number;
  outHigh: number;
  /** Derived audio drives (order section 14 mapping): core pulse, ring segments, particles, bloom, ring speed. */
  coreDrive: number;
  segDrive: number;
  particleForce: number;
  bloomBoost: number;
  speedMul: number;
  /** Decaying kick on audio peaks, 1 -> 0. */
  peakKick: number;
  /** Final core look for this frame (breath cycle + audio mapping). */
  coreScale: number;
  coreLevel: number;

  /** Entry impulses, 1 -> 0. */
  errorImpulse: number;
  successPulse: number;

  /** Integrated rotation angles (rad). Index: inner A, inner B, outer A, outer B, telemetry. */
  ringAngles: [number, number, number, number, number];
  midAngle: number;
  outerAngle: number;
  breathPhase: number;
  bootStart: number;

  /** Per-group irregular drift (`GROUP` x `DRIFT_STRIDE`), a pure function of time. */
  drift: Float32Array;
  /** Whole-orb micro motion (vertical offset and slow irregular rotation). */
  microY: number;
  microRotZ: number;
  /** Data impulse heads/amplitudes per ring layer (-1 = none). */
  pulseHead: Float32Array;
  pulseAmp: Float32Array;
  /** Expanding radial pulse rings: age 0..1 (-1 = free) and amplitude. */
  radialAge: Float32Array;
  radialAmp: Float32Array;

  // internal scheduler / detector state (not read by the scene)
  _pulsePool: Float32Array; // ring, start, amp per slot
  _lastSlot: number;
  _radialStart: Float32Array;
  _lastRadialAt: number;
  _prevPeakSig: number;
  _lastTime: number;
}

export function createLiveParams(initial: VisualTargets): LiveParams {
  const pool = new Float32Array(PULSE_POOL * 3);
  for (let i = 0; i < PULSE_POOL; i++) pool[i * 3 + 1] = -1e9;
  return {
    time: 0,
    mode: initial.mode,
    prevMode: initial.mode,
    tau: transitionTimeConstants("idle", initial.mode === "idle" ? "listening" : initial.mode),
    coreIntensity: initial.coreIntensity,
    coreWhite: initial.coreWhite,
    breathPeriod: initial.breathPeriod,
    breathAmplitude: initial.breathAmplitude,
    breathDepth: initial.breathDepth,
    coreNoise: initial.coreNoise,
    midSpeed: initial.midSpeed,
    outerSpeed: initial.outerSpeed,
    ringSpeeds: [...initial.ringSpeeds],
    shellActivity: initial.shellActivity,
    radialOffset: initial.radialOffset,
    packetRate: initial.packetRate,
    flowSpeed: initial.flowSpeed,
    convergence: initial.convergence,
    pulseRate: initial.pulseRate,
    scanPlane: initial.scanPlane,
    radialScan: initial.radialScan,
    analysisSweep: initial.analysisSweep,
    syncSweep: initial.syncSweep,
    circuitSeq: initial.circuitSeq,
    telemetryDual: initial.telemetryDual,
    energyArcs: initial.energyArcs,
    waveIn: initial.waveIn,
    waveOut: initial.waveOut,
    radialPulse: initial.radialPulse,
    focus: initial.focus,
    warnPulse: initial.warnPulse,
    particleInward: initial.particleInward,
    particleDrive: initial.particleDrive,
    shells: initial.shells,
    saturation: initial.saturation,
    emission: initial.emission,
    accent: [...initial.accentColor] as [number, number, number],
    accentMix: initial.accentMix,
    align: initial.align,
    fracture: initial.fracture,
    progress: initial.progress,
    progressVisible: initial.progressVisible,
    progressMode: progressModeValue(initial.progressMode),
    approval: initial.approval,
    warning: initial.warning,
    error: initial.error,
    outerReduce: initial.outerReduce,
    telemetryGap: initial.telemetryGap,
    agentCount: initial.agentCount,
    reveal: initial.mode === "booting" ? 0 : 1,
    bloomIntensity: initial.bloomIntensity,
    parallax: initial.parallax ? 1 : 0,
    gainIn: initial.audioGainIn,
    gainOut: initial.audioGainOut,
    calm: initial.calm,
    audio: 0,
    inRms: 0,
    inPeak: 0,
    inLow: 0,
    inMid: 0,
    inHigh: 0,
    outRms: 0,
    outPeak: 0,
    outLow: 0,
    outMid: 0,
    outHigh: 0,
    coreDrive: 0,
    segDrive: 0,
    particleForce: 0,
    bloomBoost: 0,
    speedMul: 1,
    peakKick: 0,
    coreScale: 1,
    coreLevel: initial.coreIntensity,
    errorImpulse: initial.mode === "error" ? 1 : 0,
    successPulse: initial.mode === "success" ? 1 : 0,
    ringAngles: [0.4, 1.1, 2.0, 0.7, 0],
    midAngle: 0,
    outerAngle: 0,
    breathPhase: 0,
    bootStart: 0,
    drift: new Float32Array(GROUP_COUNT * DRIFT_STRIDE),
    microY: 0,
    microRotZ: 0,
    pulseHead: new Float32Array(PULSE_RINGS).fill(-1),
    pulseAmp: new Float32Array(PULSE_RINGS),
    radialAge: new Float32Array(RADIAL_POOL).fill(-1),
    radialAmp: new Float32Array(RADIAL_POOL),
    _pulsePool: pool,
    _lastSlot: Number.NaN,
    _radialStart: new Float32Array(RADIAL_POOL).fill(-1e9),
    _lastRadialAt: -1e9,
    _prevPeakSig: 0,
    _lastTime: 0,
  };
}

function progressModeValue(m: VisualTargets["progressMode"]): number {
  return m === "determinate" ? 1 : m === "indeterminate" ? 2 : 0;
}

export interface StepOptions {
  dt: number;
  /** Absolute scene time (live: accumulated; test clock: the fixed time). */
  time: number;
  /**
   * Analysed frames of the controller (already smoothed). When absent, `audioRaw` (legacy single level, smoothed here)
   * is used for the channel that is currently open.
   */
  audioIn?: OrbAudioFrame;
  audioOut?: OrbAudioFrame;
  /** Raw legacy audio level already gated by `targets.audioGain` (0..1). */
  audioRaw?: number;
  /** Set when running on the deterministic test clock: no damping, angles are `speed * time`. */
  fixed?: { animationProgress?: number };
  /** Seed for the data-impulse scheduler. */
  seed?: number;
}

const damp = (current: number, target: number, tau: number, dt: number): number =>
  tau <= 1e-4 ? target : current + (target - current) * (1 - Math.exp(-dt / tau));

/** Time-based attack/release smoothing for the legacy single-level path (attack ~60 ms, release ~250 ms). */
function smoothAudio(current: number, target: number, dt: number): number {
  return damp(current, target, target > current ? 0.06 : 0.25, dt);
}

const BOOT_DURATION = 3.4;
const BOOT_HOLD = 0.93;

type NumericKey = Exclude<keyof VisualTargets & keyof LiveParams, "mode" | "ringSpeeds" | "ringAxes" | "accentColor" | "progressMode" | "parallax">;
const INTENSITY_KEYS: readonly NumericKey[] = [
  "coreIntensity", "coreWhite", "emission", "bloomIntensity", "shellActivity", "packetRate", "convergence", "energyArcs",
  "scanPlane", "radialScan", "analysisSweep", "syncSweep", "circuitSeq", "telemetryDual", "pulseRate", "shells", "coreNoise",
  "waveIn", "waveOut", "radialPulse", "particleInward", "particleDrive",
];
const MOTION_KEYS: readonly NumericKey[] = ["breathPeriod", "breathAmplitude", "breathDepth", "midSpeed", "outerSpeed", "flowSpeed"];
const COLOR_KEYS: readonly NumericKey[] = ["saturation", "accentMix"];
const OVERLAY_KEYS: readonly NumericKey[] = [
  "approval", "warning", "error", "fracture", "align", "radialOffset", "telemetryGap", "progressVisible", "focus", "warnPulse", "outerReduce", "calm",
];

const asRecord = (o: LiveParams | VisualTargets): Record<string, number> => o as unknown as Record<string, number>;

function dampKeys(live: LiveParams, t: VisualTargets, keys: readonly NumericKey[], tau: number, dt: number): void {
  const l = asRecord(live);
  const g = asRecord(t);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] as string;
    l[k] = damp(l[k] as number, g[k] as number, tau, dt);
  }
}

/** Per-ring speed wobble so no ring turns at a perfectly constant rate (kept inside the order's period ranges). */
const WOBBLE_AMP = 0.16;
const WOBBLE_W: readonly number[] = [0.23, 0.31, 0.17, 0.27, 0.21];
const WOBBLE_PHI: readonly number[] = [0.4, 2.1, 4.0, 1.2, 5.3];
const RING_PHASE: readonly number[] = [0.4, 1.1, 2.0, 0.7, 0];

/** Breath wave in -1..1: a sine with a softer second harmonic, so rise and fall are not symmetric. */
export function breathWave(phase: number): number {
  const w = (Math.sin(phase) + 0.2 * Math.sin(2 * phase + 1.3)) / 1.17;
  return w > 1 ? 1 : w < -1 ? -1 : w;
}

function hashSlot(k: number, seed: number, salt: number): number {
  const s = Math.sin((k + 1) * 12.9898 + seed * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** Deterministic, seedable impulse scheduler: at most a few pulses at once, consecutive pulses use different rings. */
function updatePulses(live: LiveParams, time: number, rate: number, seed: number, jump: boolean): void {
  const pool = live._pulsePool;
  const slot = Math.floor(time / PULSE_SLOT_S);
  const p = Math.min(0.95, rate * 0.9);
  const rescan = Number.isNaN(live._lastSlot) || jump || slot - live._lastSlot > 8;
  let from = rescan ? Math.floor((time - PULSE_DURATION_S) / PULSE_SLOT_S) : live._lastSlot + 1;
  if (from > slot) from = slot + 1;
  if (rescan) for (let i = 0; i < PULSE_POOL; i++) pool[i * 3 + 1] = -1e9; // a fresh window replaces the pool
  for (let k = from; k <= slot; k++) {
    if (hashSlot(k, seed, 1) >= p) continue;
    const ring = (((k * 3 + Math.floor(hashSlot(k, seed, 2) * 2)) % PULSE_RINGS) + PULSE_RINGS) % PULSE_RINGS;
    const start = k * PULSE_SLOT_S + hashSlot(k, seed, 3) * PULSE_SLOT_S * 0.8;
    // free slot = the oldest one
    let target = 0;
    for (let i = 1; i < PULSE_POOL; i++) if ((pool[i * 3 + 1] as number) < (pool[target * 3 + 1] as number)) target = i;
    pool[target * 3] = ring;
    pool[target * 3 + 1] = start;
    pool[target * 3 + 2] = 0.65 + 0.35 * hashSlot(k, seed, 4);
  }
  live._lastSlot = slot;
  live.pulseHead.fill(-1);
  live.pulseAmp.fill(0);
  for (let i = 0; i < PULSE_POOL; i++) {
    const start = pool[i * 3 + 1] as number;
    const prog = (time - start) / PULSE_DURATION_S;
    if (prog < 0 || prog > 1) continue;
    const ring = pool[i * 3] as number;
    if (prog >= 0 && (live.pulseHead[ring] as number) < 0) {
      live.pulseHead[ring] = prog;
      live.pulseAmp[ring] = Math.sin(Math.PI * prog) ** 0.6 * (pool[i * 3 + 2] as number);
    }
  }
}

/** Per-group irregular drift: slow value-noise rotations and a tiny vertical offset, each group with its own seed. */
function updateDrift(live: LiveParams, time: number, reduced: number): void {
  const d = live.drift;
  const k = 1 - 0.85 * reduced;
  for (let g = 0; g < GROUP_COUNT; g++) {
    const o = g * DRIFT_STRIDE;
    const amp = (g === GROUP.core ? 0.0 : g === GROUP.fragments || g === GROUP.particles ? 0.07 : 0.05) * k;
    d[o] = amp * (noise1(time * (0.043 + 0.011 * g) + g * 3.1, g) - 0.5) * 2;
    d[o + 1] = amp * (noise1(time * (0.037 + 0.009 * g) + g * 5.3, g + 11) - 0.5) * 2;
    d[o + 2] = amp * 1.4 * (noise1(time * (0.051 + 0.007 * g) + g * 7.7, g + 23) - 0.5) * 2;
    d[o + 3] = 0.012 * k * (noise1(time * (0.19 + 0.03 * g) + g * 2.9, g + 31) - 0.5) * 2;
  }
  live.microY = 0.014 * k * ((noise1(time * 0.17, 91) - 0.5) * 2 + 0.5 * Math.sin(time * 0.41));
  live.microRotZ = 0.03 * k * (noise1(time * 0.045, 92) - 0.5) * 2;
}

export function stepLiveParams(live: LiveParams, t: VisualTargets, opts: StepOptions): void {
  const { dt, time } = opts;
  if (t.mode !== live.mode) {
    live.prevMode = live.mode;
    live.tau = transitionTimeConstants(live.mode, t.mode);
    if (t.mode === "error") live.errorImpulse = 1;
    if (t.mode === "success") live.successPulse = 1;
    if (t.mode === "booting") live.bootStart = time;
    live.mode = t.mode;
  }

  const fixed = opts.fixed;
  const k = (group: number) => (fixed ? 0 : group);
  const { intensity: tauI, motion: tauM, color: tauC, overlay: tauO } = live.tau;
  const ti = k(tauI);
  const tm = k(tauM);
  const tc = k(tauC);
  const to = k(tauO);

  live.time = time;
  dampKeys(live, t, INTENSITY_KEYS, ti, dt);
  live.agentCount = damp(live.agentCount, t.agentCount, Math.min(ti, 0.25) || 0, dt);
  dampKeys(live, t, MOTION_KEYS, tm, dt);
  for (let i = 0; i < 5; i++) live.ringSpeeds[i] = damp(live.ringSpeeds[i] as number, t.ringSpeeds[i] as number, tm, dt);
  dampKeys(live, t, COLOR_KEYS, tc, dt);
  live.accentMix = damp(live.accentMix, t.accentMix, tc, dt);
  const ac: RGB = t.accentColor;
  for (let i = 0; i < 3; i++) live.accent[i] = damp(live.accent[i] as number, ac[i] as number, tc, dt);
  dampKeys(live, t, OVERLAY_KEYS, to, dt);
  live.parallax = damp(live.parallax, t.parallax ? 1 : 0, 0.35, dt);
  live.progress = fixed ? t.progress : damp(live.progress, t.progress, 0.22, dt);
  live.progressMode = progressModeValue(t.progressMode);
  // audio gates: the microphone only drives listening, TTS only speaking; they cross-fade with the mode change
  live.gainIn = damp(live.gainIn, t.audioGainIn, tc * 0.6 + (fixed ? 0 : 0.02), dt);
  live.gainOut = damp(live.gainOut, t.audioGainOut, tc * 0.6 + (fixed ? 0 : 0.02), dt);
  if (fixed) {
    live.gainIn = t.audioGainIn;
    live.gainOut = t.audioGainOut;
  }

  // Entry impulses and the boot reveal.
  if (fixed) {
    const ap = fixed.animationProgress;
    live.errorImpulse = t.mode === "error" ? (ap === undefined ? 0.3 : 1 - ap) : 0;
    live.successPulse = t.mode === "success" ? (ap === undefined ? 0.5 : 1 - ap) : 0;
    live.reveal = t.mode === "booting" ? (ap ?? 0.65) : 1;
  } else {
    live.errorImpulse *= Math.exp(-dt / 0.45);
    live.successPulse *= Math.exp(-dt / 0.55);
    if (t.mode === "booting") {
      const p = Math.min(1, (time - live.bootStart) / BOOT_DURATION);
      live.reveal = Math.min(BOOT_HOLD, p * p * (3 - 2 * p) * BOOT_HOLD);
    } else {
      live.reveal = damp(live.reveal, 1, 0.55, dt);
    }
  }

  stepAudio(live, t, opts);

  // Rotation and breath phase: integrated (live) or a pure function of the fixed time (test clock).
  const speedMul = live.speedMul;
  if (fixed) {
    for (let i = 0; i < 5; i++) {
      const w = WOBBLE_W[i] as number;
      const phi = WOBBLE_PHI[i] as number;
      const wob = (WOBBLE_AMP / w) * (Math.cos(phi) - Math.cos(w * time + phi));
      live.ringAngles[i] = (live.ringSpeeds[i] as number) * (time + wob) + (RING_PHASE[i] as number);
    }
    live.midAngle = live.midSpeed * time;
    live.outerAngle = live.outerSpeed * time;
    live.breathPhase = (time / live.breathPeriod) * Math.PI * 2;
  } else {
    for (let i = 0; i < 5; i++) {
      const wobble = 1 + WOBBLE_AMP * Math.sin((WOBBLE_W[i] as number) * time + (WOBBLE_PHI[i] as number));
      // audio makes the inner rings run faster; outer rings only follow weakly (controlled, order section 9)
      const boost = i < 2 ? speedMul : 1 + (speedMul - 1) * 0.35;
      live.ringAngles[i] = (live.ringAngles[i] as number) + (live.ringSpeeds[i] as number) * wobble * boost * dt;
    }
    live.midAngle += live.midSpeed * dt;
    live.outerAngle += live.outerSpeed * dt;
    const periodNow = live.breathPeriod * (1 + 0.12 * Math.sin(time * 0.083 + 1.7));
    live.breathPhase += (dt / Math.max(0.5, periodNow)) * Math.PI * 2;
  }

  // Core look: breath cycle (scale 0.97..1.035, brightness 72..100 % in idle) plus the bounded audio mapping.
  const wave = breathWave(live.breathPhase);
  const u = 0.5 + 0.5 * wave;
  const calmK = 1 - live.calm;
  const drive = live.coreDrive * calmK;
  live.coreScale = 1.0025 + live.breathAmplitude * wave + AUDIO_MAPPING.coreScale * drive + 0.025 * live.peakKick * calmK;
  const bright = 1 - live.breathDepth * (1 - u);
  const baseLevel = live.coreIntensity * bright * (1 + live.successPulse * 0.5);
  live.coreLevel = Math.min(AUDIO_MAPPING.coreIntensityMax, baseLevel + AUDIO_MAPPING.coreIntensity * 0.55 * drive + 0.25 * live.peakKick * calmK);

  updatePulses(live, time, live.pulseRate, opts.seed ?? 7, fixed !== undefined);
  updateDrift(live, time, live.calm > 0.5 || t.motionScale < 0.5 ? 1 : 0);
  live._lastTime = time;
}

/** Gates the analysed frames per direction, derives the audio drives and detects peaks for the radial pulse rings. */
function stepAudio(live: LiveParams, t: VisualTargets, opts: StepOptions): void {
  const { dt, time } = opts;
  const gi = live.gainIn;
  const go = live.gainOut;
  const inF = opts.audioIn;
  const outF = opts.audioOut;
  if (inF || outF) {
    if (inF) {
      live.inRms = inF.rms * gi;
      live.inPeak = inF.peak * gi;
      live.inLow = inF.low * gi;
      live.inMid = inF.mid * gi;
      live.inHigh = inF.high * gi;
    }
    if (outF) {
      live.outRms = outF.rms * go;
      live.outPeak = outF.peak * go;
      live.outLow = outF.low * go;
      live.outMid = outF.mid * go;
      live.outHigh = outF.high * go;
    }
  } else {
    // legacy single level: smoothed here, spread over plausible bands for the channel that is currently open
    const raw = opts.audioRaw ?? 0;
    const target = opts.fixed ? raw : raw;
    const listening = t.audioGainIn > 0;
    const inT = listening ? target : 0;
    const outT = listening ? 0 : target;
    const f = opts.fixed ? 1 : 0;
    live.inRms = f ? inT : smoothAudio(live.inRms, inT, dt);
    live.outRms = f ? outT : smoothAudio(live.outRms, outT, dt);
    live.inPeak = live.inRms;
    live.outPeak = live.outRms;
    live.inLow = live.inRms;
    live.inMid = live.inRms * 0.82;
    live.inHigh = live.inRms * 0.55;
    live.outLow = live.outRms;
    live.outMid = live.outRms * 0.82;
    live.outHigh = live.outRms * 0.55;
  }
  const speaking = go >= gi;
  live.audio = Math.max(live.inRms, live.outRms);
  // Mapping (order sections 9 and 14): listening follows the level; speaking splits into bands.
  const inDrive = live.inRms * 0.7 + live.inLow * 0.3;
  const outDrive = live.outLow * 0.65 + live.outRms * 0.35;
  live.coreDrive = Math.min(1, inDrive * gi + outDrive * go);
  live.segDrive = Math.min(1, (speaking ? live.outMid : live.inRms) * (speaking ? go : gi));
  live.particleForce = Math.min(1, (speaking ? live.outHigh * 0.7 + live.outPeak * 0.3 : live.inPeak * 0.6 + live.inHigh * 0.4) * AUDIO_MAPPING.particleForce);
  live.bloomBoost = Math.min(1, live.audio);
  live.speedMul = 1 + AUDIO_MAPPING.ringSpeed * Math.min(1, live.audio) * (1 - live.calm);

  // peak detection -> radial pulse rings + kick (rate limited)
  const sig = Math.max(live.inPeak, live.outPeak);
  if (!opts.fixed) {
    live.peakKick *= Math.exp(-dt / 0.18);
    const m = AUDIO_MAPPING;
    if (live.radialPulse > 0.05 && sig > m.peakThreshold && sig - live._prevPeakSig > m.peakRise && time - live._lastRadialAt > m.peakMinGapSec) {
      live._lastRadialAt = time;
      live.peakKick = Math.max(live.peakKick, sig);
      let slot = 0;
      for (let i = 1; i < RADIAL_POOL; i++) if ((live._radialStart[i] as number) < (live._radialStart[slot] as number)) slot = i;
      live._radialStart[slot] = time;
      live.radialAmp[slot] = Math.min(1, sig) * live.radialPulse;
    }
  } else {
    live.peakKick = 0;
  }
  live._prevPeakSig = sig;
  for (let i = 0; i < RADIAL_POOL; i++) {
    const age = (time - (live._radialStart[i] as number)) / RADIAL_LIFE_S;
    live.radialAge[i] = age >= 0 && age <= 1 ? age : -1;
  }
}

/** Core scale of this frame (breath cycle + audio). */
export function breathScale(live: LiveParams): number {
  return live.coreScale;
}
