import { describe, expect, it } from "vitest";
import type { OrbMode, OrbStatus } from "../contract-types";
import { layersFromStatus } from "../machine/orbMachine";
import { DEFAULT_ORB_SETTINGS, resolveSettings } from "../settings";
import {
  deriveFromStatus,
  deriveVisualTargets,
  transitionDurationMs,
  transitionTimeConstants,
} from "./deriveVisualTargets";

const status = (mode: OrbMode, extra: Partial<OrbStatus> = {}): OrbStatus => ({ mode, since: "2026-06-15T10:00:00Z", ...extra });
const derive = (mode: OrbMode, extra: Partial<OrbStatus> = {}, settings = DEFAULT_ORB_SETTINGS) =>
  deriveFromStatus(status(mode, extra), settings);

describe("deriveVisualTargets", () => {
  it("idle is calm: slow breath, few packets, no halo, moderate core", () => {
    const t = derive("idle");
    expect(t.breathPeriod).toBeGreaterThanOrEqual(4.5);
    expect(t.breathPeriod).toBeLessThanOrEqual(6);
    expect(t.packetRate).toBeLessThan(0.2);
    expect(t.haloMode).toBe("off");
    expect(t.progressVisible).toBe(0);
    expect(Math.max(...t.ringSpeeds.map(Math.abs))).toBeLessThan(0.25);
    expect(t.accentMix).toBe(0);
  });

  it("working is the busiest state and maps progress", () => {
    const idle = derive("idle");
    const working = derive("working", { progress: 62, progressMode: "determinate", activeAgentCount: 3 });
    expect(working.packetRate).toBeGreaterThan(idle.packetRate * 5);
    expect(working.shellActivity).toBe(1);
    expect(working.radialOffset).toBeGreaterThan(0);
    expect(working.progress).toBeCloseTo(0.62);
    expect(working.progressMode).toBe("determinate");
    expect(working.agentCount).toBe(3);
    expect(Math.abs(working.ringSpeeds[2])).toBeGreaterThan(Math.abs(idle.ringSpeeds[2]) * 4);
  });

  it("never invents progress: determinate without a value is hidden", () => {
    const t = derive("working", { progress: null, progressMode: "determinate" });
    expect(t.progressMode).toBe("none");
    expect(t.progressVisible).toBe(0);
    expect(derive("working", { progressMode: "indeterminate" }).progressVisible).toBe(1);
  });

  it("listening shows a cyan halo and aligns segments; core brighter than idle", () => {
    const t = derive("listening", { audioLevel: 0.6 });
    expect(t.haloMode).toBe("cyan");
    expect(t.haloCyan).toBe(1);
    expect(t.haloLevel).toBeGreaterThan(0.5);
    expect(t.align).toBeGreaterThan(0.3);
    expect(t.coreIntensity).toBeGreaterThan(derive("idle").coreIntensity);
    expect(t.audioLevel).toBeCloseTo(0.6);
  });

  it("gates audio when audio reactivity is off or the mic is closed", () => {
    expect(derive("listening", { audioLevel: 0.6 }, { ...DEFAULT_ORB_SETTINGS, audioReactive: false }).audioLevel).toBe(0);
    expect(derive("idle", { audioLevel: 0.6 }).audioLevel).toBe(0);
  });

  it("speaking switches the halo to gold with waves", () => {
    const t = derive("speaking", { audioLevel: 0.5 });
    expect(t.haloMode).toBe("gold");
    expect(t.haloCyan).toBe(0);
    expect(t.speakWaves).toBe(1);
  });

  it("thinking counter-rotates the gyro rings and whitens the core", () => {
    const t = derive("thinking");
    expect(t.gyroCounter).toBeLessThan(0);
    expect(t.coreWhite).toBeGreaterThan(derive("idle").coreWhite + 0.3);
    expect(t.convergence).toBe(1);
    expect(t.progressVisible).toBe(0);
  });

  it("transcribing activates the scan plane and freezes the halo", () => {
    const t = derive("transcribing");
    expect(t.scanPlane).toBe(1);
    expect(t.haloFreeze).toBe(1);
  });

  it("thinking arrives as a work-layer value on the wire and still gets the thinking look", () => {
    const layers = { ...layersFromStatus(status("thinking")), voice: "idle" as const };
    expect(layers.work).toBe("thinking");
    const t = deriveVisualTargets({ layers, status: status("thinking"), settings: DEFAULT_ORB_SETTINGS });
    expect(t.mode).toBe("thinking");
    expect(t.gyroCounter).toBeLessThan(0);
  });

  it("booting, offline and paused come from status.mode / work / health", () => {
    expect(derive("booting").mode).toBe("booting");
    expect(derive("offline").mode).toBe("offline");
    const paused = deriveVisualTargets({
      layers: { ...layersFromStatus(status("idle")), work: "paused" },
      status: status("paused"),
      settings: DEFAULT_ORB_SETTINGS,
    });
    expect(paused.mode).toBe("paused");
    const offline = deriveVisualTargets({
      layers: { ...layersFromStatus(status("idle")), health: "offline" },
      status: status("idle"),
      settings: DEFAULT_ORB_SETTINGS,
    });
    expect(offline.mode).toBe("offline");
  });

  it("parallel layers: speaking core/halo + working outer shell + 3 agent markers", () => {
    const layers = { ...layersFromStatus(status("working")), voice: "speaking" as const, activeAgentIds: ["a", "b", "c"] };
    const t = deriveVisualTargets({
      layers,
      status: status("speaking", { audioLevel: 0.5 }),
      settings: DEFAULT_ORB_SETTINGS,
    });
    expect(t.mode).toBe("speaking");
    expect(t.haloMode).toBe("gold");
    expect(t.shellActivity).toBe(1);
    expect(t.radialOffset).toBeGreaterThan(0);
    expect(t.packetRate).toBeGreaterThan(0.9);
    expect(t.agentCount).toBe(3);
  });

  it("approval calms motion and raises the amber ring", () => {
    const layers = { ...layersFromStatus(status("working", { activeAgentCount: 2 })), attention: "waiting_approval" as const };
    const t = deriveVisualTargets({ layers, status: status("waiting_approval"), settings: DEFAULT_ORB_SETTINGS });
    expect(t.approval).toBe(1);
    expect(t.packetRate).toBeLessThanOrEqual(0.15);
    expect(t.shellActivity).toBeLessThanOrEqual(0.22);
    expect(t.accentMix).toBeGreaterThan(0);
  });

  it("error is a secondary accent: fracture on, core keeps its gold (accent mix < 0.5)", () => {
    const t = derive("error");
    expect(t.error).toBe(1);
    expect(t.fracture).toBeGreaterThan(0.3);
    expect(t.accentMix).toBeLessThan(0.5);
  });

  it("offline is desaturated bronze with rings stopped and low emission", () => {
    const t = derive("offline");
    expect(t.saturation).toBeLessThan(0.1);
    expect(t.emission).toBeLessThan(derive("idle").emission * 0.3);
    expect(t.ringSpeeds.every((s) => s === 0)).toBe(true);
    expect(t.packetRate).toBe(0);
    expect(t.telemetryGap).toBeGreaterThan(derive("idle").telemetryGap);
  });

  it("paused dims, keeps inner rings still and the outer ones barely moving", () => {
    const t = derive("paused");
    expect(t.ringSpeeds[0]).toBe(0);
    expect(t.ringSpeeds[1]).toBe(0);
    expect(t.emission).toBeLessThan(derive("idle").emission);
    expect(t.packetRate).toBe(0);
  });

  it("degraded health widens the telemetry gaps", () => {
    const layers = { ...layersFromStatus(status("idle")), health: "degraded" as const };
    const t = deriveVisualTargets({ layers, status: status("idle", { health: "degraded" }), settings: DEFAULT_ORB_SETTINGS });
    expect(t.telemetryGap).toBeGreaterThan(derive("idle").telemetryGap * 2);
  });

  it("reduced motion removes large rotations, radial motion and parallax", () => {
    const full = derive("working");
    const reduced = derive("working", {}, resolveSettings({ animations: "reduced" }));
    expect(Math.abs(reduced.ringSpeeds[2])).toBeLessThan(Math.abs(full.ringSpeeds[2]) * 0.2);
    expect(reduced.radialOffset).toBe(0);
    expect(reduced.parallax).toBe(false);
    expect(full.parallax).toBe(true);
    const osReduced = deriveVisualTargets({
      layers: layersFromStatus(status("working")),
      status: status("working"),
      settings: DEFAULT_ORB_SETTINGS,
      reducedMotion: true,
    });
    expect(osReduced.parallax).toBe(false);
  });

  it("intensity setting scales emission; bloom setting scales bloom", () => {
    const low = derive("idle", {}, resolveSettings({ intensity: 20 }));
    const high = derive("idle", {}, resolveSettings({ intensity: 100 }));
    expect(high.emission).toBeGreaterThan(low.emission * 2);
    expect(derive("idle", {}, resolveSettings({ bloom: false })).bloomIntensity).toBe(0);
  });

  it("status accent overrides apply per mode", () => {
    const t = derive("syncing", {}, resolveSettings({ statusAccentColors: { syncing: "#ff0000" } }));
    expect(t.accentColor).toEqual([1, 0, 0]);
  });

  it("is a pure function", () => {
    expect(derive("working", { progress: 0.3 })).toEqual(derive("working", { progress: 0.3 }));
  });
});

describe("transition time constants (PLAN 20.2)", () => {
  it("stays inside the documented ranges", () => {
    expect(transitionDurationMs("idle", "listening")).toBeGreaterThanOrEqual(120);
    expect(transitionDurationMs("idle", "listening")).toBeLessThanOrEqual(220);
    expect(transitionDurationMs("listening", "transcribing")).toBeGreaterThanOrEqual(180);
    expect(transitionDurationMs("listening", "transcribing")).toBeLessThanOrEqual(300);
    expect(transitionDurationMs("transcribing", "thinking")).toBeGreaterThanOrEqual(220);
    expect(transitionDurationMs("transcribing", "thinking")).toBeLessThanOrEqual(400);
    expect(transitionDurationMs("thinking", "working")).toBeGreaterThanOrEqual(300);
    expect(transitionDurationMs("thinking", "working")).toBeLessThanOrEqual(550);
    expect(transitionDurationMs("working", "speaking")).toBeGreaterThanOrEqual(180);
    expect(transitionDurationMs("working", "speaking")).toBeLessThanOrEqual(320);
    expect(transitionDurationMs("working", "error")).toBeLessThanOrEqual(180);
    expect(transitionDurationMs("idle", "error")).toBeLessThanOrEqual(180);
    expect(transitionDurationMs("error", "idle")).toBeGreaterThanOrEqual(700);
    expect(transitionDurationMs("error", "idle")).toBeLessThanOrEqual(1200);
    expect(transitionDurationMs("offline", "idle")).toBeGreaterThanOrEqual(900);
    expect(transitionDurationMs("offline", "idle")).toBeLessThanOrEqual(1600);
  });

  it("derives tau as a third of the settle time", () => {
    const t = transitionTimeConstants("idle", "listening");
    expect(t.intensity).toBeCloseTo(t.durationMs / 3000);
    expect(t.motion).toBeGreaterThan(t.intensity);
  });
});
