import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { audioFixtureLevel } from "../audio/fixtures";
import { getQualityProfile, type OrbQualityLevel, type OrbSettings } from "../settings";
import type { VisualTargets } from "../visual/deriveVisualTargets";
import { AdaptiveQuality } from "./adaptiveQuality";
import { MidCircuitSphere, OuterFragmentShell, usePlateSets } from "./components/circuit";
import { CoreCorona, CoreLens, SphereGlow, WhiteHotCore } from "./components/core";
import { OrbCameraRig } from "./components/OrbCameraRig";
import { ApprovalOverlay, ErrorFractureOverlay, WarningOverlay } from "./components/overlays";
import {
  InnerGyroRings,
  InnerReactor,
  PrimaryOrbitalRing,
  ProgressOrbit,
  SecondaryTiltedRing,
  TelemetryRing,
} from "./components/rings";
import {
  AgentMarkers,
  AudioReactiveHalo,
  DataPackets,
  DepthDust,
  EnergyArcs,
  MicroParticleHalo,
  ScanPlane,
} from "./components/signals";
import { resolveAudioLevel, type OrbAudioSourceRef } from "../audio/audioSource";
import { createLiveParams, stepLiveParams, type LiveParams } from "./liveParams";
import { createSharedUniforms, syncSharedUniforms } from "./materials";
import { OrbSceneContext, useOrb, type OrbSceneContextValue } from "./OrbContext";
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
}

const MAX_SAMPLES = 240;

/** Per-frame driver: clock, damping towards the targets, shared uniforms, perf probe, adaptive quality. */
function FrameDriver({ adaptive, onQualityChange, quality }: { adaptive: boolean; onQualityChange?: (l: OrbQualityLevel) => void; quality: OrbQualityLevel }) {
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
    const frameInfo = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    gl.info.reset();
    lastWall.current = now;

    const { settings, live, targets, shared } = ctx;
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
    const rawAudio = t.audioGain > 0 ? (settings.audioFixture ? audioFixtureLevel(settings.audioFixture, time) : resolveAudioLevel(ctx.audioSource, t.audioLevel)) : 0;
    stepLiveParams(live.current, t, {
      dt,
      time,
      audioRaw: rawAudio,
      fixed: fixedTime !== undefined ? { animationProgress: settings.testClock?.animationProgress } : undefined,
    });
    syncSharedUniforms(shared, live.current, { width: state.size.width, height: state.size.height, pixelRatio: gl.getPixelRatio() });

    const probe = window.__ORB_DEBUG__;
    if (probe) {
      probe.testClock = fixedTime === undefined ? "" : `${fixedTime}|${settings.testClock?.animationProgress ?? ""}|${settings.audioFixture ?? ""}`;
      probe.frames += 1;
      if (probe.frames > 3) {
        probe.frameTimes.push(wallMs);
        if (probe.frameTimes.length > MAX_SAMPLES) probe.frameTimes.shift();
      }
      if (probe.frames % 15 === 0 && probe.frameTimes.length > 0) {
        const sorted = [...probe.frameTimes].sort((a, b) => a - b);
        probe.avgFrameMs = probe.frameTimes.reduce((a, b) => a + b, 0) / probe.frameTimes.length;
        probe.p95FrameMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number;
        probe.draws = frameInfo.calls;
        probe.triangles = frameInfo.triangles;
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
    if (bloom.current) bloom.current.intensity = liveRef.current.bloomIntensity * (1 + liveRef.current.successPulse * 0.8);
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

/** The complete orb scene. Mounted once; state changes only move numbers inside `live`. */
export function OrbScene({ targetsRef, audioSourceRef, settings, quality, adaptive, onQualityChange }: OrbSceneProps) {
  const profile = useMemo(() => getQualityProfile(quality, settings.particleDensity), [quality, settings.particleDensity]);
  const shared = useMemo(() => createSharedUniforms(), []);
  const live = useRef<LiveParams>(null as unknown as LiveParams);
  if (live.current === null) live.current = createLiveParams(targetsRef.current);

  const ctx = useMemo<OrbSceneContextValue>(
    () => ({ live, targets: targetsRef, shared, profile, settings, fixedClock: settings.testClock?.fixedTime !== undefined, audioSource: audioSourceRef }),
    [targetsRef, audioSourceRef, shared, profile, settings],
  );
  const plates = usePlateSetsWith(ctx);
  const useBloom = profile.bloom && settings.bloom;

  return (
    <OrbSceneContext.Provider value={ctx}>
      <FrameDriver adaptive={adaptive} onQualityChange={onQualityChange} quality={quality} />
      <OrbCameraRig />
      <group>
        <DepthDust />
        <MicroParticleHalo />
        <SphereGlow />
        <CoreCorona />
        <EnergyArcs />
        <MidCircuitSphere plates={plates.mid} />
        <OuterFragmentShell plates={plates.outer} />
        <InnerReactor />
        <InnerGyroRings />
        <PrimaryOrbitalRing />
        <SecondaryTiltedRing />
        <TelemetryRing />
        <ProgressOrbit />
        <DataPackets />
        <ScanPlane />
        <AudioReactiveHalo />
        <AgentMarkers />
        <ApprovalOverlay />
        <WarningOverlay />
        <ErrorFractureOverlay />
        <CoreLens />
        <WhiteHotCore />
      </group>
      {useBloom ? <BloomPass liveRef={live} profile={profile} /> : null}
    </OrbSceneContext.Provider>
  );
}

function usePlateSetsWith(ctx: OrbSceneContextValue) {
  return usePlateSets(ctx.profile.plates, ctx.profile.noiseOctaves);
}
