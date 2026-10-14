import { useEffect, useState, type CSSProperties } from "react";
import type { OrbDebugProbe } from "../scene/OrbScene";
import { sceneStats } from "../scene/stats";

export interface OrbPerfSnapshot {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  draws: number;
  geometries: number;
  textures: number;
  vramMb: number;
  quality: string;
  segments: number;
  frames: number;
}

const BYTES_PER_SEGMENT_INSTANCE = (3 + 3 + 2 + 2) * 4;
const BYTES_PER_PLATE_INSTANCE = (3 + 3 + 3 + 2 + 3) * 4;
const BYTES_PER_SPRITE_INSTANCE = (3 + 4) * 4;

/**
 * Approximate VRAM: instanced vertex data + the HDR framebuffers (RGBA16F colour, composer ping-pong, bloom mip chain).
 * Deliberately an estimate; WebGL exposes no real allocation numbers.
 */
export function estimateVramMb(probe: Pick<OrbDebugProbe, "segments">, width: number, height: number, pixelRatio: number, bloom: boolean): number {
  const geometryBytes =
    probe.segments * BYTES_PER_SEGMENT_INSTANCE +
    sceneStats.plates * BYTES_PER_PLATE_INSTANCE +
    (sceneStats.nodes + sceneStats.points) * BYTES_PER_SPRITE_INSTANCE;
  const px = width * pixelRatio * height * pixelRatio;
  const framebufferBytes = px * 8 * (bloom ? 2 + 1.34 : 1) + px * 4;
  return (geometryBytes + framebufferBytes) / (1024 * 1024);
}

export function readPerfSnapshot(width = 0, height = 0, pixelRatio = 1, bloom = true): OrbPerfSnapshot | null {
  const p = typeof window === "undefined" ? undefined : window.__ORB_DEBUG__;
  if (!p) return null;
  return {
    fps: p.avgFrameMs > 0 ? 1000 / p.avgFrameMs : 0,
    avgFrameMs: p.avgFrameMs,
    p95FrameMs: p.p95FrameMs,
    draws: p.draws,
    geometries: p.geometries,
    textures: p.textures,
    vramMb: estimateVramMb(p, width, height, pixelRatio, bloom),
    quality: p.quality,
    segments: p.segments,
    frames: p.frames,
  };
}

function isProduction(): boolean {
  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
}

const box: CSSProperties = {
  position: "absolute",
  top: 6,
  left: 6,
  zIndex: 5,
  padding: "6px 8px",
  font: "10px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  color: "#9be7ff",
  background: "rgba(2,10,18,.78)",
  border: "1px solid rgba(80,200,240,.35)",
  borderRadius: 2,
  pointerEvents: "none",
  whiteSpace: "pre",
};

/** Development-only performance overlay (PLAN §52.4). Renders nothing in production unless `force` is set. */
export function OrbPerfOverlay({ force = false, bloom = true }: { force?: boolean; bloom?: boolean }) {
  const [snap, setSnap] = useState<OrbPerfSnapshot | null>(null);
  useEffect(() => {
    if (!force && isProduction()) return;
    const id = window.setInterval(() => {
      const root = document.querySelector("[data-orb-root] canvas");
      const rect = root?.getBoundingClientRect();
      setSnap(readPerfSnapshot(rect?.width ?? 0, rect?.height ?? 0, window.devicePixelRatio || 1, bloom));
    }, 500);
    return () => window.clearInterval(id);
  }, [force, bloom]);
  if (!force && isProduction()) return null;
  if (!snap) return <div style={box}>ORB PERF  warming up…</div>;
  return (
    <div style={box} data-testid="orb-perf">
      {`FPS         ${snap.fps.toFixed(0)}\nframe avg   ${snap.avgFrameMs.toFixed(1)} ms\nframe p95   ${snap.p95FrameMs.toFixed(1)} ms\ndraw calls  ${snap.draws}\ngeometries  ${snap.geometries}\ntextures    ${snap.textures}\nVRAM ~      ${snap.vramMb.toFixed(0)} MB\nquality     ${snap.quality}\nsegments    ${snap.segments}`}
    </div>
  );
}
