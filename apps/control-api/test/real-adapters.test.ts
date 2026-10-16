/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderAdaptersExample } from "../../../scripts/fake-upstreams/example-config";
import { startFakeUpstreams, type FakeUpstreams } from "../../../scripts/fake-upstreams/lib";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const PASSWORD = "integration-test-password";

/** The shipped example, pointed at the ephemeral ports of the fakes with a short breaker window (shipped: 30 s). */
function exampleAdapters(name: "hybrid" | "live", upstreams: FakeUpstreams): string {
  return renderAdaptersExample(name, { ports: upstreams.ports, breaker: { failureThreshold: 3, resetAfterMs: 1000 } });
}

describe("real adapters behind the Control API (hybrid)", () => {
  let upstreams: FakeUpstreams;
  let keyDir: string;
  let keyFile: string;
  let api: TestApi;
  let owner: ApiClient;
  const logs: string[] = [];

  beforeAll(async () => {
    keyDir = mkdtempSync(join(tmpdir(), "friday-hybrid-"));
    keyFile = join(keyDir, "hermes_api.key");
    upstreams = await startFakeUpstreams({ ports: { hermesApi: 0, hermesDashboard: 0, voice: 0, llama: 0, control: 0 }, keyFile });
    api = await startTestApi({
      dataMode: "hybrid",
      authMode: "local",
      ownerPassword: PASSWORD,
      adaptersYaml: exampleAdapters("hybrid", upstreams),
      env: { HERMES_API_KEY_FILE: keyFile, FRIDAY_STORAGE_PATH: "/" },
      logs,
      healthIntervalMs: 200,
    });
    owner = api.client();
    const login = await owner.loginOwner(PASSWORD);
    expect(login.statusCode, login.body).toBe(200);
  });
  afterEach(async () => {
    for (const name of ["hermes", "voice", "llama"] as const) await upstreams.start(name);
  });
  afterAll(async () => {
    await api.close();
    await upstreams.close();
    rmSync(keyDir, { recursive: true, force: true });
  });

  it("registers the real providers and keeps mock fallbacks for every other category", async () => {
    const entries = (await owner.get("/api/v1/adapters")).json().items as Array<{ manifest: { id: string; category: string }; health: { status: string } }>;
    const byCategory = Object.fromEntries(entries.map((entry) => [entry.manifest.category, entry]));
    expect(byCategory.tasks?.manifest.id).toBe("hermes-tasks");
    expect(byCategory.activity?.manifest.id).toBe("hermes-activity");
    expect(byCategory.agents?.manifest.id).toBe("hermes-agents");
    expect(byCategory.voice?.manifest.id).toBe("friday-voice-http");
    expect(byCategory.system?.manifest.id).toBe("local-system");
    for (const category of ["memory", "approvals", "communication", "calendar", "automations", "research", "files", "notifications", "audit", "commands"]) {
      expect(byCategory[category]?.manifest.id, category).toBe(`mock-${category}`);
    }
    for (const category of ["tasks", "activity", "agents", "voice", "system"]) expect(byCategory[category]?.health.status, category).toBe("online");
  });

  it("serves Hermes tasks and agents, voice status and system data through the contract", async () => {
    const tasks = (await owner.get("/api/v1/tasks")).json();
    expect(tasks.items.length).toBeGreaterThanOrEqual(7);
    expect(tasks.items.every((task: any) => task.source.system === "hermes" || task.source.adapterId === "hermes-tasks")).toBe(true);
    expect(tasks.items.map((task: any) => task.title)).toContain("Angebot Nr. 2041 prüfen");

    const agents = (await owner.get("/api/v1/agents")).json().items.map((agent: any) => String(agent.name).toLowerCase());
    expect(agents).toEqual(expect.arrayContaining(["hermes", "kira", "milo"]));

    const voice = (await owner.get("/api/v1/voice/status")).json().data;
    expect(voice.wakeWord.phrase).toBe("Hey Friday");
    expect(voice.localModel.state).toBe("ready");

    const services = (await owner.get("/api/v1/system/services")).json().items as Array<{ name: string; status: string }>;
    expect(services.filter((service) => /qwen|hermes|voice/i.test(service.name)).every((service) => service.status === "online")).toBe(true);
    const models = (await owner.get("/api/v1/system/models")).json().items.flatMap((provider: any) => provider.models);
    expect(models).toEqual(expect.arrayContaining(["qwen3-router", "friday"]));

    const metrics = (await owner.get("/api/v1/system/metrics")).json().data;
    expect(metrics.ram.totalBytes).toBeGreaterThan(0);
  });

  it("reads the Hermes key through the file: reference and never exposes it", async () => {
    expect(upstreams.hermes.calls.some((call) => call.listener === "api" && call.headers.authorization === `Bearer ${upstreams.apiKey}`)).toBe(true);
    const settings = await owner.get("/api/v1/settings/adapters");
    expect(settings.statusCode, settings.body).toBe(200);
    const surfaces = [settings.body, JSON.stringify((await owner.get("/api/v1/adapters")).json()), JSON.stringify((await owner.get("/api/v1/health")).json()), ...logs];
    for (const surface of surfaces) expect(surface).not.toContain(upstreams.apiKey);
    const activity = (settings.json().items as any[]).find((entry) => entry.adapterId === "hermes-activity");
    expect(activity.secretFields.apiKey.configured).toBe(true);
  });

  it("marks exactly the stopped module offline and recovers after restart", { timeout: 60000 }, async () => {
    await upstreams.stop("voice");
    await expect.poll(async () => (await owner.get("/api/v1/voice/status")).statusCode, { timeout: 8000 }).toBe(503);
    expect((await owner.get("/api/v1/voice/status")).json().error.code).toBe("ADAPTER_UNAVAILABLE");
    expect((await owner.get("/api/v1/tasks")).statusCode).toBe(200);
    expect((await owner.get("/api/v1/agents")).statusCode).toBe(200);
    await expect
      .poll(async () => {
        const items = (await owner.get("/api/v1/adapters")).json().items as Array<{ manifest: { id: string }; health: { status: string } }>;
        return items.filter((entry) => entry.health.status !== "online").map((entry) => entry.manifest.id);
      }, { timeout: 8000 })
      .toEqual(["friday-voice-http"]);
    const services = (await owner.get("/api/v1/system/services")).json().items as Array<{ name: string; status: string }>;
    expect(services.find((service) => /voice/i.test(service.name))?.status).toBe("offline");
    expect(services.find((service) => /hermes api/i.test(service.name))?.status).toBe("online");

    await upstreams.start("voice");
    await expect.poll(async () => (await owner.get("/api/v1/voice/status")).statusCode, { timeout: 15000 }).toBe(200);
  });

  it("degrades tasks and agents when Hermes is down while voice and system keep working", { timeout: 90000 }, async () => {
    await upstreams.stop("hermes");
    await expect.poll(async () => (await owner.get("/api/v1/tasks")).statusCode, { timeout: 15000 }).toBe(503);
    await expect.poll(async () => (await owner.get("/api/v1/voice/status")).statusCode, { timeout: 8000 }).toBe(200);
    expect((await owner.get("/api/v1/system/services")).statusCode).toBe(200);
    expect((await owner.get("/api/v1/memory")).statusCode).toBe(200);
    await upstreams.start("hermes");
    await expect.poll(async () => (await owner.get("/api/v1/tasks")).statusCode, { timeout: 30000 }).toBe(200);
  });
});

describe("allowlist wiring", () => {
  let upstreams: FakeUpstreams;
  let keyDir: string;
  let api: TestApi | undefined;

  beforeAll(async () => {
    keyDir = mkdtempSync(join(tmpdir(), "friday-wiring-"));
    upstreams = await startFakeUpstreams({ ports: { hermesApi: 0, hermesDashboard: 0, voice: 0, llama: 0, control: 0 }, keyFile: join(keyDir, "k.key") });
  });
  afterEach(async () => {
    await api?.close();
    api = undefined;
  });
  afterAll(async () => {
    await upstreams.close();
    rmSync(keyDir, { recursive: true, force: true });
  });

  it("lets the real packages win when the allowlist still names the placeholder packages", async () => {
    const logs: string[] = [];
    const yaml = exampleAdapters("hybrid", upstreams)
      .replace('hermes-tasks: "@friday/adapter-hermes"', 'hermes-tasks: "@friday/adapter-hermes-placeholder"')
      .replace('friday-voice-http: "@friday/adapter-voice-http"', 'friday-voice-http: "@friday/adapter-voice-placeholder"');
    api = await startTestApi({
      dataMode: "hybrid",
      authMode: "local",
      ownerPassword: PASSWORD,
      adaptersYaml: yaml,
      env: { HERMES_API_KEY_FILE: join(keyDir, "k.key"), FRIDAY_STORAGE_PATH: "/" },
      logs,
    });
    const client = api.client();
    await client.loginOwner(PASSWORD);
    expect((await client.get("/api/v1/tasks")).json().items.length).toBeGreaterThan(0);
    expect((await client.get("/api/v1/voice/status")).json().data.wakeWord.phrase).toBe("Hey Friday");
    expect(logs.some((line) => line.includes("Placeholder-Paket"))).toBe(true);
  });

  it("keeps the placeholder system adapter selectable under its own id", async () => {
    const yaml = exampleAdapters("hybrid", upstreams).replace('local-system: "@friday/adapter-system-local"', 'windows-wsl-system: "@friday/adapter-system-placeholder"').replace("provider: local-system", "provider: windows-wsl-system");
    api = await startTestApi({ dataMode: "hybrid", authMode: "local", ownerPassword: PASSWORD, adaptersYaml: yaml, env: { HERMES_API_KEY_FILE: join(keyDir, "k.key"), FRIDAY_STORAGE_PATH: "/" }, logs: [] });
    const client = api.client();
    await client.loginOwner(PASSWORD);
    // The local-system config keys do not fit the placeholder's schema, so it initialises as failed; only the selection is asserted.
    const entries = (await client.get("/api/v1/adapters")).json().items as Array<{ manifest: { id: string; category: string } }>;
    expect(entries.find((entry) => entry.manifest.category === "system")?.manifest.id).toBe("windows-wsl-system");
  });

  it("live example: configured categories are real, every other one is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-live-"));
    try {
      api = await startTestApi({
        dataMode: "hybrid", // the helper writes dashboard.yaml; the live mode is switched through the env override below
        authMode: "local",
        ownerPassword: PASSWORD,
        adaptersYaml: exampleAdapters("live", upstreams),
        env: { HERMES_API_KEY_FILE: join(keyDir, "k.key"), FRIDAY_STORAGE_PATH: "/", FRIDAY_DATA_MODE: "live" },
        dir,
      });
      expect(api.config.dataMode).toBe("live");
      const client = api.client();
      await client.loginOwner(PASSWORD);
      const entries = (await client.get("/api/v1/adapters")).json().items as Array<{ manifest: { id: string; category: string } }>;
      expect(entries.map((entry) => `${entry.manifest.category}:${entry.manifest.id}`).sort()).toEqual([
        "activity:hermes-activity",
        "agents:hermes-agents",
        "system:local-system",
        "tasks:hermes-tasks",
        "voice:friday-voice-http",
      ]);
      expect((await client.get("/api/v1/tasks")).statusCode).toBe(200);
      const memory = await client.get("/api/v1/memory");
      expect(memory.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      await api?.close();
      api = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
