import { describe, expect, it } from "vitest";
import {
  AdapterRegistry,
  createManualClock,
  createMemoryLogger,
  type RegistryConfig,
  type RegistryEvent,
} from "../src";
import { CALL, FRESH, createTestFactory, createTestAdapter, makeManifest, makeTask } from "./helpers";

const PROVIDER = "test-tasks-provider";
const config = (overrides: Partial<RegistryConfig["adapters"]["tasks"]> = {}): RegistryConfig => ({
  mode: "live",
  adapters: {
    tasks: {
      provider: PROVIDER,
      enabled: true,
      config: { baseUrl: "http://upstream.invalid" },
      retry: false,
      ...overrides,
    },
  },
});

function setup(allow: string[] = [PROVIDER]) {
  const clock = createManualClock();
  const events: RegistryEvent[] = [];
  const logger = createMemoryLogger();
  const registry = new AdapterRegistry({
    allowlist: allow,
    clock,
    logger,
    secretProvider: ({ field }) => (field === "apiToken" ? "tok_SUPERSECRET_123" : undefined),
    onEvent: (event) => events.push(event),
    healthIntervalMs: 1000,
  });
  const { factory, control, created } = createTestFactory(PROVIDER);
  if (allow.includes(PROVIDER)) registry.registerFactory(PROVIDER, factory);
  return { registry, clock, events, logger, control, factory, created };
}

describe("AdapterRegistry allowlist", () => {
  it("refuses to register a provider that is not allowlisted", () => {
    const { registry } = setup([]);
    expect(() => registry.registerFactory("evil", { ...createTestFactory("evil").factory })).toThrow(
      /Allowlist/,
    );
  });

  it("refuses a configured provider outside the allowlist with a clear error and keeps the others running", async () => {
    const { registry } = setup();
    const reports = await registry.initialize({
      mode: "live",
      adapters: {
        tasks: { provider: PROVIDER, enabled: true, config: { baseUrl: "http://x" } },
        voice: { provider: "unlisted-voice", enabled: true, config: {} },
      },
    });
    const voice = reports.find((r) => r.category === "voice");
    expect(voice?.state).toBe("OFFLINE");
    expect(voice?.error?.message).toMatch(/nicht in der Allowlist/);
    expect(reports.find((r) => r.category === "tasks")?.state).toBe("ONLINE");
    expect(registry.listFailures()).toHaveLength(1);
  });

  it("refuses a factory whose category does not match the config slot", async () => {
    const { registry } = setup();
    const reports = await registry.initialize({
      mode: "live",
      adapters: { voice: { provider: PROVIDER, enabled: true, config: {} } },
    });
    expect(reports[0]?.error?.message).toMatch(/Kategorie/);
  });

  it("refuses mock-only factories in live mode", async () => {
    const registry = new AdapterRegistry({ allowlist: [PROVIDER], clock: createManualClock() });
    const { factory } = createTestFactory(PROVIDER);
    registry.registerFactory(PROVIDER, { ...factory, modes: ["mock"] });
    const reports = await registry.initialize(config());
    expect(reports[0]?.error?.message).toMatch(/Modus 'live'/);
  });
});

describe("AdapterRegistry initialization", () => {
  it("initializes, validates config, hands secrets only through getSecret and keeps them out of config", async () => {
    const { registry, control } = setup();
    const [report] = await registry.initialize(config());
    expect(report).toMatchObject({ category: "tasks", adapterId: "test-tasks", state: "ONLINE" });
    const context = control.context;
    expect(context?.config).toEqual({ baseUrl: "http://upstream.invalid", timeoutMs: 1000 });
    expect(JSON.stringify(context?.config)).not.toContain("SUPERSECRET");
    expect(context?.getSecret("apiToken")).toBe("tok_SUPERSECRET_123");
    expect(context?.getSecret("somethingElse")).toBeUndefined();
  });

  it("marks an adapter with invalid config OFFLINE with lastError, without throwing and without blocking others", async () => {
    const { registry } = setup();
    const reports = await registry.initialize({
      mode: "live",
      adapters: {
        tasks: { provider: PROVIDER, enabled: true, config: { unknown: true } },
      },
    });
    expect(reports[0]?.error?.message).toMatch(/Konfiguration.*ungültig/);
    expect(registry.getHealth("test-tasks")).toMatchObject({
      lifecycle: "OFFLINE",
      status: "offline",
      lastError: { code: "VALIDATION_FAILED" },
    });
  });

  it("isolates a failing initialize(): the failing adapter is OFFLINE, the healthy one ONLINE", async () => {
    const clock = createManualClock();
    const registry = new AdapterRegistry({
      allowlist: ["good", "bad"],
      clock,
      secretProvider: () => "tok_abcdef",
    });
    const good = createTestFactory("good", makeManifest({ id: "good-tasks" }));
    registry.registerFactory("good", good.factory);
    const badActivity = createTestAdapter(
      makeManifest({ id: "bad-activity", category: "activity", capabilities: ["activity.read"] }),
    );
    badActivity.control.initializeError = new Error("kann nicht starten");
    registry.registerFactory("bad", {
      providerId: "bad",
      category: "activity",
      configSchema: good.factory.configSchema,
      create: () => badActivity.adapter,
    });
    const reports = await registry.initialize({
      mode: "live",
      adapters: {
        tasks: { provider: "good", enabled: true, config: { baseUrl: "http://x" } },
        activity: { provider: "bad", enabled: true, config: { baseUrl: "http://x" } },
      },
    });
    expect(reports.find((r) => r.category === "tasks")?.state).toBe("ONLINE");
    expect(reports.find((r) => r.category === "activity")).toMatchObject({
      state: "OFFLINE",
      error: { message: expect.stringContaining("kann nicht starten") },
    });
    expect(registry.getHealth("bad-activity").lastError?.message).toContain("kann nicht starten");
    await expect(registry.getPort("tasks").listTasks({}, CALL)).resolves.toBeDefined();
    await expect(registry.getPort("activity").listActivity({}, CALL)).rejects.toMatchObject({
      code: "ADAPTER_UNAVAILABLE",
    });
  });

  it("rejects manifests with unknown capabilities, wrong category or incompatible contract major", async () => {
    for (const manifest of [
      makeManifest({ capabilities: ["tasks.read", "tasks.fly"] }),
      makeManifest({ category: "memory" }),
      makeManifest({ contractVersion: "2.0.0" }),
      makeManifest({ configSchemaRef: "urn:other" }),
    ]) {
      const registry = new AdapterRegistry({ allowlist: [PROVIDER], clock: createManualClock() });
      registry.registerFactory(PROVIDER, createTestFactory(PROVIDER, manifest).factory);
      const [report] = await registry.initialize(config());
      expect(report?.state, JSON.stringify(manifest)).toBe("OFFLINE");
      expect(report?.error?.code).toBe("VALIDATION_FAILED");
    }
  });

  it("keeps disabled adapters listed but unloaded", async () => {
    const { registry, created } = setup();
    const reports = await registry.initialize(config({ enabled: false }));
    expect(reports[0]?.state).toBe("UNREGISTERED");
    expect(registry.listAdapters()[0]).toMatchObject({ enabled: false, provider: PROVIDER });
    await expect(registry.getPort("tasks").listTasks({}, CALL)).rejects.toMatchObject({
      code: "CAPABILITY_MISSING",
    });
    expect(created()).toBe(1);
    expect(registry.aggregateCapabilities().modules.tasks.read).toBe(false);
  });
});

describe("AdapterRegistry capabilities", () => {
  it("aggregates the SDK Capabilities document from serving adapters (sources = adapter ids)", async () => {
    const { registry } = setup();
    await registry.initialize(config());
    const document = registry.aggregateCapabilities();
    expect(document.contractVersion).toBe("1.0.0");
    expect(document.modules.tasks).toEqual({
      read: true,
      create: true,
      update: false,
      cancel: false,
      retry: false,
      pause: false,
      resume: false,
      stream: true,
      sources: ["test-tasks"],
    });
    expect(document.modules.memory.read).toBe(false);
    expect(document.modules.memory.sources).toEqual([]);
    expect(document.modules.telephony).toEqual({ read: false, call: false, sources: [] });
    expect(document.modules.mail.read).toBe(false);
  });

  it("derives the mail module from the communication adapter", async () => {
    const registry = new AdapterRegistry({
      allowlist: ["mailer"],
      clock: createManualClock(),
      secretProvider: () => "tok_abcdef",
    });
    const { adapter } = createTestAdapter(
      makeManifest({
        id: "mail-x",
        category: "communication",
        capabilities: ["communication.read", "communication.draft", "communication.multiChannel"],
      }),
    );
    registry.registerFactory("mailer", {
      providerId: "mailer",
      category: "communication",
      configSchema: { type: "object" },
      create: () => adapter,
    });
    const reports = await registry.initialize({
      mode: "live",
      adapters: { communication: { provider: "mailer", enabled: true } },
    });
    expect(reports[0]?.error).toBeUndefined();
    const { modules } = registry.aggregateCapabilities();
    expect(modules.communication).toMatchObject({
      read: true,
      draft: true,
      send: false,
      multiChannel: true,
      sources: ["mail-x"],
    });
    expect(modules.mail).toMatchObject({ read: true, draft: true, send: false, sources: ["mail-x"] });
  });

  it("drops the capabilities of an adapter that goes offline and emits capabilities_changed + health_changed", async () => {
    const { registry, control, clock, events } = setup();
    await registry.initialize(config());
    events.length = 0;
    control.health = { status: "offline", latencyMs: null, message: "weg" };
    // threshold is 3 checks
    for (let i = 0; i < 3; i += 1) await clock.advance(1000);
    expect(registry.getHealth("test-tasks").lifecycle).toBe("OFFLINE");
    expect(registry.aggregateCapabilities().modules.tasks.read).toBe(false);
    const types = events.map((e) => e.event.type);
    expect(types).toContain("jarvis.adapter.health_changed");
    expect(types).toContain("jarvis.adapter.capabilities_changed");
  });
});

describe("AdapterRegistry port proxy", () => {
  it("forwards calls with correlation id and validates results against the contract", async () => {
    const { registry, control } = setup();
    await registry.initialize(config());
    const page = await registry.getPort("tasks").listTasks({ limit: 10 }, CALL);
    expect(page.items).toHaveLength(1);
    expect(page.sources).toEqual([
      { adapterId: "test-tasks", system: "test", lastSyncedAt: "2026-10-13T20:00:00.000Z" },
    ]);
    expect(control.listCalls).toBe(1);
  });

  it("never forwards invalid foreign data: VALIDATION_FAILED, logged, with the correlation id", async () => {
    const { registry, control, logger } = setup();
    await registry.initialize(config());
    control.listImpl = () => ({
      items: [{ ...makeTask(1), item_id: "ext-1", owner_bot: "hermes" } as never],
      pageInfo: { nextCursor: null, hasNextPage: false },
      freshness: FRESH,
    });
    const error = await registry
      .getPort("tasks")
      .listTasks({}, CALL)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "VALIDATION_FAILED",
      correlationId: CALL.correlationId,
      details: { providerFieldLeak: true },
    });
    expect(
      logger.records.some((r) => r.level === "error" && r.message.includes("vertragswidrige Daten")),
    ).toBe(true);

    control.listImpl = () => ({
      items: [{ ...makeTask(1), status: "open" } as never],
      pageInfo: { nextCursor: null, hasNextPage: false },
      freshness: FRESH,
    });
    await expect(registry.getPort("tasks").listTasks({}, CALL)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("throws CAPABILITY_MISSING for undeclared capabilities and for unconfigured categories", async () => {
    const { registry } = setup();
    await registry.initialize(config());
    const tasks = registry.getPort("tasks");
    await expect(tasks.cancelTask?.({ id: makeTask(1).id }, CALL)).rejects.toMatchObject({
      code: "CAPABILITY_MISSING",
    });
    await expect(registry.getPort("memory").listMemory({}, CALL)).rejects.toMatchObject({
      code: "CAPABILITY_MISSING",
    });
    expect(registry.supports("tasks", "createTask")).toBe(true);
    expect(registry.supports("tasks", "cancelTask")).toBe(false);
  });

  it("throws ADAPTER_UNAVAILABLE while the adapter is offline", async () => {
    const { registry, control, clock } = setup();
    await registry.initialize(config());
    control.health = { status: "offline", latencyMs: null };
    for (let i = 0; i < 3; i += 1) await clock.advance(1000);
    await expect(registry.getPort("tasks").listTasks({}, CALL)).rejects.toMatchObject({
      code: "ADAPTER_UNAVAILABLE",
      retryable: true,
    });
  });

  it("times out slow adapters (ADAPTER_TIMEOUT) and opens the circuit after repeated failures", async () => {
    const { registry, control, clock } = setup();
    await registry.initialize(
      config({ timeoutMs: 100, circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 5000 } }),
    );
    control.listImpl = () => new Promise(() => {});
    const call = () => registry.getPort("tasks").listTasks({}, CALL);
    const first = expect(call()).rejects.toMatchObject({ code: "ADAPTER_TIMEOUT" });
    await clock.advance(100);
    await first;
    const second = expect(call()).rejects.toMatchObject({ code: "ADAPTER_TIMEOUT" });
    await clock.advance(100);
    await second;
    await expect(call()).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE", details: { circuit: "open" } });
    expect(registry.getHealth("test-tasks").circuit).toBe("open");
  });

  it("retries reads but not mutations without an idempotency key", async () => {
    const { registry, control, clock } = setup();
    await registry.initialize(
      config({ retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: "none" } }),
    );
    const unavailable = Object.assign(new Error("503"), { status: 503 });
    control.listImpl = (n) =>
      n < 3
        ? Promise.reject(unavailable)
        : { items: [], pageInfo: { nextCursor: null, hasNextPage: false }, freshness: FRESH };
    const read = registry.getPort("tasks").listTasks({}, CALL);
    await clock.advance(10);
    await expect(read).resolves.toMatchObject({ items: [] });
    expect(control.listCalls).toBe(3);
  });

  it("passes idempotency keys and abort signals to the adapter", async () => {
    const { registry, control } = setup();
    await registry.initialize(config());
    await registry
      .getPort("tasks")
      .createTask?.(
        { body: { title: "Neu" } },
        { ...CALL, idempotencyKey: "idem_00000000000000000000000001" },
      );
    expect(control.createCalls).toEqual([{ idempotencyKey: "idem_00000000000000000000000001" }]);
  });

  it("exposes the correlation id of the running call through the adapter context", async () => {
    const { registry, control } = setup();
    await registry.initialize(config());
    let seen = "";
    control.listImpl = () => {
      seen = control.context?.correlationId() ?? "";
      return { items: [], pageInfo: { nextCursor: null, hasNextPage: false }, freshness: FRESH };
    };
    await registry.getPort("tasks").listTasks({}, CALL);
    expect(seen).toBe(CALL.correlationId);
    expect(control.context?.correlationId()).toMatch(/^corr_[0-9A-Za-z]{26}$/);
  });
});

describe("AdapterRegistry events, restart and shutdown", () => {
  it("validates adapter events against the contract before forwarding", async () => {
    const { registry, control, events } = setup();
    await registry.initialize(config());
    events.length = 0;
    const task = makeTask(1);
    control.context?.emit({ type: "jarvis.task.created", subject: `task/${task.id}`, data: task });
    expect(events.map((e) => e.event.type)).toEqual(["jarvis.task.created"]);
    expect(() =>
      control.context?.emit({
        type: "jarvis.task.created",
        subject: "task/x",
        data: { ...task, status: "open" } as never,
      }),
    ).toThrow(/Vertrag/);
    expect(events).toHaveLength(1);
  });

  it("restarts a single adapter with a fresh instance", async () => {
    const { registry, created } = setup();
    await registry.initialize(config());
    expect(created()).toBe(1);
    const report = await registry.restart("test-tasks");
    expect(created()).toBe(2);
    expect(report.state).toBe("ONLINE");
    await expect(registry.getPort("tasks").listTasks({}, CALL)).resolves.toBeDefined();
  });

  it("shuts everything down, aborts the context signal, stops polling and fails later calls cleanly", async () => {
    const { registry, control, clock } = setup();
    await registry.initialize(config());
    const signal = control.context?.signal;
    expect(signal?.aborted).toBe(false);
    await registry.shutdownAll();
    expect(signal?.aborted).toBe(true);
    expect(control.shutdownCalls).toBe(1);
    expect(registry.getHealth("test-tasks").lifecycle).toBe("STOPPED");
    expect(clock.pending()).toBe(0);
    await expect(registry.getPort("tasks").listTasks({}, CALL)).rejects.toMatchObject({
      code: "ADAPTER_UNAVAILABLE",
    });
  });

  it("listAdapters returns contract-shaped AdapterInfo", async () => {
    const { registry } = setup();
    await registry.initialize(config());
    const [info] = registry.listAdapters();
    expect(info).toMatchObject({
      enabled: true,
      provider: PROVIDER,
      mode: "live",
      manifest: { id: "test-tasks" },
      health: { lifecycle: "ONLINE" },
    });
  });
});
