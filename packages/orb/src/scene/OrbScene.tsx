import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import type { Group } from "three";
import { AUDIO_MAPPING } from "../audio/audioMapping";
import { createInputs } from "../audio/frame";
import { audioFixtureLevel } from "../audio/fixtures";
import type { OrbFrameInputs } from "../controller/types";
import { getQualityProfile, type OrbQualityLevel, type OrbSettings } from "../settings";
import type { VisualTargets } from "../visual/deriveVisualTargets";
import { AdaptiveQuality } from "./adaptiveQuality";
import { HolographicShells, MidCircuitSphere, OuterFragmentShell, usePlateSets } from "./components/circuit";
import { CoreEnergyNoise, CoreLens, CorePulseShell, SphereGlow, WhiteHotCore } from "./components/core";
import { OrbCameraRig } from "./components/OrbCameraRig";
import { ApprovalGlyph, ApprovalOverlay, ErrorFractureOverlay, WarningOverlay } from "./components/overlays";
import {
  InnerGyroRings,
  InnerReactor,
  PrimaryOrbitalRing,
  ProgressOrbit,
  SecondaryTiltedRing,
  SegmentedRing,
  TelemetryRing,
} from "./components/rings";
import {
  AgentMarkers,
  AmbientParticles,
  DataPackets,
  DepthDust,
  EnergyArcs,
  EnergyParticles,
  ScanPlane,
} from "./components/signals";
import { ScanSweeps, VoiceReactionGroup } from "./components/voice";
import { resolveAudioLevel, type OrbAudioSourceRef } from "../audio/audioSource";
import { createLiveParams, DRIFT_STRIDE, GROUP, stepLiveParams, type LiveParams } from "./liveParams";
import { createSharedUniforms, syncSharedUniforms } from "./materials";
import { OrbSceneContext, useOrb, type OrbFit, type OrbSceneContextValue } from "./OrbContext";
import { sceneStats } from "./stats";

export interface OrbDebugProbe {
  frames: number;
  /** Rolling frame times in ms (wall clock), newest last. */
  frameTimes: number[];
  avgFrameMs: number;
  p95FrameMs: number;
  quality: OrbQualityLevel;
  draws: number;
  triangles: number;
  geometries: number;
  textures: number;
  segments: number;
  /** Draw-size counters of the layers (what the current quality level asks the GPU to draw). */
  plates: number;
  nodes: number;
  points: number;
  /** Test clock currently applied by the frame loop (`fixedTime|animationProgress|audioFixture`), empty on the live clock. */
  testClock: string;
  /** Nominal visible orb box in canvas CSS pixels (outer rings included; glow, dust and particles may exceed it). */
  bboxPx?: { x: number; y: number; w: number; h: number };
  canvasPx?: { w: number; h: number };
  /** Independent motion phases per group: inner A/B, outer A/B, telemetry ring angles, breath phase, mid/outer shell angle. */
  groupPhases?: { rings: number[]; breath: number; mid: number; outer: number; drift: number[] };
  /** Active audio source of the current frame ("none" | "analyser" | "service-level" | "synthetic"), the gates and levels. */
  audioSource?: { input: string; output: string; envelope: boolean; gateIn: number; gateOut: number; inRms: number; outRms: number };
  /** Mode the scene currently renders. */
  mode?: string;
}

declare global {
  interface Window {
    __ORB_DEBUG__?: OrbDebugProbe;
  }
}

export interface OrbSceneProps {
  targetsRef: MutableRefObject<VisualTargets>;
  /** Live audio level reader, polled inside `useFrame` (optional). */
  audioSourceRef?: OrbAudioSourceRef;
  settings: OrbSettings;
  quality: OrbQualityLevel;
  /** Auto quality: adapt by measured frame time and report level changes. */
  adaptive: boolean;
  onQualityChange?: (level: OrbQualityLevel) => void;
  /** Controller frame reader (analysed audio frames); omit for the legacy level reader path. */
  readFrames?: (nowMs: number, inputs: OrbFrameInputs) => void;
  /** Fraction of the usable panel height covered by the nominal visible orb (default 0.72). */
  fillRatio?: number;
  /** Seed of the deterministic data-impulse scheduler. */
  seed?: number;
}

const MAX_SAMPLES = 240;

/** Per-frame driver: clock, audio frames, damping towards the targets, shared uniforms, perf probe, adaptive quality. */
function FrameDriver({ adaptive, onQualityChange, quality, seed }: { adaptive: boolean; onQualityChange?: (l: OrbQualityLevel) => void; quality: OrbQualityLevel; seed?: number }) {
  const ctx = useOrb();
  const clock = useRef(0);
  const scaler = useRef<AdaptiveQuality | null>(null);
  const lastWall = useRef(performance.now());
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    scaler.current = new AdaptiveQuality(quality);
  }, [quality]);

  useEffect(() => {
    window.__ORB_DEBUG__ = {
      frames: 0, frameTimes: [], avgFrameMs: 0, p95FrameMs: 0, quality, draws: 0, triangles: 0, geometries: 0, textures: 0, segments: 0, plates: 0, nodes: 0, points: 0, testClock: "",
      groupPhases: { rings: [0, 0, 0, 0, 0], breath: 0, mid: 0, outer: 0, drift: new Array<number>(10).fill(0) },
      audioSource: { input: "none", output: "none", envelope: false, gateIn: 0, gateOut: 0, inRms: 0, outRms: 0 },
      bboxPx: { x: 0, y: 0, w: 0, h: 0 },
      canvasPx: { w: 0, h: 0 },
      mode: "",
    };
    return () => {
      delete window.__ORB_DEBUG__;
    };
  }, [quality]);

  useFrame((state, delta) => {
    const now = performance.now();
    const wallMs = now - lastWall.current;
    // Draw-call stats accumulate over the whole frame (composer passes included); read the finished frame, then reset.
    gl.info.autoReset = false;
    const frameCalls = gl.info.render.calls;
    const frameTriangles = gl.info.render.triangles;
    gl.info.reset();
    lastWall.current = now;

    const { settings, live, targets, shared, inputs } = ctx;
    const dt = Math.min(delta, 0.1);
    const fixedTime = settings.testClock?.fixedTime;
    let time: number;
    if (fixedTime !== undefined) {
      time = fixedTime;
    } else {
      clock.current += dt;
      time = clock.current;
    }
    const t = targets.current;
    const fixture = settings.audioFixture;
    if (ctx.readFrames && !fixture) {
      ctx.readFrames(now, inputs);
      stepLiveParams(live.current, t, {
        dt,
        time,
        audioIn: inputs.input,
        audioOut: inputs.output,
        fixed: fixedTime !== undefined ? { animationProgress: settings.testClock?.animationProgress } : undefined,
        seed,
      });
    } else {
      const rawAudio = t.audioGain > 0 ? (fixture ? audioFixtureLevel(fixture, time) : resolveAudioLevel(ctx.audioSource, t.audioLevel)) : 0;
      stepLiveParams(live.current, t, {
        dt,
        time,
        audioRaw: rawAudio,
        fixed: fixedTime !== undefined ? { animationProgress: settings.testClock?.animationProgress } : undefined,
        seed,
      });
    }
    syncSharedUniforms(shared, live.current, { width: state.size.width, height: state.size.height, pixelRatio: gl.getPixelRatio() });

    const probe = window.__ORB_DEBUG__;
    if (probe) {
      probe.testClock = fixedTime === undefined ? "" : `${fixedTime}|${settings.testClock?.animationProgress ?? ""}|${settings.audioFixture ?? ""}`;
      probe.frames += 1;
      if (probe.frames > 3) {
        probe.frameTimes.push(wallMs);
        if (probe.frameTimes.length > MAX_SAMPLES) probe.frameTimes.shift();
      }
      const l = live.current;
      const phases = probe.groupPhases;
      if (phases) {
        for (let i = 0; i < 5; i++) phases.rings[i] = l.ringAngles[i] as number;
        phases.breath = l.breathPhase;
        phases.mid = l.midAngle;
        phases.outer = l.outerAngle;
        for (let i = 0; i < 10; i++) phases.drift[i] = l.drift[i * DRIFT_STRIDE + 2] as number;
      }
      const src = probe.audioSource;
      if (src) {
        src.input = inputs.input.source;
        src.output = inputs.output.source;
        src.envelope = inputs.speechEnvelopeActive;
        src.gateIn = l.gainIn;
        src.gateOut = l.gainOut;
        src.inRms = l.inRms;
        src.outRms = l.outRms;
      }
      probe.mode = l.mode;
      const fit = ctx.fit;
      if (probe.bboxPx) {
        probe.bboxPx.x = fit.centerX - fit.radiusPx;
        probe.bboxPx.y = fit.centerY - fit.radiusPx;
        probe.bboxPx.w = fit.radiusPx * 2;
        probe.bboxPx.h = fit.radiusPx * 2;
      }
      if (probe.canvasPx) {
        probe.canvasPx.w = fit.width;
        probe.canvasPx.h = fit.height;
      }
      if (probe.frames % 15 === 0 && probe.frameTimes.length > 0) {
        const sorted = [...probe.frameTimes].sort((a, b) => a - b);
        probe.avgFrameMs = probe.frameTimes.reduce((a, b) => a + b, 0) / probe.frameTimes.length;
        probe.p95FrameMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number;
        probe.draws = frameCalls;
        probe.triangles = frameTriangles;
        probe.geometries = gl.info.memory.geometries;
        probe.textures = gl.info.memory.textures;
        probe.segments = sceneStats.segments;
        probe.plates = sceneStats.plates;
        probe.nodes = sceneStats.nodes;
        probe.points = sceneStats.points;
      }
    }

    if (adaptive && scaler.current && probe && probe.frames > 30) {
      const next = scaler.current.push(ctx.settings.testFrameMs ?? wallMs, now / 1000);
      if (next) onQualityChange?.(next);
    }
  }, -1);
  return null;
}

function BloomPass({ liveRef, profile }: { liveRef: MutableRefObject<LiveParams>; profile: ReturnType<typeof getQualityProfile> }) {
  const bloom = useRef<{ intensity: number } | null>(null);
  useFrame(() => {
    const l = liveRef.current;
    if (bloom.current) {
      const audio = Math.min(AUDIO_MAPPING.bloomMax - 0.8, l.bloomBoost * AUDIO_MAPPING.bloom * (1 - l.calm)) * (l.bloomIntensity > 0 ? 1 : 0);
      bloom.current.intensity = l.bloomIntensity * (1 + l.successPulse * 0.8) + audio;
    }
  });
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- effect instance ref, intensity is set per frame
        ref={bloom as any}
        mipmapBlur
        intensity={0.85}
        luminanceThreshold={0.36}
        luminanceSmoothing={0.25}
        radius={0.9}
        levels={profile.level === "ultra" ? 8 : 6}
      />
    </EffectComposer>
  );
}

/** Applies a group's irregular drift (rotation + vertical offset) so every group moves on its own phase. */
function DriftGroup({ id, name, children }: { id: number; name: string; children: ReactNode }) {
  const { live } = useOrb();
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const d = live.current.drift;
    const o = id * DRIFT_STRIDE;
    g.rotation.set(d[o] as number, d[o + 1] as number, d[o + 2] as number);
    g.position.y = d[o + 3] as number;
  });
  return (
    <group ref={ref} name={name}>
      {children}
    </group>
  );
}

/** Whole-orb micro motion: a minimal vertical offset and a very small irregular rotation drift. */
function MicroMotion({ children }: { children: ReactNode }) {
  const { live } = useOrb();
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.position.y = live.current.microY;
    g.rotation.z = live.current.microRotZ;
  });
  return (
    <group ref={ref} name="OrbRoot">
      {children}
    </group>
  );
}

/** The complete orb scene. Mounted once; state changes only move numbers inside `live`. */
export function OrbScene({ targetsRef, audioSourceRef, settings, quality, adaptive, onQualityChange, readFrames, fillRatio = 0.72, seed }: OrbSceneProps) {
  const profile = useMemo(() => getQualityProfile(quality, settings.particleDensity), [quality, settings.particleDensity]);
  const shared = useMemo(() => createSharedUniforms(), []);
  const live = useRef<LiveParams>(null as unknown as LiveParams);
  if (live.current === null) live.current = createLiveParams(targetsRef.current);
  const inputs = useMemo<OrbFrameInputs>(() => createInputs(), []);
  const fit = useMemo<OrbFit>(() => ({ radiusPx: 0, centerX: 0, centerY: 0, width: 0, height: 0 }), []);

  const ctx = useMemo<OrbSceneContextValue>(
    () => ({
      live,
      targets: targetsRef,
      shared,
      profile,
      settings,
      fixedClock: settings.testClock?.fixedTime !== undefined,
      audioSource: audioSourceRef,
      readFrames,
      inputs,
      fillRatio,
      fit,
    }),
    [targetsRef, audioSourceRef, shared, profile, settings, readFrames, inputs, fillRatio, fit],
  );
  const plates = usePlateSetsWith(ctx);
  const useBloom = profile.bloom && settings.bloom;

  return (
    <OrbSceneContext.Provider value={ctx}>
      <FrameDriver adaptive={adaptive} onQualityChange={onQualityChange} quality={quality} seed={seed} />
      <OrbCameraRig />
      <MicroMotion>
        <DriftGroup id={GROUP.particles} name="ParticleGroup">
          <DepthDust />
          <AmbientParticles />
          <EnergyParticles />
          <DataPackets />
        </DriftGroup>
        <SphereGlow />
        <DriftGroup id={GROUP.shells} name="HolographicShellGroup">
          <HolographicShells />
        </DriftGroup>
        <group name="CoreGroup">
          <CorePulseShell />
          <CoreEnergyNoise />
          <WhiteHotCore />
          <CoreLens />
        </group>
        <DriftGroup id={GROUP.innerA} name="InnerRingGroup">
          <EnergyArcs />
          <InnerReactor />
          <InnerGyroRings />
          <SegmentedRing />
        </DriftGroup>
        <DriftGroup id={GROUP.circuit} name="CircuitSphereGroup">
          <MidCircuitSphere plates={plates.mid} />
        </DriftGroup>
        <DriftGroup id={GROUP.fragments} name="FragmentGroupRoot">
          <OuterFragmentShell plates={plates.outer} />
        </DriftGroup>
        <DriftGroup id={GROUP.outerA} name="OuterRingGroup">
          <PrimaryOrbitalRing />
          <SecondaryTiltedRing />
          <TelemetryRing />
          <ProgressOrbit />
        </DriftGroup>
        <group name="ScanGroup">
          <ScanPlane />
          <ScanSweeps />
        </group>
        <VoiceReactionGroup />
        <AgentMarkers />
        <ApprovalOverlay />
        <WarningOverlay />
        <ErrorFractureOverlay />
        <ApprovalGlyph />
      </MicroMotion>
      {useBloom ? <BloomPass liveRef={live} profile={profile} /> : null}
    </OrbSceneContext.Provider>
  );
}

function usePlateSetsWith(ctx: OrbSceneContextValue) {
  return usePlateSets(ctx.profile.plates, ctx.profile.noiseOctaves);
}
