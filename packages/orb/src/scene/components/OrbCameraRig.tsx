import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { PerspectiveCamera } from "three";
import { useOrb } from "../OrbContext";

/** Radius (orb units) that must stay inside the panel at settings.size = 1. */
const FIT_RADIUS = 3.55;
/** Fraction of the panel height the orb is lifted by, so the state label has its own band below the sphere. */
const LIFT = 0.045;
const MAX_YAW = (3 * Math.PI) / 180;
const MAX_PITCH = (2 * Math.PI) / 180;

/**
 * Fits the orb + outer rings into the panel (~80 %), and applies a very subtle mouse parallax (max 3 deg yaw, 2 deg
 * pitch, damped). The pointer is read from the window so HTML overlays above the canvas cannot swallow it.
 */
export function OrbCameraRig() {
  const { live, settings, fixedClock } = useOrb();
  const gl = useThree((s) => s.gl);
  const pointer = useRef({ x: 0, y: 0 });
  const smooth = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      pointer.current.x = Math.max(-1, Math.min(1, nx));
      pointer.current.y = Math.max(-1, Math.min(1, ny));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [gl]);

  useFrame((state, delta) => {
    const camera = state.camera as PerspectiveCamera;
    const { width, height } = state.size;
    const aspect = width / Math.max(1, height);
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const fit = FIT_RADIUS / settings.size;
    const dist = Math.max(fit / tanHalf, fit / (tanHalf * aspect));

    const k = fixedClock ? 0 : live.current.parallax;
    const dt = Math.min(delta, 0.1);
    const follow = 1 - Math.exp(-dt / 0.35);
    smooth.current.x += (pointer.current.x * k - smooth.current.x) * follow;
    smooth.current.y += (pointer.current.y * k - smooth.current.y) * follow;
    const yaw = smooth.current.x * MAX_YAW;
    const pitch = smooth.current.y * MAX_PITCH;
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * dist,
      Math.sin(pitch) * dist,
      Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    camera.lookAt(0, 0, 0);
    camera.near = 0.1;
    camera.far = dist + 40;
    camera.setViewOffset(width, height, 0, height * LIFT, width, height);
    camera.updateProjectionMatrix();
  });
  return null;
}
