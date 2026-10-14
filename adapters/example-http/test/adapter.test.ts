import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry, createMapContext, systemClock, type RegistryEvent } from "@jarvis/adapter-core";
import { createFakeUpstream, type FakeUpstream } from "@jarvis/adapter-testkit";
import { PROVIDER_ID, createTaskMapping, exampleTasksFactory, toRawState, toTaskStatus } from "../src";
import { installExampleTasks, makeRawItem } from "./fake-example-tasks";

const upstreams: FakeUpstream[] = [];
const registries: AdapterRegistry[] = [];
afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.shutdownAll()));
  await Promise.all(upstreams.splice(0).map((upstream) => upstream.close()));
});

async function boot(pollIntervalMs = 0) {
  const upstream = await createFakeUpstream();
  upstreams.push(upstream);
  const state = installExampleTasks(upstream, { count: 5, pageSize: 2 });
  const events: RegistryEvent[] = [];
  const registry = new AdapterRegistry({
    allowlist: [PROVIDER_ID],
    secretProvider: ({ field }) => (field === "apiToken" ? "token-for-tests-123" : undefined),
    onEvent: (event) => events.push(event),
  });
  registries.push(registry);
  registry.registerFactory(PROVIDER_ID, exampleTasksFactory);
  const [report] = await registry.initialize({
    mode: "live",
    adapters: {
      tasks: {
        provider: PROVIDER_ID,
        enabled: true,
        config: {
          baseUrl: upstream.url,
          timeoutMs: 500,
          maxAttempts: 2,
          retryBaseDelayMs: 5,
          pollIntervalMs,
        },
      },
    },
  });
  return { upstream, state, registry, events, report };
}

const call = { correlationId: "corr_00000000000000000000000001" };

describe("mapping", () => {
  it("maps provider states and closed reasons to task statuses", () => {
    expect(toTaskStatus("open", null)).toBe("todo");
    expect(toTaskStatus("in_progress", null)).toBe("running");
    expect(toTaskStatus("blocked", null)).toBe("waiting");
    expect(toTaskStatus("closed", "completed")).toBe("done");
    expect(toTaskStatus("closed", "cancelled")).toBe("cancelled");
    expect(toTaskStatus("closed", "failed")).toBe("failed");
    expect(toRawState("cancelled")).toEqual({ state: "closed", closed_reason: "cancelled" });
  });

  it("maps priorities, progress and owner to canonical fields", () => {
    const mapping = createTaskMapping(() => Date.parse("2026-10-13T21:00:00.000Z"));
    const context = createMapContext({
      adapterId: "example-tasks-http",
      system: "example-tasks",
      clock: systemClock,
    });
    const task = mapping.mapItem(makeRawItem(2, { prio: 1, pct: 40 }), context);
    expect(task).toMatchObject({
      priority: "P0",
      status: "running",
      progress: { mode: "determinate", value: 0.4 },
      runtimeMs: 3_600_000,
      agentName: "hermes-bot-1",
    });
    expect(task.agentId).toMatch(/^agent_[0-9A-Za-z]{26}$/);
    expect(task.source).toMatchObject({
      adapterId: "example-tasks-http",
      system: "example-tasks",
      externalId: "itm_2",
    });
    const unknown = mapping.mapItem(makeRawItem(1, { pct: null, owner_bot: null }), context);
    expect(unknown).toMatchObject({ progress: { mode: "none", value: null }, agentId: null });
  });
});

describe("ExampleTasksAdapter behind the registry", () => {
  it("is allowlisted, ONLINE and exposes the declared capabilities", async () => {
    const { registry, report } = await boot();
    expect(report).toMatchObject({ adapterId: "example-tasks-http", state: "ONLINE" });
    const { tasks } = registry.aggregateCapabilities().modules;
    expect(tasks).toEqual({
      read: true,
      create: true,
      update: true,
      cancel: true,
      retry: false,
      pause: false,
      resume: false,
      stream: true,
      sources: ["example-tasks-http"],
    });
  });

  it("lists, gets, creates (idempotent), updates with If-Match and cancels through the contract-validating proxy", async () => {
    const { registry, state } = await boot();
    const port = registry.getPort("tasks");
    const page = await port.listTasks({ limit: 2 }, call);
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const fetched = await port.getTask({ id: page.items[0]?.id ?? "" }, call);
    expect(fetched.data.id).toBe(page.items[0]?.id);

    const key = "idem_00000000000000000000000009";
    const created = await port.createTask?.(
      { body: { title: "Neue Aufgabe", priority: "P1" } },
      { ...call, idempotencyKey: key },
    );
    const again = await port.createTask?.(
      { body: { title: "Neue Aufgabe", priority: "P1" } },
      { ...call, idempotencyKey: key },
    );
    expect(created?.data.priority).toBe("P1");
    expect(again?.data.id).toBe(created?.data.id);
    expect(state.created).toBe(1);

    const id = created?.data.id ?? "";
    const updated = await port.updateTask?.(
      { id, body: { status: "waiting", priority: "P0" } },
      { ...call, ifMatchVersion: created?.data.version ?? 1 },
    );
    expect(updated?.data).toMatchObject({ status: "waiting", priority: "P0", version: 2 });
    await expect(
      port.updateTask?.({ id, body: { title: "Zu spät" } }, { ...call, ifMatchVersion: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const cancelled = await port.cancelTask?.(
      { id, body: { reason: "nicht mehr nötig" } },
      { ...call, idempotencyKey: "idem_0000000000000000000000000a" },
    );
    expect(cancelled?.data.status).toBe("cancelled");
  });

  it("filters by status after mapping and rejects unknown ids", async () => {
    const { registry } = await boot();
    const port = registry.getPort("tasks");
    const running = await port.listTasks({ status: ["running"] }, call);
    expect(running.items.length).toBeGreaterThan(0);
    expect(running.items.every((task) => task.status === "running")).toBe(true);
    await expect(port.getTask({ id: "task_00000000000000000000000000" }, call)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("polls events in the background and forwards canonical events to the hub", async () => {
    const { state, events } = await boot(20);
    state.publishEvents(4);
    await expect
      .poll(() => events.filter((e) => e.event.type.startsWith("jarvis.task.")).length, { timeout: 2_000 })
      .toBe(4);
    expect(
      events
        .filter((e) => e.adapterId === "example-tasks-http" && e.event.type.startsWith("jarvis.task."))
        .map((e) => e.event.type),
    ).toEqual([
      "jarvis.task.created",
      "jarvis.task.updated",
      "jarvis.task.progress",
      "jarvis.task.completed",
    ]);
  });

  it("reports health offline with a German message and no secret when the token is rejected", async () => {
    const { registry, upstream } = await boot();
    upstream.fault("GET", "/items", { status: 401 });
    const health = await registry.checkHealth("example-tasks-http");
    expect(health.lastError).toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Authentifizierung fehlgeschlagen (API-Token prüfen)",
    });
    expect(JSON.stringify(health)).not.toContain("token-for-tests-123");
  });
});
