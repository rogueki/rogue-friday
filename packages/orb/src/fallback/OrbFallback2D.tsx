import { useEffect, useMemo, useRef } from "react";
import type { OrbLayers, OrbStatus } from "../contract-types";
import { layersFromStatus } from "../machine/orbMachine";
import { resolveAudioLevel, type OrbAudioSourceRef } from "../audio/audioSource";
import { createInputs } from "../audio/frame";
import type { OrbFrameInputs } from "../controller/types";
import { audioFixtureLevel } from "../audio/fixtures";
import { createLiveParams, stepLiveParams, type LiveParams } from "../scene/liveParams";
import { resolveSettings, type OrbSettings } from "../settings";
import { deriveVisualTargets, type VisualTargets } from "../visual/deriveVisualTargets";
import { createFallbackData, drawOrb2D, type Fallback2DData } from "./draw2d";

export interface OrbFallback2DProps {
  status: OrbStatus;
  layers?: OrbLayers;
  settings?: Partial<OrbSettings>;
  className?: string;
  /** OS `prefers-reduced-motion`; also derived automatically when omitted. */
  reducedMotion?: boolean;
  /** `false` stops the animation loop (hidden tab). */
  active?: boolean;
  /** Live audio level reader polled inside the animation loop (no React updates). */
  audioSourceRef?: OrbAudioSourceRef;
  /**
   * Derived visual targets of the parent (`FridayOrb` shares its targets with the fallback, so parallel controller layers
   * render identically). When given, `status`/`layers` are only used for the accessible name.
   */
  targetsRef?: { readonly current: VisualTargets };
  /** Controller frame reader (analysed audio frames), polled in the animation loop. */
  readFrames?: (nowMs: number, inputs: OrbFrameInputs) => void;
  /** Fraction of the short side covered by the nominal visible orb (default 0.72). */
  fillRatio?: number;
  seed?: number;
}

let sharedData: Fallback2DData | null = null;
const getData = (): Fallback2DData => (sharedData ??= createFallbackData());

/**
 * Canvas-2D rendition of the golden orb (PLAN §23.3): same palette and circuit data as the 3D scene, projected
 * orthographically. Shares the live-parameter damping with the WebGL scene, so state changes cross-fade identically.
 * With `animations: "off"` it draws a single static frame per state change.
 */
export function OrbFallback2D({ status, layers, settings, className, reducedMotion, active = true, audioSourceRef, targetsRef: externalTargets, readFrames, fillRatio = 0.72, seed }: OrbFallback2DProps) {
  const resolved = useMemo(() => resolveSettings(settings), [settings]);
  const effectiveLayers = useMemo(() => layers ?? layersFromStatus(status), [layers, status]);
  const targets = useMemo<VisualTargets>(
    () => deriveVisualTargets({ layers: effectiveLayers, status, settings: resolved, reducedMotion }),
    [effectiveLayers, status, resolved, reducedMotion],
  );
  const ownTargets = useRef(targets);
  useEffect(() => {
    ownTargets.current = targets;
  }, [targets]);
  const targetsRef = externalTargets ?? ownTargets;
  const inputsRef = useRef<OrbFrameInputs>(null as unknown as OrbFrameInputs);
  inputsRef.current ??= createInputs();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<LiveParams | null>(null);
  const settingsRef = useRef(resolved);
  useEffect(() => {
    settingsRef.current = resolved;
  }, [resolved]);

  const redrawRef = useRef<(() => void) | null>(null);
  const staticMode = resolved.animations === "off";
  const fixedTime = resolved.testClock?.fixedTime;
  const useFixed = staticMode || fixedTime !== undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = getData();
    liveRef.current ??= createLiveParams(targetsRef.current);
    const live = liveRef.current;
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    let cssW = 0;
    let cssH = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const frame = (now: number, single: boolean) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const t = targetsRef.current;
      const s = settingsRef.current;
      let time: number;
      if (useFixed) time = fixedTime ?? 0;
      else {
        clock += dt;
        time = clock;
      }
      const fixedOpt = useFixed ? { animationProgress: s.testClock?.animationProgress } : undefined;
      if (readFrames && !s.audioFixture) {
        readFrames(now, inputsRef.current);
        stepLiveParams(live, t, { dt, time, audioIn: inputsRef.current.input, audioOut: inputsRef.current.output, fixed: fixedOpt, seed });
      } else {
        const raw = t.audioGain > 0 ? (s.audioFixture ? audioFixtureLevel(s.audioFixture, time) : resolveAudioLevel(audioSourceRef, t.audioLevel)) : 0;
        stepLiveParams(live, t, { dt, time, audioRaw: raw, fixed: fixedOpt, seed });
      }
      drawOrb2D(ctx, cssW, cssH, live, data, { size: s.size, fill: fillRatio });
      if (!single && !useFixed && active) raf = window.setTimeout(() => frame(performance.now(), false), 33);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      frame(performance.now(), true);
    });
    ro.observe(canvas);
    redrawRef.current = () => {
      // static / test-clock frames settle instantly, so repeat the step a few times to converge on the targets
      frame(performance.now(), true);
    };
    frame(performance.now(), useFixed);
    return () => {
      redrawRef.current = null;
      ro.disconnect();
      window.clearTimeout(raf);
    };
  }, [active, useFixed, fixedTime, audioSourceRef, targetsRef, readFrames, fillRatio, seed]);

  useEffect(() => {
    if (useFixed) redrawRef.current?.();
  }, [targets, useFixed]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      data-testid="orb-fallback-2d"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "transparent" }}
    />
  );
}
