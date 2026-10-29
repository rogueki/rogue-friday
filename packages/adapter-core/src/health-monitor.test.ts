import { describe, expect, it } from "vitest";
import { createManualClock } from "./clock";
import { HealthMonitor } from "./health-monitor";
import { AdapterLifecycleMachine } from "./lifecycle";
import { noopLogger } from "./logger";
import type { AdapterEventInput, AdapterHealthReport } from "./types";

function setup(options: { failureThreshold?: number; degradedLatencyMs?: number } = {}) {
  const clock = createManualClock();
  const lifecycle = new AdapterLifecycleMachine();
  const events: AdapterEventInput[] = [];
  const state = {
    report: { status: "online", latencyMs: 12 } as AdapterHealthReport,
    throwOnCheck: false,
    capabilities: ["tasks.read"],
    capabilityChanges: [] as string[][],
    checkOptions: [] as boolean[],
    waitForCheck: undefined as Promise<void> | undefined,
  };
  const monitor = new HealthMonitor({
    adapterId: "test-tasks",
    lifecycle,
    clock,
    logger: noopLogger,
    emit: (event) => events.push(event),
    onCapabilitiesChanged: (set) => state.capabilityChanges.push(set.capabilities),
    intervalMs: 1000,
    ...options,
    adapter: {
      async healthCheck(checkOptions) {
        state.checkOptions.push(checkOptions?.forceRefresh === true);
        await state.waitForCheck;
        if (state.throwOnCheck) throw new Error("kaputt");
        return state.report;
      },
      async getCapabilities() {
        return { capabilities: state.capabilities };
      },
    },
  });
  lifecycle.transition("INITIALIZING", "test");
  return { clock, lifecycle, events, state, monitor };
}

describe("HealthMonitor", () => {
  it("waits for a normal in-flight probe before an explicit fresh check", async () => {
    const { monitor, state } = setup();
    let release!: () => void;
    state.waitForCheck = new Promise<void>((resolve) => { release = resolve; });
    const automatic = monitor.checkNow();
    const manual = monitor.checkNow({ forceRefresh: true });
    expect(state.checkOptions).toEqual([false]);
    release();
    await Promise.all([automatic, manual]);
    expect(state.checkOptions).toEqual([false, true]);
  });

  it("INITIALIZING -> ONLINE on the first successful check and records latency / lastSuccessAt", async () => {
    const { monitor, lifecycle, events, clock } = setup();
    const health = await monitor.checkNow();
    expect(lifecycle.state).toBe("ONLINE");
    expect(health).toMatchObject({
      status: "online",
      lifecycle: "ONLINE",
      latencyMs: 12,
      lastError: null,
      consecutiveFailures: 0,
      circuit: "closed",
    });
    expect(health.lastSuccessAt).toBe(new Date(clock.now()).toISOString());
    expect(events.map((e) => e.type)).toEqual(["friday.adapter.health_changed"]);
  });

  it("carries the upstream version a successful check reports and keeps it while the upstream is down", async () => {
    const { monitor, state } = setup();
    expect("remoteVersion" in (await monitor.checkNow())).toBe(false);
    state.report = { status: "online", latencyMs: 12, remoteVersion: "git.0e427d7" };
    expect((await monitor.checkNow()).remoteVersion).toBe("git.0e427d7");
    state.report = { status: "offline", latencyMs: null, message: "weg" };
    expect((await monitor.checkNow()).remoteVersion).toBe("git.0e427d7");
  });

  it("goes ONLINE -> DEGRADED on the first failure and OFFLINE at the failure threshold", async () => {
    const { monitor, lifecycle, state } = setup({ failureThreshold: 3 });
    await monitor.checkNow();
    state.report = { status: "offline", latencyMs: null, message: "weg" };
    await monitor.checkNow();
    expect(lifecycle.state).toBe("DEGRADED");
    await monitor.checkNow();
    expect(lifecycle.state).toBe("DEGRADED");
    const health = await monitor.checkNow();
    expect(lifecycle.state).toBe("OFFLINE");
    expect(health).toMatchObject({
      status: "offline",
      consecutiveFailures: 3,
      lastError: { code: "ADAPTER_UNAVAILABLE", message: "weg" },
    });
  });

  it("recovers OFFLINE -> RECOVERING -> ONLINE and resets the failure counter", async () => {
    const { monitor, lifecycle, state } = setup({ failureThreshold: 1 });
    state.report = { status: "offline", latencyMs: null, message: "weg" };
    await monitor.checkNow();
    expect(lifecycle.state).toBe("OFFLINE");

    const seen: string[] = [];
    lifecycle.onChange((change) => seen.push(`${change.from}->${change.to}`));
    state.report = { status: "online", latencyMs: 8 };
    const health = await monitor.checkNow();
    expect(seen).toEqual(["OFFLINE->RECOVERING", "RECOVERING->ONLINE"]);
    expect(health).toMatchObject({ lifecycle: "ONLINE", consecutiveFailures: 0, lastError: null });
  });

  it("treats a slow online report as DEGRADED", async () => {
    const { monitor, lifecycle, state } = setup({ degradedLatencyMs: 100 });
    state.report = { status: "online", latencyMs: 500 };
    const health = await monitor.checkNow();
    expect(lifecycle.state).toBe("DEGRADED");
    expect(health.lastError?.code).toBe("ADAPTER_TIMEOUT");
  });

  it("a healthCheck() that throws is reported as offline instead of crashing the monitor", async () => {
    const { monitor, lifecycle, state } = setup();
    state.throwOnCheck = true;
    const health = await monitor.checkNow();
    expect(lifecycle.state).toBe("OFFLINE");
    expect(health.lastError?.code).toBe("INTERNAL");
  });

  it("emits health_changed only when something changed", async () => {
    const { monitor, events } = setup();
    await monitor.checkNow();
    await monitor.checkNow();
    await monitor.checkNow();
    expect(events).toHaveLength(1);
  });

  it("emits capabilities_changed after recovery only when the set differs", async () => {
    const { monitor, state } = setup({ failureThreshold: 1 });
    monitor.rememberCapabilities({ capabilities: ["tasks.read"] });
    state.report = { status: "offline", latencyMs: null };
    await monitor.checkNow();
    state.report = { status: "online", latencyMs: 5 };
    await monitor.checkNow();
    expect(state.capabilityChanges).toEqual([]);

    state.report = { status: "offline", latencyMs: null };
    await monitor.checkNow();
    state.capabilities = ["tasks.read", "tasks.create"];
    state.report = { status: "online", latencyMs: 5 };
    await monitor.checkNow();
    expect(state.capabilityChanges).toEqual([["tasks.read", "tasks.create"]]);
  });

  it("re-reads capabilities on every successful check, not only after recovery", async () => {
    const { monitor, state, lifecycle } = setup();
    monitor.rememberCapabilities({ capabilities: ["tasks.read"] });
    await monitor.checkNow();
    expect(lifecycle.state).toBe("ONLINE");
    expect(state.capabilityChanges).toEqual([]);

    state.capabilities = ["tasks.read", "tasks.create"];
    await monitor.checkNow();
    expect(state.capabilityChanges).toEqual([["tasks.read", "tasks.create"]]);

    // unchanged set: no further notification
    await monitor.checkNow();
    expect(state.capabilityChanges).toHaveLength(1);

    // a degraded (still serving) check also refreshes
    state.report = { status: "degraded", latencyMs: 20, message: "langsam" };
    state.capabilities = ["tasks.read"];
    await monitor.checkNow();
    expect(lifecycle.state).toBe("DEGRADED");
    expect(state.capabilityChanges).toEqual([["tasks.read", "tasks.create"], ["tasks.read"]]);
  });

  it("does not ask for capabilities while the adapter is failing", async () => {
    const { monitor, state } = setup({ failureThreshold: 1 });
    let calls = 0;
    const original = state.capabilities;
    Object.defineProperty(state, "capabilities", { get: () => (calls += 1, original) });
    state.report = { status: "offline", latencyMs: null };
    await monitor.checkNow();
    expect(calls).toBe(0);
  });

  it("polls on the injected clock and stops cleanly", async () => {
    const { monitor, clock, state } = setup();
    monitor.start();
    expect(clock.pending()).toBe(1);
    await clock.advance(1000);
    expect(monitor.snapshot().lifecycle).toBe("ONLINE");
    state.report = { status: "degraded", latencyMs: 40, message: "langsam" };
    await clock.advance(1000);
    expect(monitor.snapshot()).toMatchObject({ status: "degraded", lastError: { message: "langsam" } });
    monitor.stop();
    expect(clock.pending()).toBe(0);
  });

  it("does not check after shutdown", async () => {
    const { monitor, lifecycle } = setup();
    await monitor.checkNow();
    lifecycle.transition("STOPPING", "test");
    lifecycle.transition("STOPPED", "test");
    const health = await monitor.checkNow();
    expect(health.lifecycle).toBe("STOPPED");
  });
});

describe("AdapterLifecycleMachine", () => {
  it("rejects illegal transitions", () => {
    const lifecycle = new AdapterLifecycleMachine();
    expect(() => lifecycle.transition("ONLINE", "x")).toThrow(/Lifecycle/);
    lifecycle.transition("INITIALIZING", "x");
    lifecycle.transition("ONLINE", "x");
    expect(lifecycle.canTransition("RECOVERING")).toBe(false);
    lifecycle.transition("OFFLINE", "x");
    expect(lifecycle.canTransition("RECOVERING")).toBe(true);
  });
});
