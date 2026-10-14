/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JarvisEvent } from "@jarvis/sdk";
import { ApiClient, startTestApi, type TestApi } from "./helpers";

const errorOf = (response: { json(): unknown }) => (response.json() as { error: { code: string; retryable: boolean; details: Record<string, any> } }).error;

async function control(client: ApiClient, request: Record<string, unknown>): Promise<void> {
  const response = await client.post("/api/v1/dev/scenarios/control", request);
  expect(response.statusCode, response.body).toBe(200);
}

describe("partial outage (adapter offline)", () => {
  let api: TestApi;
  let owner: ApiClient;
  const events: JarvisEvent[] = [];
  let unsubscribe: () => void;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
    events.length = 0;
    unsubscribe = api.runtime.hub.subscribe((event) => events.push(event));
  });
  afterEach(async () => {
    unsubscribe();
    await api.close();
  });

  it("answers 503 ADAPTER_UNAVAILABLE for the offline module only; everything else keeps working", async () => {
    await control(owner, { action: "adapter_offline", adapterId: "mock-communication", offline: true });

    const threads = await owner.get("/api/v1/communication/threads");
    expect(threads.statusCode).toBe(503);
    expect(errorOf(threads).code).toBe("ADAPTER_UNAVAILABLE");
    expect(errorOf(threads).retryable).toBe(true);
    expect((await owner.get("/api/v1/communication/channels")).statusCode).toBe(503);
    expect((await owner.post("/api/v1/communication/drafts", { channelId: "chan_00000000000000000000000000", to: [{ name: "A", address: "a@example.invalid" }], subject: "s", body: "b" })).statusCode).toBe(503);

    for (const path of ["/api/v1/tasks", "/api/v1/agents", "/api/v1/calendar/events", "/api/v1/notifications", "/api/v1/approvals", "/api/v1/system/services", "/api/v1/memory", "/api/v1/voice/status"]) {
      expect((await owner.get(path)).statusCode, path).toBe(200);
    }
    expect((await owner.post("/api/v1/tasks", { title: "Läuft weiter" })).statusCode).toBe(201);
  });

  it("reports the outage in health, adapters, capabilities, status and overview", async () => {
    expect((await owner.get("/api/v1/health")).json().status).toBe("online");
    await control(owner, { action: "adapter_offline", adapterId: "mock-communication", offline: true });

    const health = (await owner.get("/api/v1/health")).json();
    expect(health.status).toBe("degraded");
    expect(health.components.find((component: any) => component.id === "mock-communication").status).toBe("offline");
    expect(health.components.filter((component: any) => component.id.startsWith("mock-") && component.status === "online")).toHaveLength(14);

    const adapter = (await owner.get("/api/v1/adapters/mock-communication/health")).json().data;
    expect(adapter.status).toBe("offline");
    expect(adapter.lastError?.code).toBe("ADAPTER_UNAVAILABLE");

    const list = (await owner.get("/api/v1/adapters")).json().items as Array<{ manifest: { id: string }; health: { status: string } }>;
    expect(list.filter((entry) => entry.health.status !== "online").map((entry) => entry.manifest.id)).toEqual(["mock-communication"]);

    const capabilities = (await owner.get("/api/v1/capabilities")).json();
    expect(capabilities.modules.communication.read).toBe(false);
    expect(capabilities.modules.tasks.read).toBe(true);
    expect(capabilities.modules.calendar.read).toBe(true);

    const status = (await owner.get("/api/v1/status")).json().data;
    expect(status.status).toBe("degraded");
    expect(status.adapterSummary.offline).toBe(1);

    const overview = await owner.get("/api/v1/overview");
    expect(overview.statusCode, overview.body).toBe(200);
    const orb = (await owner.get("/api/v1/orb/status")).json().data;
    expect(orb.status.health).toBe("degraded");
  });

  it("publishes health-change events and recovers when the adapter returns", async () => {
    await control(owner, { action: "adapter_offline", adapterId: "mock-communication", offline: true });
    const changes = events.filter((event) => event.type === "jarvis.adapter.health_changed" && (event.data as { adapterId: string }).adapterId === "mock-communication");
    expect(changes.length, "health_changed events for the offline adapter").toBeGreaterThan(0);
    expect((changes.at(-1)?.data as { status: string }).status).toBe("offline");

    await control(owner, { action: "adapter_offline", adapterId: "mock-communication", offline: false });
    expect((await owner.get("/api/v1/communication/threads")).statusCode).toBe(200);
    expect((await owner.get("/api/v1/health")).json().status).toBe("online");
    expect((await owner.get("/api/v1/capabilities")).json().modules.communication.read).toBe(true);
    const states = events.filter((event) => event.type === "jarvis.adapter.health_changed").map((event) => (event.data as { status: string }).status);
    expect(states.at(-1)).toBe("online");
  });

  it("handles several adapters offline and everything offline", async () => {
    for (const category of ["tasks", "calendar"]) await control(owner, { action: "adapter_offline", adapterId: `mock-${category}`, offline: true });
    expect((await owner.get("/api/v1/tasks")).statusCode).toBe(503);
    expect((await owner.get("/api/v1/calendar/events")).statusCode).toBe(503);
    expect((await owner.get("/api/v1/agents")).statusCode).toBe(200);
    const health = (await owner.get("/api/v1/health")).json();
    expect(health.status).toBe("degraded");
    expect((await owner.get("/api/v1/overview")).statusCode).toBe(200);
  });

  it("keeps the auth, meta and settings endpoints independent of the data adapters", async () => {
    await control(owner, { action: "adapter_offline", adapterId: "mock-tasks", offline: true });
    expect((await owner.get("/api/v1/meta")).statusCode).toBe(200);
    expect((await owner.get("/api/v1/auth/session")).statusCode).toBe(200);
    expect((await owner.get("/api/v1/settings")).statusCode).toBe(200);
    expect((await owner.get("/api/v1/audit/events")).statusCode).toBe(200);
  });

  it("applies the partial-outage scenario of the plan", async () => {
    const played = await owner.post("/api/v1/dev/scenarios/partial-outage/play");
    expect(played.statusCode, played.body).toBe(200);
    // the world clock is stopped in tests: the scenario's steps run when the console advances it
    await control(owner, { action: "clock_advance", ms: 5_000 });
    const health = (await owner.get("/api/v1/health")).json();
    expect(health.status).toBe("degraded");
    const offline = health.components.filter((component: any) => component.status !== "online");
    expect(offline.length).toBeGreaterThan(0);
    expect((await owner.get("/api/v1/tasks")).statusCode).toBe(200);
  });

  it("injects latency and errors per adapter", async () => {
    await control(owner, { action: "error_rate", adapterId: "mock-tasks", rate: 1 });
    const failing = await owner.get("/api/v1/tasks");
    expect(failing.statusCode).toBe(503);
    expect(errorOf(failing).code).toMatch(/ADAPTER_UNAVAILABLE|ADAPTER_TIMEOUT/);
    expect((await owner.get("/api/v1/agents")).statusCode).toBe(200);
    await control(owner, { action: "error_rate", adapterId: "mock-tasks", rate: 0 });
    expect((await owner.get("/api/v1/tasks")).statusCode).toBe(200);

    await control(owner, { action: "latency", adapterId: "mock-tasks", ms: 150 });
    const started = Date.now();
    expect((await owner.get("/api/v1/tasks")).statusCode).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });
});

describe("partial outage with an unconfigured live adapter (hybrid)", () => {
  let api: TestApi;
  let owner: ApiClient;
  const PASSWORD = "hybrid-test-passwort-2026";

  beforeAll(async () => {
    api = await startTestApi({
      dataMode: "hybrid",
      authMode: "local",
      ownerPassword: PASSWORD,
      adaptersYaml: `allowlist:
  gmx-mail: "@jarvis/adapter-mail-placeholder"
adapters:
  communication:
    provider: gmx-mail
    enabled: true
`,
    });
    owner = api.client();
    expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
  });
  afterAll(async () => {
    await api.close();
  });

  it("reports the placeholder as not configured while the mock modules stay usable", async () => {
    const threads = await owner.get("/api/v1/communication/threads");
    expect(threads.statusCode).toBe(503);
    expect(errorOf(threads).code).toBe("ADAPTER_UNAVAILABLE");
    expect((await owner.get("/api/v1/tasks")).statusCode).toBe(200);
    const health = (await owner.get("/api/v1/health")).json();
    expect(health.components.find((component: any) => component.id === "gmx-mail")?.status).toBe("offline");
    const capabilities = (await owner.get("/api/v1/capabilities")).json();
    expect(capabilities.modules.communication.read).toBe(false);
    expect(capabilities.modules.tasks.read).toBe(true);
    expect((await owner.get("/api/v1/dev/scenarios")).statusCode, "no scenario console outside mock mode").toBe(404);
  });
});

describe("capability missing", () => {
  let api: TestApi;
  let owner: ApiClient;
  let operator: ApiClient;
  const events: JarvisEvent[] = [];

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    operator = api.client();
    await owner.loginDev("owner");
    await operator.loginDev("operator");
    events.length = 0;
    api.runtime.hub.subscribe((event) => events.push(event));
  });
  afterEach(async () => {
    await api.close();
  });

  it("answers CAPABILITY_MISSING for an operation whose capability is switched off, reads stay available", async () => {
    await control(owner, { action: "capability_toggle", module: "tasks", capability: "create", enabled: false });
    const refused = await operator.post("/api/v1/tasks", { title: "Nicht erlaubt" });
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).code).toBe("CAPABILITY_MISSING");
    expect(errorOf(refused).details.capability ?? "tasks.create").toBe("tasks.create");
    expect(errorOf(refused).retryable).toBe(false);
    expect((await operator.get("/api/v1/tasks")).statusCode).toBe(200);

    const capabilities = (await operator.get("/api/v1/capabilities")).json();
    expect(capabilities.modules.tasks.create).toBe(false);
    expect(capabilities.modules.tasks.read).toBe(true);
    expect(events.some((event) => event.type === "jarvis.adapter.capabilities_changed")).toBe(true);
  });

  it("restores the operation when the capability returns", async () => {
    await control(owner, { action: "capability_toggle", module: "tasks", capability: "create", enabled: false });
    await control(owner, { action: "capability_toggle", module: "tasks", capability: "create", enabled: true });
    expect((await operator.post("/api/v1/tasks", { title: "Wieder erlaubt" })).statusCode).toBe(201);
  });

  it.each([
    ["memory", "write", (c: ApiClient) => c.post("/api/v1/memory", { type: "fact", content: "x" })],
    ["memory", "search", (c: ApiClient) => c.post("/api/v1/memory/search", { query: "x" })],
    ["agents", "pause", async (c: ApiClient) => c.post(`/api/v1/agents/${((await c.get("/api/v1/agents")).json().items[0] as { id: string }).id}/pause`)],
    ["voice", "test", (c: ApiClient) => c.post("/api/v1/voice/test", { kind: "stt" })],
    ["commands", "execute", (c: ApiClient) => c.post("/api/v1/commands", { text: "Öffne die Aufgaben", source: "palette" })],
  ])("gates %s.%s", async (module, capability, perform) => {
    await control(owner, { action: "capability_toggle", module, capability, enabled: false });
    const response = await perform(operator);
    expect(response.statusCode, response.body).toBe(403);
    expect(errorOf(response).code).toBe("CAPABILITY_MISSING");
  });

  it("does not let a missing read capability be bypassed through voice commands", async () => {
    await control(owner, { action: "capability_toggle", module: "voice", capability: "read", enabled: false });
    const response = await operator.post("/api/v1/commands", { text: "Sprachaufnahme starten", source: "voice" });
    expect(response.statusCode, response.body).toBe(403);
    expect(errorOf(response).code).toBe("CAPABILITY_MISSING");
  });
});
