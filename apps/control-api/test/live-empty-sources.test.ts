/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const PASSWORD = "live-empty-sources-password";

// Only one real provider is configured, and its upstream does not exist. Every other category is therefore
// "not configured" and the one real adapter has to report a failure: that is the DASH-03.04 acceptance
// situation "empty real sources" without a mock fallback.
const ADAPTERS = `allowlist:
  hermes-tasks: "@friday/adapter-hermes"
adapters:
  tasks:
    provider: hermes-tasks
    enabled: true
    timeoutMs: 800
    retry: { maxAttempts: 1, baseDelayMs: 50, maxDelayMs: 100 }
    circuitBreaker: { failureThreshold: 2, resetAfterMs: 500 }
    config:
      dashboardBaseUrl: http://127.0.0.1:9
      dashboardAuth: scrape
      boards: [default]
`;

async function boot(dir: string): Promise<TestApi> {
  return startTestApi({
    dir,
    dataMode: "live",
    authMode: "local",
    ownerPassword: PASSWORD,
    adaptersYaml: ADAPTERS,
    env: { FRIDAY_STORAGE_PATH: "/" },
    healthIntervalMs: 200,
  });
}

describe("live runtime with empty real sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "friday-live-empty-"));
  let api: TestApi | undefined;
  let owner: ApiClient;

  afterAll(async () => {
    await api?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("shows no simulated component, no fabricated entries and a real error for the dead upstream", async () => {
    api = await boot(dir);
    owner = api.client();
    const login = await owner.loginOwner(PASSWORD);
    expect(login.statusCode, login.body).toBe(200);

    const entries = (await owner.get("/api/v1/adapters")).json().items as Array<{ manifest: { id: string; category: string } }>;
    expect(entries.map((entry) => `${entry.manifest.category}:${entry.manifest.id}`)).toEqual(["tasks:hermes-tasks"]);
    expect(entries.some((entry) => entry.manifest.id.startsWith("mock-"))).toBe(false);

    const health = (await owner.get("/api/v1/health")).json();
    const componentIds = (health.components as Array<{ id: string }>).map((component) => component.id);
    expect(componentIds.filter((id) => id.startsWith("mock-"))).toEqual([]);

    const tasks = await owner.get("/api/v1/tasks");
    if (tasks.statusCode === 200) expect((tasks.json() as any).items).toEqual([]);
    else expect(tasks.statusCode).toBeGreaterThanOrEqual(500);

    for (const path of ["/api/v1/memory", "/api/v1/automations", "/api/v1/communication/channels", "/api/v1/agents"]) {
      const response = await owner.get(path);
      const described = `${path} -> ${response.statusCode} ${JSON.stringify(response.body).slice(0, 200)}`;
      expect(response.statusCode, described).toBeGreaterThanOrEqual(400);
    }

    // The skill catalog is real content from disk, never seeded: an empty installation lists nothing.
    const skills = await owner.get("/api/v1/skills");
    if (skills.statusCode === 200) expect((skills.json() as any).data).toEqual([]);
    else expect(skills.statusCode).toBeGreaterThanOrEqual(400);
  }, 30000);

  it("creates no demo automation across a restart", async () => {
    await api?.close();
    api = await boot(dir);
    owner = api.client();
    const login = await owner.loginOwner(PASSWORD);
    expect(login.statusCode, login.body).toBe(200);

    const automations = await owner.get("/api/v1/automations");
    expect(automations.statusCode).toBeGreaterThanOrEqual(400);
    const entries = (await owner.get("/api/v1/adapters")).json().items as Array<{ manifest: { id: string } }>;
    expect(entries.map((entry) => entry.manifest.id)).toEqual(["hermes-tasks"]);
  }, 30000);
});