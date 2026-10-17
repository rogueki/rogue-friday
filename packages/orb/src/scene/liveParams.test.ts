import { describe, expect, it } from "vitest";
import { createAudioFrame } from "../audio/frame";
import { DEFAULT_ORB_SETTINGS, resolveSettings } from "../settings";
import { deriveFromStatus } from "../visual/deriveVisualTargets";
import { breathScale, breathWave, createLiveParams, GROUP_COUNT, PULSE_RINGS, stepLiveParams, type LiveParams } from "./liveParams";

const targets = (mode: Parameters<typeof deriveFromStatus>[0]["mode"], extra: Partial<Parameters<typeof deriveFromStatus>[0]> = {}, settings = DEFAULT_ORB_SETTINGS) =>
  deriveFromStatus({ mode, since: "s", ...extra }, settings);

function run(live: LiveParams, t: ReturnType<typeof targets>, seconds: number, onFrame?: (l: LiveParams, time: number) => void, startTime = 0): number {
  const dt = 1 / 60;
  let time = startTime;
  for (let i = 0; i < seconds * 60; i++) {
    time += dt;
    stepLiveParams(live, t, { dt, time, audioRaw: 0, seed: 7 });
    onFrame?.(live, time);
  }
  return time;
}

describe("idle lives (owner order section 8)", () => {
  const idle = targets("idle");

  it("core scale stays in 0.97..1.035 and brightness in 72..100 % over a 4.5-6 s cycle", () => {
    const live = createLiveParams(idle);
    const scales: number[] = [];
    const bright: number[] = [];
    const crossings: number[] = [];
    let prevWave = breathWave(live.breathPhase);
    run(live, idle, 90, (l, time) => {
      scales.push(breathScale(l));
      bright.push(l.coreLevel / l.coreIntensity);
      const w = breathWave(l.breathPhase);
      if (prevWave < 0 && w >= 0) crossings.push(time);
      prevWave = w;
    });
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.9695);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.0355);
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.05); // really moves
    expect(Math.min(...bright)).toBeGreaterThanOrEqual(0.715);
    expect(Math.max(...bright)).toBeLessThanOrEqual(1.0001);
    expect(Math.min(...bright)).toBeLessThan(0.76);
    const periods = crossings.slice(1).map((c, i) => c - crossings[i]!);
    expect(periods.length).toBeGreaterThan(10);
    for (const p of periods) {
      expect(p).toBeGreaterThanOrEqual(4.4);
      expect(p).toBeLessThanOrEqual(6.1);
    }
    // not metronomic: the period wanders
    expect(Math.max(...periods) - Math.min(...periods)).toBeGreaterThan(0.2);
  });

  it("has at least five independent visible motions (rings, breath, shells, drift, pulses, micro motion)", () => {
    const live = createLiveParams(idle);
    const start = { rings: [...live.ringAngles], mid: live.midAngle, outer: live.outerAngle };
    const driftRange = Array.from({ length: GROUP_COUNT }, () => ({ lo: Infinity, hi: -Infinity }));
    let pulseFrames = 0;
    const scales: number[] = [];
    const ys: number[] = [];
    run(live, idle, 40, (l) => {
      for (let g = 0; g < GROUP_COUNT; g++) {
        const v = l.drift[g * 4 + 2]!;
        driftRange[g]!.lo = Math.min(driftRange[g]!.lo, v);
        driftRange[g]!.hi = Math.max(driftRange[g]!.hi, v);
      }
      if (l.pulseHead.some((h) => h >= 0)) pulseFrames += 1;
      scales.push(l.coreScale);
      ys.push(l.microY);
    });
    const turned = live.ringAngles.map((a, i) => Math.abs(a - start.rings[i]!));
    for (const a of turned) expect(a).toBeGreaterThan(1.5); // every ring layer rotates visibly within 40 s
    // rings run at different rates and in both directions
    expect(new Set(turned.map((a) => a.toFixed(1))).size).toBeGreaterThanOrEqual(4);
    expect(live.ringAngles[0]! - start.rings[0]!).toBeLessThan(0);
    expect(live.ringAngles[1]! - start.rings[1]!).toBeGreaterThan(0);
    expect(Math.abs(live.midAngle - start.mid)).toBeGreaterThan(0.5);
    expect(Math.abs(live.outerAngle - start.outer)).toBeGreaterThan(0.3);
    const movingGroups = driftRange.filter((r) => r.hi - r.lo > 0.01).length;
    expect(movingGroups).toBeGreaterThanOrEqual(8);
    expect(pulseFrames).toBeGreaterThan(40 * 60 * 0.2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.005);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.06); // positionY stays minimal
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.05);
  });

  it("ring rotation periods match the order (A 8-14 s cw, B 13-21 s ccw, outer 22-35 s) including the wobble", () => {
    const live = createLiveParams(idle);
    const t0 = live.ringAngles.slice();
    const periodOf = (i: number, from: number[], to: number[], seconds: number) => (2 * Math.PI * seconds) / Math.abs(to[i]! - from[i]!);
    run(live, idle, 60);
    const t1 = live.ringAngles.slice();
    expect(periodOf(0, t0, t1, 60)).toBeGreaterThanOrEqual(8);
    expect(periodOf(0, t0, t1, 60)).toBeLessThanOrEqual(14);
    expect(periodOf(1, t0, t1, 60)).toBeGreaterThanOrEqual(13);
    expect(periodOf(1, t0, t1, 60)).toBeLessThanOrEqual(21);
    for (const i of [2, 3, 4]) {
      expect(periodOf(i, t0, t1, 60)).toBeGreaterThanOrEqual(22);
      expect(periodOf(i, t0, t1, 60)).toBeLessThanOrEqual(35);
    }
  });
});

describe("data impulses", () => {
  const idle = targets("idle");

  it("are deterministic per seed, not on all rings at once, and different rings in a row", () => {
    const collect = (seed: number) => {
      const live = createLiveParams(idle);
      const active: string[] = [];
      let maxConcurrent = 0;
      let dt = 1 / 30;
      let time = 0;
      for (let i = 0; i < 30 * 120; i++) {
        time += dt;
        stepLiveParams(live, idle, { dt, time, audioRaw: 0, seed });
        const heads = Array.from(live.pulseHead).map((h) => (h >= 0 ? 1 : 0));
        const n = heads.reduce<number>((a, b) => a + b, 0);
        maxConcurrent = Math.max(maxConcurrent, n);
        active.push(heads.join(""));
      }
      return { active, maxConcurrent };
    };
    const a = collect(7);
    expect(collect(7).active).toEqual(a.active);
    expect(collect(8).active).not.toEqual(a.active);
    expect(a.maxConcurrent).toBeGreaterThan(0);
    expect(a.maxConcurrent).toBeLessThan(PULSE_RINGS);
    expect(a.maxConcurrent).toBeLessThanOrEqual(3);
    // idle: occasional, not constant
    const idleShare = a.active.filter((s) => s.includes("1")).length / a.active.length;
    expect(idleShare).toBeGreaterThan(0.15);
    expect(idleShare).toBeLessThan(0.85);
  });

  it("the test clock reproduces the live sequence at any time", () => {
    const live = createLiveParams(idle);
    const end = run(live, idle, 20);
    const fixed = createLiveParams(idle);
    stepLiveParams(fixed, idle, { dt: 0.016, time: end, audioRaw: 0, seed: 7, fixed: {} });
    const quantise = (a: Float32Array) => Array.from(a).map((h) => Math.round(h * 20));
    expect(quantise(fixed.pulseHead)).toEqual(quantise(live.pulseHead));
  });

  it("busy states fire more often than idle", () => {
    const share = (mode: "idle" | "working") => {
      const t = targets(mode);
      const live = createLiveParams(t);
      let n = 0;
      let total = 0;
      run(live, t, 60, (l) => {
        total += 1;
        n += l.pulseHead.filter((h) => h >= 0).length;
      });
      return n / total;
    };
    expect(share("working")).toBeGreaterThan(share("idle") * 1.5);
  });
});

describe("transitions (owner order section 17)", () => {
  it("idle -> listening settles in ~170 ms without a hard jump", () => {
    const idle = targets("idle");
    const listening = targets("listening");
    const live = createLiveParams(idle);
    run(live, idle, 1);
    const startValue = live.coreIntensity;
    stepLiveParams(live, listening, { dt: 1 / 60, time: 1.02, audioRaw: 0 });
    const first = live.coreIntensity;
    expect(first - startValue).toBeLessThan((listening.coreIntensity - idle.coreIntensity) * 0.45); // no snap
    run(live, listening, 0.25, undefined, 1.02);
    expect(live.coreIntensity).toBeGreaterThan(idle.coreIntensity + (listening.coreIntensity - idle.coreIntensity) * 0.9);
  });

  it("any -> error reacts within 150 ms; error -> recovered takes 0.7-1.1 s", () => {
    const idle = targets("idle");
    const error = targets("error");
    const live = createLiveParams(idle);
    run(live, idle, 0.5);
    let time = 0.5;
    const dt = 1 / 120;
    let reached = -1;
    for (let i = 0; i < 120; i++) {
      time += dt;
      stepLiveParams(live, error, { dt, time, audioRaw: 0 });
      if (reached < 0 && live.error > 0.63) reached = (i + 1) * dt; // 1 - e^-1 of the way
    }
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(0.15);
    // recovery
    let t95 = -1;
    for (let i = 0; i < 240; i++) {
      time += dt;
      stepLiveParams(live, idle, { dt, time, audioRaw: 0 });
      if (t95 < 0 && live.error < 0.05) t95 = (i + 1) * dt;
    }
    expect(t95).toBeGreaterThan(0.5);
    expect(t95).toBeLessThan(1.2);
  });

  it("the error entry glitch is short and then rests (no endless flicker)", () => {
    const idle = targets("idle");
    const error = targets("error");
    const live = createLiveParams(idle);
    stepLiveParams(live, error, { dt: 1 / 60, time: 0.016, audioRaw: 0 });
    expect(live.errorImpulse).toBeGreaterThan(0.9);
    run(live, error, 3, undefined, 0.016);
    expect(live.errorImpulse).toBeLessThan(0.01);
    const values: number[] = [];
    run(live, error, 6, (l) => values.push(l.error), 3.016);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.01);
  });
});

describe("audio frames", () => {
  const frame = (rms: number, bands = { low: rms, mid: rms, high: rms }) => {
    const f = createAudioFrame();
    Object.assign(f, { rms, peak: Math.min(1, rms * 1.2), ...bands, gateOpen: rms > 0.05, source: "analyser" });
    return f;
  };

  it("listening: input drives core, ring and particles; output frames are ignored", () => {
    const t = targets("listening");
    const live = createLiveParams(t);
    const quiet = createLiveParams(t);
    const silent = createAudioFrame();
    for (let i = 0; i < 90; i++) {
      stepLiveParams(live, t, { dt: 1 / 60, time: i / 60, audioIn: frame(0.9), audioOut: frame(0.9) });
      stepLiveParams(quiet, t, { dt: 1 / 60, time: i / 60, audioIn: frame(0.12), audioOut: silent });
    }
    expect(live.inRms).toBeCloseTo(0.9, 1);
    expect(live.outRms).toBe(0);
    expect(live.coreScale).toBeGreaterThan(quiet.coreScale);
    expect(live.coreLevel).toBeGreaterThan(quiet.coreLevel);
    expect(live.particleForce).toBeGreaterThan(quiet.particleForce);
    expect(live.speedMul).toBeGreaterThan(quiet.speedMul);
    expect(live.coreScale).toBeLessThanOrEqual(1.0025 + 0.0325 + 0.08 + 0.03);
  });

  it("transcribing and thinking shut the microphone out", () => {
    for (const mode of ["transcribing", "thinking"] as const) {
      const t = targets(mode);
      const live = createLiveParams(targets("listening"));
      for (let i = 0; i < 120; i++) stepLiveParams(live, t, { dt: 1 / 60, time: i / 60, audioIn: frame(1), audioOut: createAudioFrame() });
      expect(live.gainIn).toBeLessThan(0.01);
      expect(live.inRms).toBeLessThan(0.01);
      expect(live.waveIn).toBeLessThan(0.01);
    }
  });

  it("speaking: low -> core, mid -> segments, high -> particles", () => {
    const t = targets("speaking");
    const run2 = (bands: { low: number; mid: number; high: number }) => {
      const live = createLiveParams(t);
      for (let i = 0; i < 90; i++) stepLiveParams(live, t, { dt: 1 / 60, time: i / 60, audioIn: createAudioFrame(), audioOut: frame(0.6, bands) });
      return live;
    };
    const lowHeavy = run2({ low: 0.9, mid: 0.1, high: 0.1 });
    const midHeavy = run2({ low: 0.1, mid: 0.9, high: 0.1 });
    const highHeavy = run2({ low: 0.1, mid: 0.1, high: 0.9 });
    expect(lowHeavy.coreDrive).toBeGreaterThan(midHeavy.coreDrive);
    expect(midHeavy.segDrive).toBeGreaterThan(lowHeavy.segDrive);
    expect(highHeavy.particleForce).toBeGreaterThan(lowHeavy.particleForce);
  });

  it("peaks spawn radial pulse rings (rate limited) on the live clock", () => {
    const t = targets("speaking");
    const live = createLiveParams(t);
    let spawned = 0;
    let last = 0;
    for (let i = 0; i < 300; i++) {
      const level = i % 20 < 3 ? 0.95 : 0.1;
      stepLiveParams(live, t, { dt: 1 / 60, time: i / 60, audioIn: createAudioFrame(), audioOut: frame(level) });
      const active = live.radialAge.filter((a) => a >= 0).length;
      if (active > last) spawned += active - last;
      last = active;
    }
    expect(spawned).toBeGreaterThanOrEqual(5);
    expect(spawned).toBeLessThanOrEqual(25);
  });

  it("reduced motion keeps audio as a calm ring: no core kick, no particle force", () => {
    const t = targets("speaking", {}, resolveSettings({ animations: "reduced" }));
    expect(t.calm).toBe(1);
    expect(t.radialPulse).toBe(0);
    expect(t.particleDrive).toBe(0);
    expect(t.waveOut).toBe(1);
    const live = createLiveParams(t);
    const idleLike = createLiveParams(t);
    for (let i = 0; i < 90; i++) {
      stepLiveParams(live, t, { dt: 1 / 60, time: i / 60, audioIn: createAudioFrame(), audioOut: frame(1) });
      stepLiveParams(idleLike, t, { dt: 1 / 60, time: i / 60, audioIn: createAudioFrame(), audioOut: createAudioFrame() });
    }
    expect(Math.abs(live.coreScale - idleLike.coreScale)).toBeLessThan(0.005);
    expect(Math.abs(live.speedMul - 1)).toBeLessThan(0.01);
    expect(live.outRms).toBeGreaterThan(0.9); // the ring still gets the level
  });

  it("the step does not allocate objects per frame", () => {
    const t = targets("working");
    const live = createLiveParams(t);
    const a = live.ringAngles;
    const drift = live.drift;
    const heads = live.pulseHead;
    for (let i = 0; i < 100; i++) stepLiveParams(live, t, { dt: 1 / 60, time: i / 60, audioIn: frame(0.5), audioOut: frame(0.5) });
    expect(live.ringAngles).toBe(a);
    expect(live.drift).toBe(drift);
    expect(live.pulseHead).toBe(heads);
  });
});
