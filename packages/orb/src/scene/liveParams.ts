import type { OrbMode } from "../contract-types";
import { transitionTimeConstants, type RGB, type TransitionTimes, type VisualTargets } from "../visual/deriveVisualTargets";

/**
 * Mutable per-frame state of the orb. Lives in a ref, is written exclusively by `stepLiveParams` (called from
 * `useFrame`) and read by the scene components. There is no React state involved on the frame path.
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
  gyroCounter: number;
  innerSpeed: number;
  midSpeed: number;
  outerSpeed: number;
  ringSpeeds: [number, number, number, number, number];
  shellActivity: number;
  radialOffset: number;
  packetRate: number;
  flowSpeed: number;
  convergence: number;
  scanPlane: number;
  energyArcs: number;
  haloLevel: number;
  haloCyan: number;
  haloFreeze: number;
  speakWaves: number;
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
  telemetryGap: number;
  agentCount: number;
  reveal: number;
  bloomIntensity: number;
  audio: number;
  parallax: number;

  /** Entry impulses, 1 -> 0. */
  errorImpulse: number;
  successPulse: number;

  /** Integrated rotation angles (rad). */
  ringAngles: [number, number, number, number, number];
  gyroBAngle: number;
  innerAngle: number;
  midAngle: number;
  outerAngle: number;
  breathPhase: number;
  bootStart: number;
}

export function createLiveParams(initial: VisualTargets): LiveParams {
  return {
    time: 0,
    mode: initial.mode,
    prevMode: initial.mode,
    tau: transitionTimeConstants("idle", initial.mode === "idle" ? "listening" : initial.mode),
    coreIntensity: initial.coreIntensity,
    coreWhite: initial.coreWhite,
    breathPeriod: initial.breathPeriod,
    breathAmplitude: initial.breathAmplitude,
    gyroCounter: initial.gyroCounter,
    innerSpeed: initial.innerSpeed,
    midSpeed: initial.midSpeed,
    outerSpeed: initial.outerSpeed,
    ringSpeeds: [...initial.ringSpeeds],
    shellActivity: initial.shellActivity,
    radialOffset: initial.radialOffset,
    packetRate: initial.packetRate,
    flowSpeed: initial.flowSpeed,
    convergence: initial.convergence,
    scanPlane: initial.scanPlane,
    energyArcs: initial.energyArcs,
    haloLevel: initial.haloLevel,
    haloCyan: initial.haloCyan,
    haloFreeze: initial.haloFreeze,
    speakWaves: initial.speakWaves,
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
    telemetryGap: initial.telemetryGap,
    agentCount: initial.agentCount,
    reveal: initial.mode === "booting" ? 0 : 1,
    bloomIntensity: initial.bloomIntensity,
    audio: 0,
    parallax: initial.parallax ? 1 : 0,
    errorImpulse: initial.mode === "error" ? 1 : 0,
    successPulse: initial.mode === "success" ? 1 : 0,
    ringAngles: [0.4, 1.1, 2.0, 0.7, 0],
    gyroBAngle: 1.3,
    innerAngle: 0,
    midAngle: 0,
    outerAngle: 0,
    breathPhase: 0,
    bootStart: 0,
  };
}

function progressModeValue(m: VisualTargets["progressMode"]): number {
  return m === "determinate" ? 1 : m === "indeterminate" ? 2 : 0;
}

export interface StepOptions {
  dt: number;
  /** Absolute scene time (live: accumulated; test clock: the fixed time). */
  time: number;
  /** Raw audio level already gated by `targets.audioGain` (0..1). */
  audioRaw: number;
  /** Set when running on the deterministic test clock: no damping, angles are `speed * time`. */
  fixed?: { animationProgress?: number };
}

const damp = (current: number, target: number, tau: number, dt: number): number =>
  tau <= 1e-4 ? target : current + (target - current) * (1 - Math.exp(-dt / tau));

/** Time-based attack/release smoothing for the audio halo (attack ~60 ms, release ~250 ms). */
function smoothAudio(current: number, target: number, dt: number): number {
  return damp(current, target, target > current ? 0.06 : 0.25, dt);
}

const BOOT_DURATION = 3.4;
const BOOT_HOLD = 0.93;

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
  live.coreIntensity = damp(live.coreIntensity, t.coreIntensity, ti, dt);
  live.coreWhite = damp(live.coreWhite, t.coreWhite, ti, dt);
  live.haloLevel = damp(live.haloLevel, t.haloLevel, ti, dt);
  live.emission = damp(live.emission, t.emission, ti, dt);
  live.bloomIntensity = damp(live.bloomIntensity, t.bloomIntensity, ti, dt);
  live.shellActivity = damp(live.shellActivity, t.shellActivity, ti, dt);
  live.packetRate = damp(live.packetRate, t.packetRate, ti, dt);
  live.convergence = damp(live.convergence, t.convergence, ti, dt);
  live.energyArcs = damp(live.energyArcs, t.energyArcs, ti, dt);
  live.speakWaves = damp(live.speakWaves, t.speakWaves, ti, dt);
  live.scanPlane = damp(live.scanPlane, t.scanPlane, ti, dt);
  live.agentCount = damp(live.agentCount, t.agentCount, Math.min(ti, 0.25) || 0, dt);

  live.breathPeriod = damp(live.breathPeriod, t.breathPeriod, tm, dt);
  live.breathAmplitude = damp(live.breathAmplitude, t.breathAmplitude, tm, dt);
  live.gyroCounter = damp(live.gyroCounter, t.gyroCounter, tm, dt);
  live.innerSpeed = damp(live.innerSpeed, t.innerSpeed, tm, dt);
  live.midSpeed = damp(live.midSpeed, t.midSpeed, tm, dt);
  live.outerSpeed = damp(live.outerSpeed, t.outerSpeed, tm, dt);
  live.flowSpeed = damp(live.flowSpeed, t.flowSpeed, tm, dt);
  for (let i = 0; i < 5; i++) {
    live.ringSpeeds[i] = damp(live.ringSpeeds[i] as number, t.ringSpeeds[i] as number, tm, dt);
  }

  live.saturation = damp(live.saturation, t.saturation, tc, dt);
  live.accentMix = damp(live.accentMix, t.accentMix, tc, dt);
  live.haloCyan = damp(live.haloCyan, t.haloCyan, tc, dt);
  const ac: RGB = t.accentColor;
  for (let i = 0; i < 3; i++) live.accent[i] = damp(live.accent[i] as number, ac[i] as number, tc, dt);

  live.approval = damp(live.approval, t.approval, to, dt);
  live.warning = damp(live.warning, t.warning, to, dt);
  live.error = damp(live.error, t.error, to, dt);
  live.fracture = damp(live.fracture, t.fracture, to, dt);
  live.align = damp(live.align, t.align, to, dt);
  live.haloFreeze = damp(live.haloFreeze, t.haloFreeze, to, dt);
  live.radialOffset = damp(live.radialOffset, t.radialOffset, to, dt);
  live.telemetryGap = damp(live.telemetryGap, t.telemetryGap, to, dt);
  live.progressVisible = damp(live.progressVisible, t.progressVisible, to, dt);
  live.parallax = damp(live.parallax, t.parallax ? 1 : 0, 0.35, dt);
  live.progress = fixed ? t.progress : damp(live.progress, t.progress, 0.22, dt);
  live.progressMode = progressModeValue(t.progressMode);

  // Entry impulses and the boot reveal.
  if (fixed) {
    const ap = fixed.animationProgress;
    live.errorImpulse = t.mode === "error" ? (ap === undefined ? 0.3 : 1 - ap) : 0;
    live.successPulse = t.mode === "success" ? (ap === undefined ? 0.5 : 1 - ap) : 0;
    live.reveal = t.mode === "booting" ? (ap ?? 0.65) : 1;
    live.audio = opts.audioRaw;
  } else {
    live.errorImpulse *= Math.exp(-dt / 0.45);
    live.successPulse *= Math.exp(-dt / 0.55);
    if (t.mode === "booting") {
      const p = Math.min(1, (time - live.bootStart) / BOOT_DURATION);
      live.reveal = Math.min(BOOT_HOLD, p * p * (3 - 2 * p) * BOOT_HOLD);
    } else {
      live.reveal = damp(live.reveal, 1, 0.55, dt);
    }
    live.audio = smoothAudio(live.audio, opts.audioRaw, dt);
  }

  // Rotation and breath phase: integrated (live) or a pure function of the fixed time (test clock).
  if (fixed) {
    for (let i = 0; i < 5; i++) live.ringAngles[i] = (live.ringSpeeds[i] as number) * time + RING_PHASE[i]!;
    live.gyroBAngle = (live.ringSpeeds[1] as number) * live.gyroCounter * time + 1.3;
    live.innerAngle = live.innerSpeed * time;
    live.midAngle = live.midSpeed * time;
    live.outerAngle = live.outerSpeed * time;
    live.breathPhase = (time / live.breathPeriod) * Math.PI * 2;
  } else {
    for (let i = 0; i < 5; i++) live.ringAngles[i] = (live.ringAngles[i] as number) + (live.ringSpeeds[i] as number) * dt;
    live.gyroBAngle += (live.ringSpeeds[1] as number) * live.gyroCounter * dt;
    live.innerAngle += live.innerSpeed * dt;
    live.midAngle += live.midSpeed * dt;
    live.outerAngle += live.outerSpeed * dt;
    live.breathPhase += (dt / live.breathPeriod) * Math.PI * 2;
  }
}

const RING_PHASE: readonly number[] = [0.4, 1.1, 2.0, 0.7, 0];

export function breathScale(live: LiveParams): number {
  return 1 + live.breathAmplitude * Math.sin(live.breathPhase);
}
