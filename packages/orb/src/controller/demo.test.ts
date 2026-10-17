import { describe, expect, it } from "vitest";
import { createInputs } from "../audio/frame";
import { createOrbController } from "./createOrbController";
import { createOrbDemo, type OrbDemoName } from "./demo";
import type { OrbMode } from "./types";

/** Deterministic scheduler + clock shared by the controller and the demo. */
function harness() {
  let now = 1000;
  const queue: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  const controller = createOrbController({ now: () => now, epochNow: () => 1_700_000_000_000 + now, seed: 3 });
  const demo = createOrbDemo(controller, {
    now: () => now,
    seed: 3,
    schedule: (fn, ms) => {
      const item = { at: now + ms, fn, cancelled: false };
      queue.push(item);
      return () => {
        item.cancelled = true;
      };
    },
  });
  const inputs = createInputs();
  /** Advances the clock in 50 ms ticks, running due steps and pulling frames, and records every mode change. */
  const play = (ms: number, modes: OrbMode[]) => {
    const end = now + ms;
    while (now < end) {
      now += 50;
      for (;;) {
        const due = queue.filter((q) => !q.cancelled && q.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.cancelled = true;
        due.fn();
      }
      controller.readFrame(now, inputs);
      const m = controller.getState().status.mode;
      if (modes[modes.length - 1] !== m) modes.push(m);
    }
  };
  return { controller, demo, play, inputs, queue };
}

describe("orb demo sequences", () => {
  it("auto demo: idle -> listening -> transcribing -> thinking -> working -> speaking -> success -> idle (through the bridge)", () => {
    const { demo, play } = harness();
    const modes: OrbMode[] = [];
    demo.start("auto");
    expect(demo.running).toBe(true);
    expect(demo.name).toBe("auto");
    play(30_000, modes);
    const order = ["idle", "listening", "transcribing", "thinking", "working", "speaking", "working", "success", "idle"];
    expect(modes).toEqual(order);
    expect(demo.running).toBe(false);
  });

  it("the speaking step shows parallel background work with real (non-invented) progress", () => {
    const { controller, demo, play, inputs } = harness();
    demo.start("auto");
    const modes: OrbMode[] = [];
    play(20_000, modes); // inside the speaking phase (18.2 s .. 23.2 s)
    const s = controller.getState();
    expect(s.status.mode).toBe("speaking");
    expect(s.layers.backgroundWork).toBe("working");
    expect(s.status.activeAgentCount).toBe(3);
    expect(s.status.progressMode).toBe("determinate");
    expect(s.status.progress).toBeCloseTo(0.8);
    expect(inputs.output.rms).toBeGreaterThanOrEqual(0);
  });

  it("voice demo ends back in idle and drives both audio directions", () => {
    const { demo, play, inputs } = harness();
    const modes: OrbMode[] = [];
    demo.start("voice");
    let maxIn = 0;
    let maxOut = 0;
    const end = 20_000;
    for (let t = 0; t < end; t += 500) {
      play(500, modes);
      maxIn = Math.max(maxIn, inputs.input.rms);
      maxOut = Math.max(maxOut, inputs.output.rms);
    }
    expect(modes).toEqual(["idle", "listening", "transcribing", "thinking", "speaking", "idle"]);
    expect(maxIn).toBeGreaterThan(0.2);
    expect(maxOut).toBeGreaterThan(0.2);
  });

  it("working demo: determinate progress climbs, then success -> idle", () => {
    const { controller, demo, play } = harness();
    const modes: OrbMode[] = [];
    demo.start("working");
    play(4000, modes);
    expect(controller.getState().status.progressMode).toBe("indeterminate");
    play(6000, modes);
    expect(controller.getState().status.progressMode).toBe("determinate");
    play(12_000, modes);
    expect(modes).toEqual(["idle", "working", "success", "idle"]);
  });

  it("error recovery demo: warning, then error, then clean recovery", () => {
    const { demo, play } = harness();
    const modes: OrbMode[] = [];
    demo.start("errorRecovery");
    play(24_000, modes);
    expect(modes).toEqual(["idle", "warning", "idle", "working", "error", "working", "success", "idle"]);
  });

  it("stop() cancels pending steps and resets the controller; start() can switch sequences", () => {
    const { controller, demo, play, queue } = harness();
    const modes: OrbMode[] = [];
    demo.start("voice");
    play(2000, modes);
    expect(controller.getState().status.mode).toBe("listening");
    demo.stop();
    expect(demo.running).toBe(false);
    expect(controller.getState().status.mode).toBe("idle");
    expect(queue.filter((q) => !q.cancelled)).toHaveLength(0);
    for (const name of ["auto", "working"] as OrbDemoName[]) {
      demo.start(name);
      expect(demo.name).toBe(name);
    }
  });

  it("is deterministic: the same seed produces the same audio levels", () => {
    const levels = () => {
      const { demo, play, inputs } = harness();
      demo.start("voice");
      const out: number[] = [];
      for (let i = 0; i < 40; i++) {
        play(250, []);
        out.push(Math.round(inputs.input.rms * 1000));
      }
      return out;
    };
    expect(levels()).toEqual(levels());
  });
});
