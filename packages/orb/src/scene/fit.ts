/**
 * Pure layout maths shared by the WebGL camera rig, the 2D fallback and the HTML hit target. No three.js import, so the
 * fallback and the tests can use it without pulling in the renderer.
 */

/**
 * Radius (orb units) of the nominal visible orb: the outermost element that is part of the orb itself (telemetry ring
 * 2.52, progress orbit 2.64, warning ring 2.64, pushed fragments up to ~2.7). Glow, dust and particles may exceed it
 * and fade out before the canvas edge.
 */
export const VISIBLE_RADIUS = 2.7;
export const CAMERA_FOV = 35;

/** Host padding `clamp(24px, 4vh, 52px)` (see ORB_CSS): the glow always has this much room around the usable box. */
export function hostPaddingPx(viewportHeight: number): number {
  return Math.min(52, Math.max(24, viewportHeight * 0.04));
}

/** Diameter (CSS px) of the nominal visible orb: `fill` of the panel's short side, never closer to the edge than the padding. */
export function orbDiameterPx(width: number, height: number, fill: number, size: number, paddingPx: number): number {
  const minDim = Math.max(1, Math.min(width, height));
  const usable = Math.max(minDim * 0.4, minDim - 2 * paddingPx);
  return Math.min(fill * minDim, usable) * size;
}

/** Camera distance at which a sphere of `VISIBLE_RADIUS` has the radius `radiusPx` on a canvas of the given height. */
export function cameraDistance(height: number, radiusPx: number): number {
  const tanHalf = Math.tan((CAMERA_FOV * Math.PI) / 360);
  return (VISIBLE_RADIUS * (height / 2)) / (radiusPx * tanHalf);
}
