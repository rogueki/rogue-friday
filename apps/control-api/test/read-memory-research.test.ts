import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const PASSWORD = "read-memory-research-password";

// Live mode needs at least one real adapter; its upstream is unreachable on purpose, research is served by the local service.
const LIVE_ADAPTERS = `allowlist:
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

/**
 * Gedaechtnis- und Rechercheabfrage per Sprache: der Befehl muss dieselben Eintraege nennen, die die Oberflaeche
 * ueber `GET /api/v1/memory` und `GET /api/v1/research/projects` bekommt - ohne vertrauliche Titel zu sprechen.
 */
describe("spoken memory and research reads", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });

  afterEach(async () => {
    await api.close();
  });

  async function command(text: string) {
    const response = await owner.post("/api/v1/commands", { text, source: "voice" });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().result.message as string;
  }

  async function memories(query = "") {
    const response = await owner.get(`/api/v1/memory?limit=5${query}`);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().items as Array<{ id: string; title: string; sensitivity: string }>;
  }

  async function projects() {
    const response = await owner.get("/api/v1/research/projects?limit=5");
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().items as Array<{ id: string; topic: string }>;
  }

  it("lists the memory entries the dashboard lists", async () => {
    const expected = await memories();
    const message = await command("zeige mein gedaechtnis");
    for (const memory of expected) expect(message, `${memory.id} fehlt in: ${message}`).toContain(memory.id);
    for (const memory of expected.filter((item) => item.sensitivity !== "normal"))
      expect(message, `vertraulicher Titel ${memory.title} wurde gesprochen`).not.toContain(memory.title);
  });

  it("lists pinned memory entries", async () => {
    const pinned = await memories("&pinned=true");
    const message = await command("zeige angeheftete gedaechtniseintraege");
    if (pinned.length === 0) return;
    for (const memory of pinned) expect(message, `${memory.id} fehlt in: ${message}`).toContain(memory.id);
  });

  it("reads one memory entry by identifier", async () => {
    const normal = (await memories()).find((item) => item.sensitivity === "normal");
    if (!normal) return;
    const message = await command(`zeige gedaechtniseintrag ${normal.id}`);
    expect(message).toContain(normal.id);
    expect(message).toContain(normal.title);
  });

  it("never speaks the title or content of a confidential entry", async () => {
    const response = await owner.get("/api/v1/memory?limit=100");
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const confidential = (response.json().items as Array<{ id: string; title: string; content: string; sensitivity: string }>)
      .filter((item) => item.sensitivity !== "normal");
    expect(confidential.length, "Mock-Seed ohne vertrauliche Eintraege").toBeGreaterThan(0);
    for (const memory of confidential) {
      const message = await command(`zeige gedaechtniseintrag ${memory.id}`);
      expect(message).toContain(memory.id);
      expect(message).toContain("vertraulich");
      expect(message, `vertraulicher Titel ${memory.title} wurde gesprochen`).not.toContain(memory.title);
      if (memory.content) expect(message, "vertraulicher Inhalt wurde gesprochen").not.toContain(memory.content.slice(0, 40));
    }
  });

  it("lists the research projects the dashboard lists", async () => {
    const expected = await projects();
    const message = await command("zeige meine recherchen");
    if (expected.length === 0) {
      expect(message).toContain("Keine");
      return;
    }
    for (const project of expected) expect(message, `${project.id} fehlt in: ${message}`).toContain(project.id);
  });
});

describe("spoken research reads without stored projects", () => {
  let api: TestApi | undefined;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi({ dataMode: "live", authMode: "local", ownerPassword: PASSWORD, adaptersYaml: LIVE_ADAPTERS });
    owner = api.client();
    const login = await owner.loginOwner(PASSWORD);
    expect(login.statusCode, login.body).toBe(200);
  });

  afterEach(async () => {
    await api?.close();
  });

  it("reports no research projects instead of inventing one", async () => {
    const response = await owner.post("/api/v1/commands", { text: "zeige meine recherchen", source: "voice" });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    expect(response.json().result.message).toContain("Keine passenden Recherchen");
    const list = await owner.get("/api/v1/research/projects?limit=5");
    expect(list.statusCode, JSON.stringify(list.body)).toBe(200);
    expect(list.json().items.length).toBe(0);
  });
});
