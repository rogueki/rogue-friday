import { describe, expect, it } from "vitest";
import { VISIBLE_RADIUS, cameraDistance, hostPaddingPx, orbDiameterPx } from "./fit";
import { fitCamera } from "./components/OrbCameraRig";

describe("orb fit (owner order section 5)", () => {
  it("default fill covers 65-78 % of the panel height at desktop sizes, centred, nothing clipped", () => {
    for (const [w, h, vh] of [
      [426, 368, 1080], // AI-Core stage at 1920x1080
      [331, 251, 768], // 1366x768
      [568, 490, 1440], // 2560x1440
      [852, 735, 2160], // 4K
    ] as const) {
      const pad = hostPaddingPx(vh);
      const d = orbDiameterPx(w, h, 0.72, 1, pad);
      expect(d / h).toBeGreaterThanOrEqual(0.65);
      expect(d / h).toBeLessThanOrEqual(0.78);
      // the nominal orb stays inside the padded box on both axes, so glow can fade before the canvas edge
      expect(d).toBeLessThanOrEqual(Math.min(w, h) - 2 * pad + 1e-6);
    }
  });

  it("caps the diameter so the padding is always free, whatever the fill ratio", () => {
    const pad = hostPaddingPx(1080);
    expect(orbDiameterPx(426, 368, 0.9, 1, pad)).toBeLessThanOrEqual(368 - 2 * pad + 1e-6);
  });

  it("clamps the host padding like clamp(24px, 4vh, 52px)", () => {
    expect(hostPaddingPx(300)).toBe(24);
    expect(hostPaddingPx(1080)).toBeCloseTo(43.2);
    expect(hostPaddingPx(4000)).toBe(52);
  });

  it("puts the visible radius exactly on radiusPx at the camera distance; no view offset needed", () => {
    const { distance, radiusPx } = fitCamera(426, 368, 0.72, 1, hostPaddingPx(1080));
    const tanHalf = Math.tan((35 * Math.PI) / 360);
    const projected = (VISIBLE_RADIUS / (distance * tanHalf)) * (368 / 2);
    expect(projected).toBeCloseTo(radiusPx, 6);
    expect(cameraDistance(368, radiusPx)).toBeCloseTo(distance, 9);
  });

  it("scales with settings.size and stays centred for wide and tall canvases", () => {
    const pad = hostPaddingPx(1080);
    expect(orbDiameterPx(900, 700, 0.72, 1.2, pad)).toBeCloseTo(orbDiameterPx(900, 700, 0.72, 1, pad) * 1.2);
    expect(orbDiameterPx(300, 600, 0.72, 1, pad)).toBeCloseTo(orbDiameterPx(600, 300, 0.72, 1, pad));
  });
});
