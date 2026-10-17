import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { toAudioLevelReader, type OrbAudioLevelReader, type OrbAudioSourceRef } from "./audio/audioSource";
import type { OrbLayers, OrbSnapshot, OrbStatus } from "./contract-types";
import { OrbPerfOverlay } from "./debug/OrbPerfOverlay";
import { OrbFallback2D } from "./fallback/OrbFallback2D";
import { DEFAULT_ASSISTANT_NAME, activationTarget, buildAriaSentence, formatRuntime, resolveLabels, type OrbActivationTarget, type OrbLabelLocale, type OrbLabels } from "./labels";
import { toWireLayers, toWireStatus } from "./controller/layers";
import type { OrbController } from "./controller/types";
import { layersFromStatus } from "./machine/orbMachine";
import { ORB_CSS, OrbOverlay } from "./OrbOverlay";
import { OrbCanvas } from "./scene/OrbCanvas";
import { hostPaddingPx, orbDiameterPx } from "./scene/fit";
import { resolveQuality, resolveSettings, type OrbQualityLevel, type OrbSettings } from "./settings";
import { deriveVisualTargets, deriveVisualTargetsFromController } from "./visual/deriveVisualTargets";
import type { OrbFrameInputs } from "./controller/types";

interface FridayOrbBaseProps {
  settings?: Partial<OrbSettings>;
  onActivate?: (target: OrbActivationTarget) => void;
  onVoiceToggle?: () => void;
  labels?: Partial<OrbLabels>;
  /** Display name interpolated into the default labels (default "F.R.I.D.A.Y."). */
  assistantName?: string;
  /** Locale of the default labels (default "de"). */
  locale?: OrbLabelLocale;
  className?: string;
  style?: CSSProperties;
  /** Show the development performance overlay (PLAN §52.4). */
  showPerf?: boolean;
  /** Called when the effective renderer changes (3d <-> 2d). */
  onRendererChange?: (renderer: "3d" | "2d") => void;
  /**
   * Live audio level (0..1), called once per rendered frame inside the animation loop. Use it (or `audioLevelRef`)
   * instead of `status.audioLevel` for audio reactivity beyond React's update rate; it never causes a re-render.
   * Only read while the voice layer is listening/speaking and `settings.audioReactive` is on.
   */
  getAudioLevel?: OrbAudioLevelReader;
  /** Same as `getAudioLevel`, for a ref the caller writes to (e.g. from an audio analyser callback). */
  audioLevelRef?: { readonly current: number | null };
  /**
   * Typed runtime controller (docs/ORB_REWORK_ANALYSIS.md section 8). When given it wins over `snapshot`, `status`,
   * `layers`, `getAudioLevel` and `audioLevelRef`, which remain for stories and tests.
   */
  controller?: OrbController;
  /**
   * Fraction of the usable panel height (the stage this component fills) covered by the visible orb including its outer
   * rings. Default 0.72; the owner order asks for 0.65-0.78. Glow, dust and particles fade out inside the canvas.
   */
  fillRatio?: number;
  /** Seed of the deterministic data-impulse scheduler (tests, screenshots). */
  seed?: number;
}

/**
 * Either a wire `snapshot` (GET /orb/status payload) or `status` + optional `layers` (derived from `status.mode`
 * when omitted, PLAN §18.2).
 */
export type FridayOrbProps = FridayOrbBaseProps &
  (
    | { snapshot: OrbSnapshot; status?: undefined; layers?: undefined }
    | { status: OrbStatus; layers?: OrbLayers; snapshot?: undefined }
    | { controller: OrbController; snapshot?: OrbSnapshot; status?: OrbStatus; layers?: OrbLayers }
  );

const NO_SUBSCRIBE = (): (() => void) => () => undefined;

/** Low-rate controller state (mode, texts, progress steps); the scene reads the per-frame data itself. */
function useControllerState(controller: OrbController | undefined) {
  const subscribe = useCallback((onChange: () => void) => (controller ? controller.subscribe(onChange) : NO_SUBSCRIBE()), [controller]);
  const getSnapshot = useCallback(() => (controller ? controller.getState() : null), [controller]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

let webglSupport: boolean | undefined;

/** One-off WebGL2 probe; the probe context is released immediately so it does not eat a context slot. */
export function detectWebGL(): boolean {
  if (webglSupport !== undefined) return webglSupport;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    webglSupport = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/** Diameter (px) of the visible orb inside the host, for the hit target; follows resizes through a ResizeObserver. */
function useOrbDiameter(ref: React.RefObject<HTMLElement | null>, fill: number, size: number): string | undefined {
  const [px, setPx] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const d = Math.round(orbDiameterPx(rect.width, rect.height, fill, size, hostPaddingPx(window.innerHeight)));
      setPx((prev) => (prev === d ? prev : d));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fill, size]);
  return px === undefined ? undefined : `${px}px`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Page visible and container intersecting the viewport. Drives `frameloop` (never when hidden). */
function useRenderActive(ref: React.RefObject<HTMLElement | null>): boolean {
  const [pageVisible, setPageVisible] = useState(true);
  const [intersecting, setIntersecting] = useState(true);
  useEffect(() => {
    const onVis = () => setPageVisible(document.visibilityState !== "hidden");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setIntersecting(entries.some((e) => e.isIntersecting)), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return pageVisible && intersecting;
}

/** Keeps the settings object referentially stable while its content is unchanged (avoids scene churn on parent re-render). */
function useStableSettings(partial: Partial<OrbSettings> | undefined): OrbSettings {
  const key = JSON.stringify(partial ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialised `partial`
  return useMemo(() => resolveSettings(partial), [key]);
}

/** Polite live region: announces mode changes immediately, progress/agent updates at most every 3 s. */
function useAnnouncement(sentence: string, mode: string): string {
  const [text, setText] = useState(sentence);
  const last = useRef({ at: 0, mode });
  useEffect(() => {
    const now = Date.now();
    const modeChanged = last.current.mode !== mode;
    if (modeChanged || now - last.current.at >= 3000) {
      last.current = { at: now, mode };
      setText(sentence);
      return;
    }
    const id = window.setTimeout(() => {
      last.current = { at: Date.now(), mode };
      setText(sentence);
    }, 3000 - (now - last.current.at));
    return () => window.clearTimeout(id);
  }, [sentence, mode]);
  return text;
}

export function FridayOrb({
  status: statusProp,
  layers: layersProp,
  snapshot,
  settings: settingsInput,
  onActivate,
  onVoiceToggle,
  labels: labelsInput,
  assistantName,
  locale,
  className,
  style,
  showPerf = false,
  onRendererChange,
  getAudioLevel,
  audioLevelRef,
  controller,
  fillRatio = 0.72,
  seed,
}: FridayOrbProps) {
  const controllerState = useControllerState(controller);
  const controllerWire = useMemo(() => {
    if (!controllerState) return null;
    const count = controllerState.status.activeAgentCount ?? 0;
    const layers = toWireLayers(controllerState.layers, count);
    return {
      layers,
      status: toWireStatus(controllerState.status, { health: layers.health, approvalId: controllerState.layers.approval.approvalId }),
    };
  }, [controllerState]);
  const status = (controllerWire?.status ?? snapshot?.status ?? statusProp) as OrbStatus;
  const layers = controllerWire?.layers ?? snapshot?.layers ?? layersProp;
  const settings = useStableSettings(settingsInput);
  const labels = useMemo(() => resolveLabels(labelsInput, { assistantName, locale }), [labelsInput, assistantName, locale]);
  const containerRef = useRef<HTMLDivElement>(null);
  const osReduced = usePrefersReducedMotion();
  const active = useRenderActive(containerRef);

  const effectiveLayers = useMemo(() => layers ?? layersFromStatus(status), [layers, status]);
  const targets = useMemo(
    () =>
      controllerState
        ? deriveVisualTargetsFromController(controllerState, settings, osReduced)
        : deriveVisualTargets({ layers: effectiveLayers, status, settings, reducedMotion: osReduced }),
    [controllerState, effectiveLayers, status, settings, osReduced],
  );
  // The scene pulls the controller's analysed audio frames once per rendered frame (no React involved).
  const readFrames = useMemo(
    () => (controller ? (nowMs: number, inputs: OrbFrameInputs) => controller.readFrame(nowMs, inputs) : undefined),
    [controller],
  );
  const diameter = useOrbDiameter(containerRef, fillRatio, settings.size);
  const targetsRef = useRef(targets);
  useLayoutEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  // The renderers poll this holder every frame; props can change without touching the scene.
  const audioSourceRef = useRef<OrbAudioLevelReader | undefined>(undefined) as OrbAudioSourceRef;
  useLayoutEffect(() => {
    audioSourceRef.current = toAudioLevelReader(getAudioLevel, audioLevelRef);
  }, [getAudioLevel, audioLevelRef, audioSourceRef]);

  // Renderer selection: WebGL availability is probed after mount (SSR-safe), context loss swaps in the 2D fallback.
  const [webgl, setWebgl] = useState<"unknown" | "yes" | "no">("unknown");
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  useEffect(() => setWebgl(detectWebGL() ? "yes" : "no"), []);
  const wants3d = settings.renderer !== "2d" && settings.animations !== "off";
  const show3d = wants3d && webgl === "yes";
  const showFallback = webgl !== "unknown" && (!show3d || contextLost);
  const renderer: "3d" | "2d" = show3d && !contextLost ? "3d" : "2d";

  const rendererCb = useRef(onRendererChange);
  useEffect(() => {
    rendererCb.current = onRendererChange;
  });
  useEffect(() => {
    if (webgl !== "unknown") rendererCb.current?.(renderer);
  }, [renderer, webgl]);

  // Context loss: show the fallback immediately and try to bring WebGL back (native restore, else a fresh canvas).
  const restoreTimer = useRef<number | undefined>(undefined);
  const handleLost = useCallback(() => {
    setContextLost(true);
    window.clearTimeout(restoreTimer.current);
    restoreTimer.current = window.setTimeout(() => setCanvasKey((k) => k + 1), 3500);
  }, []);
  const handleRestored = useCallback(() => {
    window.clearTimeout(restoreTimer.current);
    setCanvasKey((k) => k + 1);
    setContextLost(false);
  }, []);
  const handleReady = useCallback(() => {
    window.clearTimeout(restoreTimer.current);
    setContextLost(false);
  }, []);
  useEffect(() => () => window.clearTimeout(restoreTimer.current), []);

  // Quality: explicit level, or `auto` driven by the adaptive controller inside the scene.
  const [measured, setMeasured] = useState<OrbQualityLevel | undefined>();
  const [hints] = useState(() => ({
    hardwareConcurrency: typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency,
    deviceMemory: typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    coarsePointer: typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
  }));
  const quality = resolveQuality(settings.quality, { ...hints, measured });
  const adaptive = settings.quality === "auto" && settings.testClock?.fixedTime === undefined;

  // Interaction
  const [tipOpen, setTipOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!tipOpen) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [tipOpen]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      onVoiceToggle?.();
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.code === "Space") e.preventDefault(); // stop the native "click on space" of <button>
  };

  const sentence = buildAriaSentence(status, effectiveLayers, labels);
  const announced = useAnnouncement(sentence, status.mode);
  const agentCount = Math.max(effectiveLayers.activeAgentIds.length, status.activeAgentCount ?? 0);
  const none = labels.tooltip.none;
  const tipId = "friday-orb-tip";

  return (
    <div
      ref={containerRef}
      className={["friday-orb", className].filter(Boolean).join(" ")}
      style={diameter ? ({ ...style, "--orb-diameter": diameter } as CSSProperties) : style}
      data-orb-root=""
      data-orb-mode={status.mode}
      data-orb-renderer={renderer}
      data-orb-quality={quality}
      data-orb-webgl={webgl}
      role="group"
      aria-label={`${assistantName?.trim() || DEFAULT_ASSISTANT_NAME} Orb`}
    >
      <style>{ORB_CSS}</style>
      {show3d ? (
        <div className="friday-orb__canvas" style={{ visibility: contextLost ? "hidden" : "visible" }}>
          <OrbCanvas
            key={canvasKey}
            targetsRef={targetsRef}
            audioSourceRef={audioSourceRef}
            settings={settings}
            quality={quality}
            adaptive={adaptive}
            active={active && !contextLost}
            onQualityChange={setMeasured}
            readFrames={readFrames}
            fillRatio={fillRatio}
            seed={seed}
            onContextLost={handleLost}
            onContextRestored={handleRestored}
            onReady={handleReady}
          />
        </div>
      ) : null}
      {showFallback ? <OrbFallback2D status={status} layers={effectiveLayers} settings={settings} reducedMotion={osReduced} active={active} audioSourceRef={audioSourceRef} targetsRef={targetsRef} readFrames={readFrames} fillRatio={fillRatio} seed={seed} /> : null}
      <OrbOverlay status={status} layers={effectiveLayers} labels={labels} />
      <button
        type="button"
        className="friday-orb__target"
        aria-label={`${labels.hitTarget}. ${labels.states[status.mode]}`}
        aria-describedby={tipOpen ? tipId : undefined}
        onClick={() => onActivate?.(activationTarget(status))}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPointerEnter={() => setTipOpen(true)}
        onPointerLeave={() => setTipOpen(false)}
        onFocus={() => setTipOpen(true)}
        onBlur={() => setTipOpen(false)}
      />
      {tipOpen ? (
        <div id={tipId} role="tooltip" className="friday-orb__tip" data-testid="orb-tooltip">
          <dl>
            <dt>{labels.tooltip.state}</dt>
            <dd>{labels.states[status.mode]}</dd>
            <dt>{labels.tooltip.action}</dt>
            <dd>{status.activityText ?? none}</dd>
            <dt>{labels.tooltip.runtime}</dt>
            <dd>{formatRuntime(status.since, now) || none}</dd>
            <dt>{labels.tooltip.agent}</dt>
            <dd>{status.currentAgentId ?? (agentCount > 0 ? String(agentCount) : none)}</dd>
            <dt>{labels.tooltip.task}</dt>
            <dd>{status.taskId ?? none}</dd>
            <dt>{labels.tooltip.source}</dt>
            <dd>{status.sourceEventId ?? none}</dd>
          </dl>
        </div>
      ) : null}
      <span className="friday-orb__sr" role="status" aria-live="polite" aria-atomic="true" data-testid="orb-aria-live">
        {announced}
      </span>
      {showPerf ? <OrbPerfOverlay bloom={settings.bloom} /> : null}
    </div>
  );
}
