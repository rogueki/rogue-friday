import { AdditiveBlending, DoubleSide, ShaderMaterial, Vector2, Vector3, Vector4, type IUniform } from "three";
import type { LiveParams } from "./liveParams";
import { lineFragmentShader, lineVertexShader } from "./shaders/line";
import { plateFragmentShader, plateVertexShader } from "./shaders/plate";
import { pointsFragmentShader, pointsVertexShader } from "./shaders/points";
import { spriteFragmentShader, spriteVertexShader } from "./shaders/sprite";
import { coreNoiseFragmentShader, sweepFragmentShader, voiceFragmentShader } from "./shaders/voice";
import { glyphFragmentShader, shellFragmentShader, shellVertexShader } from "./shaders/shell";
import {
  coreGlowFragmentShader,
  coreSphereFragmentShader,
  coreSphereVertexShader,
  coronaFragmentShader,
  glowVertexShader,
  sphereGlowFragmentShader,
} from "./shaders/glow";
import type { QualityProfile } from "../settings";

type U<T> = IUniform<T>;

/** Uniforms shared (by reference) between every orb material; written once per frame by `syncSharedUniforms`. */
export interface SharedUniforms {
  uTime: U<number>;
  uViewport: U<Vector2>;
  uPixelRatio: U<number>;
  uEmission: U<number>;
  uSaturation: U<number>;
  uAccent: U<Vector3>;
  uAccentMix: U<number>;
  uFlowSpeed: U<number>;
  uFlowDensity: U<number>;
  uRadialOffset: U<number>;
  uShellActivity: U<number>;
  uAlign: U<number>;
  uFracture: U<number>;
  uImpulse: U<number>;
  uReveal: U<number>;
  uConverge: U<number>;
  uAudio: U<number>;
  uBackFade: U<number>;
  uCircuitSeq: U<number>;
  uPeakKick: U<number>;
  uForce: U<number>;
  uInward: U<number>;
  uSegDrive: U<number>;
  uCalm: U<number>;
  uBands: U<Vector4>;
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uViewport: { value: new Vector2(640, 480) },
    uPixelRatio: { value: 1 },
    uEmission: { value: 1 },
    uSaturation: { value: 1 },
    uAccent: { value: new Vector3(1, 0.7, 0.2) },
    uAccentMix: { value: 0 },
    uFlowSpeed: { value: 0.1 },
    uFlowDensity: { value: 0.1 },
    uRadialOffset: { value: 0 },
    uShellActivity: { value: 0 },
    uAlign: { value: 0 },
    uFracture: { value: 0 },
    uImpulse: { value: 0 },
    uReveal: { value: 1 },
    uConverge: { value: 0 },
    uAudio: { value: 0 },
    uBackFade: { value: 0.2 },
    uCircuitSeq: { value: 0 },
    uPeakKick: { value: 0 },
    uForce: { value: 0 },
    uInward: { value: 0 },
    uSegDrive: { value: 0 },
    uCalm: { value: 0 },
    uBands: { value: new Vector4(0, 0, 0, 0) },
  };
}

export function syncSharedUniforms(
  u: SharedUniforms,
  live: LiveParams,
  viewport: { width: number; height: number; pixelRatio: number },
): void {
  u.uTime.value = live.time;
  u.uViewport.value.set(viewport.width * viewport.pixelRatio, viewport.height * viewport.pixelRatio);
  u.uPixelRatio.value = viewport.pixelRatio;
  u.uEmission.value = live.emission * (1 + live.successPulse * 0.6);
  u.uSaturation.value = live.saturation;
  u.uAccent.value.set(live.accent[0], live.accent[1], live.accent[2]);
  u.uAccentMix.value = live.accentMix + live.successPulse * 0.2;
  u.uFlowSpeed.value = live.flowSpeed;
  u.uFlowDensity.value = live.packetRate;
  u.uRadialOffset.value = live.radialOffset;
  u.uShellActivity.value = live.shellActivity;
  u.uAlign.value = live.align;
  u.uFracture.value = live.fracture;
  u.uImpulse.value = live.errorImpulse;
  u.uReveal.value = live.reveal;
  u.uConverge.value = live.convergence;
  u.uAudio.value = live.audio;
  u.uCircuitSeq.value = live.circuitSeq;
  u.uPeakKick.value = live.peakKick;
  u.uForce.value = live.particleForce * live.particleDrive;
  u.uInward.value = live.particleInward;
  u.uSegDrive.value = live.segDrive;
  u.uCalm.value = live.calm;
  // bands of the open channel (the other one is gated to zero): low / mid / high / rms
  u.uBands.value.set(Math.max(live.inLow, live.outLow), Math.max(live.inMid, live.outMid), Math.max(live.inHigh, live.outHigh), live.audio);
}

function baseMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, IUniform>, defines?: Record<string, string>) {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    defines: defines ?? {},
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

export type LineRole =
  | "MID"
  | "OUTER"
  | "REACTOR"
  | "RING"
  | "TELEMETRY"
  | "PROGRESS"
  | "SEGRING"
  | "ARCS"
  | "FRACTURE"
  | "OVERLAY"
  | "SCAN";

export interface LineMaterialOptions {
  width?: number;
  opacity?: number;
  base?: number;
  revealStart?: number;
  flowAmount?: number;
  tint?: [number, number, number];
  tintMix?: number;
}

export function makeLineMaterial(role: LineRole, shared: SharedUniforms, o: LineMaterialOptions = {}): ShaderMaterial {
  return baseMaterial(
    lineVertexShader,
    lineFragmentShader,
    {
      ...shared,
      uWidth: { value: o.width ?? 1.2 },
      uOpacity: { value: o.opacity ?? 1 },
      uBase: { value: o.base ?? 0.6 },
      uRevealStart: { value: o.revealStart ?? 0 },
      uFlowAmount: { value: o.flowAmount ?? 1 },
      uTint: { value: new Vector3(...(o.tint ?? [1, 0.7, 0.2])) },
      uTintMix: { value: o.tintMix ?? 0 },
      uLevel: { value: 0 },
      uProgress: { value: 0 },
      uProgressMode: { value: 0 },
      uGap: { value: 0.05 },
      uPulseHead: { value: -1 },
      uPulseAmp: { value: 0 },
      uDual: { value: 0 },
      uPulseTint: { value: new Vector3(1, 0.85, 0.5) },
    },
    { [`ROLE_${role}`]: "" },
  );
}

export function makePlateMaterial(shared: SharedUniforms, o: { base?: number; revealStart?: number } = {}): ShaderMaterial {
  return baseMaterial(plateVertexShader, plateFragmentShader, {
    ...shared,
    uOpacity: { value: 1 },
    uBase: { value: o.base ?? 0.62 },
    uRevealStart: { value: o.revealStart ?? 0.15 },
  });
}

export function makeSpriteMaterial(shared: SharedUniforms, o: { base?: number; revealStart?: number } = {}): ShaderMaterial {
  return baseMaterial(spriteVertexShader, spriteFragmentShader, {
    ...shared,
    uOpacity: { value: 1 },
    uBase: { value: o.base ?? 0.6 },
    uRevealStart: { value: o.revealStart ?? 0.1 },
    uNodeBoost: { value: 0 },
  });
}

export type PointsRole = "PARTICLES" | "ENERGY" | "DUST" | "PACKETS" | "MARKERS";

export function makePointsMaterial(role: PointsRole, shared: SharedUniforms, o: { base?: number; size?: number } = {}): ShaderMaterial {
  return baseMaterial(
    pointsVertexShader,
    pointsFragmentShader,
    {
      ...shared,
      uOpacity: { value: 1 },
      uBase: { value: o.base ?? 0.7 },
      uSizeScale: { value: o.size ?? 1 },
      uPacketRate: { value: 0 },
      uAgents: { value: 0 },
      uMarkerLift: { value: 0 },
    },
    { [`ROLE_${role}`]: "" },
  );
}

export function makeCoreGlowMaterial(shared: SharedUniforms): ShaderMaterial {
  return baseMaterial(glowVertexShader, coreGlowFragmentShader, {
    ...shared,
    uCore: { value: 0.6 },
    uWhite: { value: 0.3 },
    uBreath: { value: 1 },
  });
}

export function makeCoronaMaterial(shared: SharedUniforms): ShaderMaterial {
  return baseMaterial(glowVertexShader, coronaFragmentShader, {
    ...shared,
    uCore: { value: 0.6 },
    uShell: { value: 1 },
    uThink: { value: 0 },
    uBreathU: { value: 0.5 },
    uDrive: { value: 0 },
  });
}

export type VoiceRingMode = "INPUT" | "OUTPUT" | "RADIAL" | "FOCUS" | "WARN";

/** Billboard ring material of the VoiceReactionGroup (+ approval focus and warning pulse). `half` = billboard half size in orb units. */
export function makeVoiceRingMaterial(mode: VoiceRingMode, shared: SharedUniforms, half: number): ShaderMaterial {
  return baseMaterial(
    glowVertexShader,
    voiceFragmentShader,
    {
      ...shared,
      uHalf: { value: half },
      uOpen: { value: 0 },
      uLevel: { value: 0 },
      uWaveBands: { value: new Vector4(0, 0, 0, 0) },
      uAmt: { value: 0 },
      uPulseAge: { value: new Float32Array(6).fill(-1) },
      uPulseAmp: { value: new Float32Array(6) },
    },
    { [`MODE_${mode}`]: "" },
  );
}

export type SweepMode = "RADIAL" | "ANALYSIS" | "SYNC";

export function makeSweepMaterial(mode: SweepMode, shared: SharedUniforms, half: number): ShaderMaterial {
  return baseMaterial(glowVertexShader, sweepFragmentShader, { ...shared, uHalf: { value: half }, uAmt: { value: 0 } }, { [`MODE_${mode}`]: "" });
}

export function makeCoreNoiseMaterial(shared: SharedUniforms): ShaderMaterial {
  return baseMaterial(glowVertexShader, coreNoiseFragmentShader, {
    ...shared,
    uNoise: { value: 0.3 },
    uCoreLevel: { value: 0.8 },
    uDrive: { value: 0 },
    uSwirl: { value: 0 },
  });
}

export function makeShellMaterial(shared: SharedUniforms, phase: number, lines: number): ShaderMaterial {
  return baseMaterial(shellVertexShader, shellFragmentShader, { ...shared, uShells: { value: 0.3 }, uPhase: { value: phase }, uLines: { value: lines } });
}

export function makeGlyphMaterial(shared: SharedUniforms): ShaderMaterial {
  return baseMaterial(glowVertexShader, glyphFragmentShader, { ...shared, uAmt: { value: 0 }, uPulse: { value: 0 } });
}

export function makeCoreSphereMaterial(shared: SharedUniforms): ShaderMaterial {
  return baseMaterial(coreSphereVertexShader, coreSphereFragmentShader, {
    ...shared,
    uCore: { value: 0.6 },
    uWhite: { value: 0.3 },
  });
}

/** Reference counts for the perf overlay (what the scene asked the GPU to draw). */
export interface SceneStats {
  segments: number;
  plates: number;
  points: number;
  nodes: number;
  profile: QualityProfile["level"];
}

export function makeSphereGlowMaterial(shared: SharedUniforms, spread = 2.4, amp = 0.12): ShaderMaterial {
  return baseMaterial(glowVertexShader, sphereGlowFragmentShader, { ...shared, uCore: { value: 0.6 }, uSpread: { value: spread }, uAmp: { value: amp } });
}
