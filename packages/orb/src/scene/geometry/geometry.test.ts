import { describe, expect, it } from "vitest";
import { QUALITY_PROFILES } from "../../settings";
import { liveFor } from "../liveParams.test-helpers";
import { buildCircuitTraces, buildPlates } from "./circuit";
import { buildArcs, buildHaloBars, buildPackets, buildTelemetryRing } from "./structures";
import { breathScale, stepLiveParams } from "../liveParams";
import { deriveFromStatus } from "../../visual/deriveVisualTargets";
import { DEFAULT_ORB_SETTINGS } from "../../settings";

const traceOpts = {
  traces: 120,
  seed: 7,
  octaves: 2,
  shells: [1.35, 1.5, 1.62],
  shellWeights: [0.3, 0.4, 0.3],
  busFraction: 0.1,
  pushProbability: 0,
  pushRange: [0, 0] as const,
  stepRange: [2, 6] as const,
  kindBase: 0.2,
};

describe("seeded geometry", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    const a = buildCircuitTraces(traceOpts).lines.raw();
    const b = buildCircuitTraces(traceOpts).lines.raw();
    const c = buildCircuitTraces({ ...traceOpts, seed: 8 }).lines.raw();
    expect(a.a).toEqual(b.a);
    expect(a.a).not.toEqual(c.a);
  });

  it("keeps circuit points on the requested shells (+ jitter, no push)", () => {
    const { a } = buildCircuitTraces(traceOpts).lines.raw();
    for (let i = 0; i < a.length; i += 3) {
      const r = Math.hypot(a[i] as number, a[i + 1] as number, a[i + 2] as number);
      expect(r).toBeGreaterThan(1.3);
      expect(r).toBeLessThan(1.68);
    }
  });

  it("scales segment counts with the quality level", () => {
    const low = buildCircuitTraces({ ...traceOpts, traces: QUALITY_PROFILES.low.circuitTraces }).segments;
    const ultra = buildCircuitTraces({ ...traceOpts, traces: QUALITY_PROFILES.ultra.circuitTraces }).segments;
    expect(ultra).toBeGreaterThan(low * 2.5);
  });

  it("builds plates with elongated streaks and protruding fragments", () => {
    const plates = buildPlates({ count: 400, seed: 3, octaves: 2, radii: [1.3, 2.2], sizeRange: [0.06, 0.26], streakFraction: 0.1, pushProbability: 0.2 });
    expect(plates).toHaveLength(400);
    const streaks = plates.filter((p) => p.kind === 3);
    expect(streaks.length).toBeGreaterThan(15);
    expect(streaks.every((p) => p.height > p.width * 3)).toBe(true);
    expect(plates.some((p) => Math.hypot(...p.center) > 2.2)).toBe(true);
  });

  it("creates asymmetric density (more fragments on the left than on the right)", () => {
    const { nodes } = buildCircuitTraces({ ...traceOpts, traces: 1500 });
    const left = nodes.filter((n) => n.pos[0] < 0).length;
    const right = nodes.length - left;
    expect(Math.abs(left - right) / nodes.length).toBeGreaterThan(0.01);
  });

  it("builds arcs, halo bars, telemetry ticks and packet lanes", () => {
    const arcs = buildArcs({ count: 30, seed: 1, radii: [1.75, 2.25], length: [15, 110], lineCount: [1, 4], pushProbability: 0.12, pushRange: [0.1, 0.35], tickProbability: 0.3, kind: 0.5 });
    expect(arcs.segments).toBeGreaterThan(100);
    expect(buildHaloBars(128).segments).toBeGreaterThanOrEqual(128);
    expect(buildTelemetryRing(1).segments).toBeGreaterThan(180);
    expect(buildPackets(10, 1).count).toBe(60);
    arcs.geometry.dispose();
  });
});

describe("live parameter stepping", () => {
  it("damps towards targets (no snap) and snaps on the test clock", () => {
    const idle = deriveFromStatus({ mode: "idle", since: "s" }, DEFAULT_ORB_SETTINGS);
    const working = deriveFromStatus({ mode: "working", since: "s" }, DEFAULT_ORB_SETTINGS);
    const live = liveFor(idle);
    stepLiveParams(live, working, { dt: 0.016, time: 0.016, audioRaw: 0 });
    expect(live.packetRate).toBeGreaterThan(idle.packetRate);
    expect(live.packetRate).toBeLessThan(working.packetRate * 0.5);
    for (let i = 0; i < 200; i++) stepLiveParams(live, working, { dt: 0.016, time: 0.016 * (i + 2), audioRaw: 0 });
    expect(live.packetRate).toBeCloseTo(working.packetRate, 1);

    const fixedLive = liveFor(idle);
    stepLiveParams(fixedLive, working, { dt: 0.016, time: 12.5, audioRaw: 0, fixed: {} });
    expect(fixedLive.packetRate).toBe(working.packetRate);
    expect(fixedLive.ringAngles[2]).toBeCloseTo(working.ringSpeeds[2] * 12.5 + 2.0, 6);
  });

  it("is deterministic on the test clock and breath stays within +-2 %", () => {
    const t = deriveFromStatus({ mode: "idle", since: "s" }, DEFAULT_ORB_SETTINGS);
    const a = liveFor(t);
    const b = liveFor(t);
    stepLiveParams(a, t, { dt: 0.016, time: 5, audioRaw: 0, fixed: {} });
    stepLiveParams(b, t, { dt: 0.5, time: 5, audioRaw: 0, fixed: {} });
    expect(a.ringAngles).toEqual(b.ringAngles);
    for (let ts = 0; ts < 12; ts += 0.37) {
      stepLiveParams(a, t, { dt: 0.016, time: ts, audioRaw: 0, fixed: {} });
      expect(Math.abs(breathScale(a) - 1)).toBeLessThanOrEqual(0.0201);
    }
  });

  it("fires entry impulses once and lets them decay", () => {
    const idle = deriveFromStatus({ mode: "idle", since: "s" }, DEFAULT_ORB_SETTINGS);
    const error = deriveFromStatus({ mode: "error", since: "s" }, DEFAULT_ORB_SETTINGS);
    const live = liveFor(idle);
    stepLiveParams(live, error, { dt: 0.016, time: 0.016, audioRaw: 0 });
    expect(live.errorImpulse).toBeGreaterThan(0.9);
    for (let i = 0; i < 300; i++) stepLiveParams(live, error, { dt: 0.016, time: 0.032 + i * 0.016, audioRaw: 0 });
    expect(live.errorImpulse).toBeLessThan(0.01);
    expect(live.error).toBeGreaterThan(0.95);
  });

  it("smooths audio with a fast attack and slow release", () => {
    const t = deriveFromStatus({ mode: "listening", since: "s", audioLevel: 1 }, DEFAULT_ORB_SETTINGS);
    const live = liveFor(t);
    stepLiveParams(live, t, { dt: 0.06, time: 0.06, audioRaw: 1 });
    const afterAttack = live.audio;
    expect(afterAttack).toBeGreaterThan(0.55);
    stepLiveParams(live, t, { dt: 0.06, time: 0.12, audioRaw: 0 });
    expect(live.audio).toBeGreaterThan(afterAttack * 0.7);
  });
});
