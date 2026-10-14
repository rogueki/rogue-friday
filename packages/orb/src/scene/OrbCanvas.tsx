import { Canvas } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { OrbQualityLevel, OrbSettings } from "../settings";
import { getQualityProfile } from "../settings";
import type { VisualTargets } from "../visual/deriveVisualTargets";
import { OrbScene } from "./OrbScene";

export interface OrbCanvasProps {
  targetsRef: MutableRefObject<VisualTargets>;
  settings: OrbSettings;
  quality: OrbQualityLevel;
  adaptive: boolean;
  /** `false` pauses the render loop completely (hidden tab / off-screen). */
  active: boolean;
  onQualityChange?: (level: OrbQualityLevel) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  /** Fired once the WebGL context exists. */
  onReady?: () => void;
}

/** Transparent R3F canvas filling its container. Mounted once; state changes never remount the scene. */
export function OrbCanvas({ targetsRef, settings, quality, adaptive, active, onQualityChange, onContextLost, onContextRestored, onReady }: OrbCanvasProps) {
  const lost = useRef(onContextLost);
  const restored = useRef(onContextRestored);
  const ready = useRef(onReady);
  // Unmounting disposes the renderer, which itself fires `webglcontextlost`; those events must not look like real losses.
  const unmounted = useRef(false);
  // Layout effect on purpose: R3F disposes the renderer from its own layout cleanup, which must see the flag already set.
  useLayoutEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);
  useEffect(() => {
    lost.current = onContextLost;
    restored.current = onContextRestored;
    ready.current = onReady;
  });
  const profile = getQualityProfile(quality, settings.particleDensity);

  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={[1, profile.dpr]}
      flat
      camera={{ fov: 35, position: [0, 0, 10.5], near: 0.1, far: 60 }}
      gl={{ alpha: true, antialias: false, powerPreference: "high-performance", premultipliedAlpha: true, stencil: false, depth: false }}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "transparent" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        const canvas = gl.domElement;
        canvas.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          if (!unmounted.current) lost.current?.();
        });
        canvas.addEventListener("webglcontextrestored", () => {
          if (!unmounted.current) restored.current?.();
        });
        ready.current?.();
      }}
    >
      <OrbScene targetsRef={targetsRef} settings={settings} quality={quality} adaptive={adaptive} onQualityChange={onQualityChange} />
    </Canvas>
  );
}
