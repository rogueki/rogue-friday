import type { FridayEvent } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { MockWorld, SCENARIO_DEFINITIONS, ScenarioEngine, scenarioDuration } from "../src";
import { eventProblems, record, validator } from "./support";

const ids = SCENARIO_DEFINITIONS.map((definition) => definition.id);

describe("scenario catalog", () => {
  it("contains all 14 mandatory scenarios", () => {
    expect(ids).toEqual([
      "clean-idle",
      "listening",
      "voice-pipeline",
      "multi-agent-working",
      "syncing",
      "approval-waiting",
      "critical-alert",
      "partial-outage",
      "adapter-recovery",
      "empty-new-installation",
      "high-load",
      "long-german-text",
      "reduced-motion",
      "webgl-failure",
    ]);
  });

  it("exposes contract-conform Scenario objects", () => {
    const engine = ScenarioEngine.for(new MockWorld());
    for (const scenario of engine.list()) {
      const result = validator.validate("Scenario", scenario);
      expect(result.errors).toEqual([]);
      expect(scenario.steps[0]?.delayMs).toBe(0);
    }
  });
});

describe.each(ids)("scenario %s", (id) => {
  it("runs to completion on the mock clock with the expected orb sequence", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    const recorder = record(world);
    const definition = engine.getDefinition(id);

    const started = engine.play(id);
    expect(started.running).toBe(true);
    expect(started.activeScenarioId).toBe(id);

    // Every step must leave the orb in the declared mode.
    const t0 = world.clock.now();
    const modeAfterStep = new Map<number, string>();
    for (const [index, step] of definition.steps.entries()) {
      world.clock.advance(Math.max(0, t0 + step.at + 1 - world.clock.now()));
      if (step.orbMode) modeAfterStep.set(index, world.orbSnapshot().status.mode);
    }
    const final = engine.runToCompletion(scenarioDuration(definition) + 5_000);
    expect(final.running).toBe(false);

    for (const [index, step] of definition.steps.entries()) {
      if (step.orbMode) expect({ step: step.label, mode: modeAfterStep.get(index) }).toEqual({ step: step.label, mode: step.orbMode });
    }
    expect(engine.orbModeLog).toEqual(definition.expectedOrbModes);
    expect(eventProblems(recorder.events)).toEqual([]);
    expect(world.verifyAudit().valid).toBe(true);
  });

  it("is deterministic: two runs produce the same event stream", () => {
    const run = (): string[] => {
      const world = new MockWorld();
      const engine = ScenarioEngine.for(world);
      const types: string[] = [];
      world.events.subscribe((event: FridayEvent) => types.push(`${event.sequence}:${event.id}:${event.type}:${event.time}`));
      engine.play(id);
      engine.runToCompletion(scenarioDuration(engine.getDefinition(id)) + 5_000);
      return types;
    };
    expect(run()).toEqual(run());
  });
});

describe("scenario details", () => {
  it("listening emits audio levels at about 12 Hz using the fixtures", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    const levels: { level: number; at: string }[] = [];
    world.events.subscribe((event) => {
      if (event.type === "friday.voice.audio_level") levels.push({ level: event.data.level, at: event.data.at });
    });
    engine.play("listening");
    engine.runToCompletion(20_000);
    const perSecond = levels.length / 8;
    expect(perSecond).toBeGreaterThan(10);
    expect(perSecond).toBeLessThan(14);
    expect(Math.max(...levels.map((entry) => entry.level))).toBeGreaterThan(0.9);
    expect(Math.min(...levels.map((entry) => entry.level))).toBeLessThan(0.05);
  });

  it("voice-pipeline publishes partial and final transcripts and tts events", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    const types: string[] = [];
    world.events.subscribe((event) => types.push(event.type));
    engine.play("voice-pipeline");
    engine.runToCompletion(20_000);
    expect(types).toContain("friday.voice.transcript_partial");
    expect(types).toContain("friday.voice.transcript_final");
    expect(types).toContain("friday.voice.tts_started");
    expect(types).toContain("friday.voice.tts_ended");
  });

  it("multi-agent-working shows 3 agents, 2 tasks, one determinate and one indeterminate progress", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    engine.play("multi-agent-working");
    world.clock.advance(1_000);
    const orb = world.orbSnapshot();
    expect(orb.status.activityText).toBe("3 AGENTEN AKTIV");
    expect(orb.status.progressMode).toBe("determinate");
    expect(orb.layers.activeAgentIds).toHaveLength(3);
    const running = world.state.tasks.filter((task) => task.status === "running");
    expect(running.map((task) => task.progress.mode).sort()).toEqual(["determinate", "indeterminate"]);
  });

  it("critical-alert escalates Dashboard -> Telegram -> WhatsApp -> Telefon with timestamps", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    engine.play("critical-alert");
    world.clock.advance(1);
    const alert = world.state.notifications.find((notification) => notification.priority === "P0" && notification.status === "open");
    expect(alert?.escalation.map((step) => [step.channel, step.state])).toEqual([
      ["dashboard", "sent"],
      ["telegram", "pending"],
      ["whatsapp", "pending"],
      ["phone", "pending"],
    ]);
    world.clock.advance(85_000);
    const done = world.state.notifications.find((notification) => notification.id === alert?.id);
    expect(done?.escalation.every((step) => step.state === "sent" && step.sentAt)).toBe(true);
    const times = done?.escalation.map((step) => Date.parse(step.sentAt as string)) ?? [];
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(world.orbSnapshot().status.mode).toBe("error");
    expect(world.tasks.list().items.length).toBeGreaterThan(0);
  });

  it("critical-alert escalation is scaled by the playback speed", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    engine.play("critical-alert", { speed: 4 });
    world.clock.advance(21_000);
    const alert = world.state.notifications.find((notification) => notification.priority === "P0");
    expect(alert?.escalation.every((step) => step.state === "sent")).toBe(true);
  });

  it("partial-outage: mail offline, tasks online, overview degraded but usable", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    engine.play("partial-outage");
    world.clock.advance(100);
    expect(() => world.communication.listThreads()).toThrowError(/nicht erreichbar/);
    expect(world.tasks.list().items.length).toBeGreaterThan(0);
    const overview = world.meta.getOverview();
    expect(overview.degradedSections.map((section) => section.adapterId)).toEqual(["mock-communication"]);
    expect(overview.importantMailCount).toBe(0);
    expect(world.freshness("communication").state).toBe("offline-cache");
    expect(world.freshness("tasks").state).toBe("fresh");
    expect(validator.validate("Overview", overview).errors).toEqual([]);
  });

  it("adapter-recovery walks online -> timeout -> degraded -> offline -> recovering -> online", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    const lifecycles: string[] = [];
    const errors: (string | undefined)[] = [];
    world.events.subscribe((event) => {
      if (event.type === "friday.adapter.health_changed" && event.data.adapterId === "mock-calendar") {
        lifecycles.push(`${event.data.status}/${event.data.lifecycle}`);
        errors.push(event.data.lastError?.code);
      }
    });
    engine.play("adapter-recovery");
    engine.runToCompletion(60_000);
    expect(lifecycles).toEqual(["degraded/DEGRADED", "degraded/DEGRADED", "offline/OFFLINE", "degraded/RECOVERING", "online/ONLINE"]);
    expect(errors[0]).toBe("ADAPTER_TIMEOUT");
  });

  it("empty-new-installation has no data and every list is empty", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    engine.play("empty-new-installation");
    expect(world.tasks.list().items).toEqual([]);
    expect(world.memory.list().items).toEqual([]);
    expect(world.agents.list().pageInfo).toMatchObject({ hasNextPage: false, totalCount: 0 });
    expect(world.communication.listChannels().items.every((channel) => channel.status === "not_configured")).toBe(true);
    expect(validator.validate("Overview", world.meta.getOverview()).errors).toEqual([]);
  });

  it("high-load loads 1000 tasks, 10000 activity events and 100 agents", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    engine.play("high-load");
    expect(world.tasks.list({ limit: 200 }).pageInfo.totalCount).toBe(1000);
    expect(world.activity.list({ limit: 200 }).pageInfo.totalCount).toBe(10_000);
    expect(world.agents.list({ limit: 200 }).pageInfo.totalCount).toBe(100);
  });

  it("long-german-text contains very long titles with umlauts", () => {
    const world = new MockWorld();
    ScenarioEngine.for(world).play("long-german-text");
    const longest = Math.max(...world.state.tasks.map((task) => task.title.length));
    expect(longest).toBeGreaterThan(150);
    expect(Math.max(...world.state.tasks.map((task) => task.title.length))).toBeLessThanOrEqual(300);
    expect(world.state.threads.some((thread) => thread.subject.length > 120 && /[äöüß]/.test(thread.subject))).toBe(true);
  });

  it("reduced-motion cycles all 14 orb modes", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    engine.play("reduced-motion");
    engine.runToCompletion(60_000);
    expect(new Set(engine.orbModeLog)).toEqual(new Set(["idle", "booting", "listening", "transcribing", "thinking", "syncing", "working", "speaking", "waiting_approval", "success", "warning", "error", "offline", "paused"]));
    expect(world.meta.getMeta().features.reducedMotion).toBe(true);
  });

  it("webgl-failure sets the 2D fallback hint and announces a resync", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    const types: string[] = [];
    world.events.subscribe((event) => types.push(event.type));
    engine.play("webgl-failure");
    world.clock.advance(10);
    expect(world.meta.getMeta().features.forceOrbFallback2D).toBe(true);
    expect(types).toContain("friday.status.resync_required");
  });

  it("control(): clock, latency, errors, adapters, capabilities, forced orb and reset", () => {
    const world = new MockWorld();
    const engine = ScenarioEngine.for(world);
    const before = world.nowIso();
    engine.control({ action: "clock_advance", ms: 90_000 });
    expect(Date.parse(world.nowIso()) - Date.parse(before)).toBe(90_000);
    engine.control({ action: "latency", adapterId: "mock-tasks", ms: 250 });
    engine.control({ action: "error_rate", adapterId: "mock-memory", rate: 0.5 });
    engine.control({ action: "adapter_offline", adapterId: "mock-calendar", offline: true });
    engine.control({ action: "capability_toggle", module: "tasks", capability: "create", enabled: false });
    const state = engine.control({ action: "force_orb_state", mode: "speaking", audioLevel: 0.5 });
    expect(state.forcedOrbMode).toBe("speaking");
    expect(state.adapterOverrides).toEqual(expect.arrayContaining([{ adapterId: "mock-calendar", offline: true }, { adapterId: "mock-tasks", offline: false, latencyMs: 250 }, { adapterId: "mock-memory", offline: false, errorRate: 0.5 }]));
    expect(state.capabilityOverrides).toEqual([{ module: "tasks", capability: "create", enabled: false }]);
    expect(validator.validate("ScenarioState", state).errors).toEqual([]);
    const reset = engine.control({ action: "reset" });
    expect(reset.adapterOverrides).toEqual([]);
    expect(reset.forcedOrbMode).toBeNull();
    expect(reset.capabilityOverrides).toEqual([]);
    expect(world.nowIso()).toBe(before);
  });
});
