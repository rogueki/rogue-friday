import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { PerspectiveCamera } from "three";
import { cameraDistance, hostPaddingPx, orbDiameterPx } from "../fit";
import { useOrb } from "../OrbContext";

const MAX_YAW = (3 * Math.PI) / 180;
const MAX_PITCH = (2 * Math.PI) / 180;

export { VISIBLE_RADIUS, hostPaddingPx, orbDiameterPx } from "../fit";

/**
 * Pure camera fit: distance such that a sphere of `VISIBLE_RADIUS` covers `fill` of the usable panel height (the canvas =
 * the stage), capped so that the host padding always remains free for the glow; centred exactly on the canvas centre.
 * No lift, no view offset.
 */
export function fitCamera(width: number, height: number, fill: number, size: number, paddingPx: number): { distance: number; radiusPx: number } {
  const radiusPx = Math.max(8, orbDiameterPx(width, height, fill, size, paddingPx) / 2);
  return { distance: cameraDistance(height, radiusPx), radiusPx };
}

/**
 * Centres the orb at (0,0,0) with the camera on the z axis, fits the nominal visible orb to the configured fraction of
 * the usable panel height, and applies a very subtle mouse parallax (max 3 deg yaw, 2 deg pitch, damped). The pointer
 * is read from the window so HTML overlays above the canvas cannot swallow it.
 */
export function OrbCameraRig() {
  const { live, settings, fixedClock, fillRatio, fit } = useOrb();
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
    const { distance, radiusPx } = fitCamera(width, height, fillRatio, settings.size, hostPaddingPx(window.innerHeight));
    fit.radiusPx = radiusPx;
    fit.centerX = width / 2;
    fit.centerY = height / 2;
    fit.width = width;
    fit.height = height;

    const k = fixedClock ? 0 : live.current.parallax;
    const dt = Math.min(delta, 0.1);
    const follow = 1 - Math.exp(-dt / 0.35);
    smooth.current.x += (pointer.current.x * k - smooth.current.x) * follow;
    smooth.current.y += (pointer.current.y * k - smooth.current.y) * follow;
    const yaw = smooth.current.x * MAX_YAW;
    const pitch = smooth.current.y * MAX_PITCH;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance);
    camera.lookAt(0, 0, 0);
    camera.near = 0.1;
    camera.far = distance + 40;
    camera.updateProjectionMatrix();
  });
  return null;
}
