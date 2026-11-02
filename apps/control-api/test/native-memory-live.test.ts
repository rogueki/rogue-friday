/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stableUserId } from "../src/security/auth-service";
import type { IntegrationEvent } from "../src/services/durable-memory";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const PASSWORD = "friday-live-owner-2026";

describe("the built-in memory adapter in the live runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "friday-native-memory-"));
  const dir = join(root, "install");
  const vault = join(root, "memory", "Friday");
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    api = await startTestApi({ dir, dataMode: "live", authMode: "local", ownerPassword: PASSWORD });
    // Nothing configured, exactly like a fresh installation: the runtime falls back to the built-in Obsidian vault.
    expect(api.runtime.durableMemory.vaultPath).toBe(vault);

    const identityId = stableUserId("owner");
    const now = new Date();
    const seed = (id: string, text: string, channel: string, source: string, occurredAt: Date): IntegrationEvent => ({
      eventId: id,
      contractVersion: "1.0.0",
      eventType: "user_utterance",
      actor: { type: "user", id: identityId, role: null },
      identityId,
      channel,
      sessionId: "s1",
      dialogId: "d1",
      correlationId: null,
      source,
      occurredAt: occurredAt.toISOString(),
      outcome: "completed",
      captureEligibility: "eligible",
      redaction: "required",
      payload: { kind: "text", text },
    });
    expect(api.runtime.durableMemory.capture(seed("evt-orion", "Projekt Orion: Kickoff am Montag", "dashboard", "dashboard/chat", now)))
      .toMatchObject({ accepted: true, pending: false });
    expect(api.runtime.durableMemory.capture(seed("evt-heizung", "Erinnerung an die Wartung der Heizung", "voice", "voice/friday",
      new Date(now.getTime() - 60_000)))).toMatchObject({ accepted: true, pending: false });
    expect(api.runtime.durableMemory.health().pending).toBe(0);

    owner = api.client();
    expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
  });

  afterAll(async () => {
    await api?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("lists the Obsidian archive through GET /api/v1/memory without adapter configuration", async () => {
    const response = await owner.get("/api/v1/memory");
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    for (const item of body.items) expect(item.type).toBe("episode");
    expect(body.sources[0].adapterId).toBe("friday-memory");
    expect(body.items.map((item: any) => item.source.externalId)).toEqual(["evt-orion", "evt-heizung"]);
    expect(body.pageInfo.totalCount).toBe(2);

    const filtered = await owner.get("/api/v1/memory", { query: { q: "orion" } });
    expect(filtered.statusCode, filtered.body).toBe(200);
    const matches = filtered.json().items;
    expect(matches).toHaveLength(1);
    expect(matches[0].title.startsWith("Projekt Orion")).toBe(true);

    const detail = await owner.get(`/api/v1/memory/${matches[0].id}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().data.id).toBe(matches[0].id);
  });

  it("reports the built-in adapter online and read-only", async () => {
    const response = await owner.get("/api/v1/adapters");
    expect(response.statusCode, response.body).toBe(200);
    const memory = response.json().items.find((item: any) => item.manifest.id === "friday-memory");
    expect(memory).toBeDefined();
    expect(memory.manifest.name).toBe("Friday-Gedächtnis (Obsidian)");
    expect(memory.health.status).toBe("online");

    const capabilities = await owner.get("/api/v1/capabilities");
    expect(capabilities.statusCode, capabilities.body).toBe(200);
    const modules = capabilities.json().modules;
    expect(modules.memory.read).toBe(true);
    expect(modules.memory.write).toBe(false);
    expect(modules.memory.delete).toBe(true);
  });

  it("fills the overview memory insights instead of an unconfigured section", async () => {
    const response = await owner.get("/api/v1/overview");
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data;
    expect(data.memoryInsights).not.toBeNull();
    expect(data.memoryInsights.total).toBe(2);
    expect(data.memoryInsights.newToday).toBe(2);
    const degraded = data.degradedSections.map((entry: any) => entry.adapterId);
    expect(degraded).not.toContain("unconfigured-memory");
    expect(degraded).not.toContain("friday-memory");
  });
});

describe("a configured memory adapter wins over the built-in one", () => {
  it("does not expose the built-in adapter once a provider is configured", async () => {
    const api = await startTestApi({ dataMode: "hybrid", authMode: "local", ownerPassword: PASSWORD });
    try {
      const client = api.client();
      expect((await client.loginOwner(PASSWORD)).statusCode).toBe(200);
      const response = await client.get("/api/v1/adapters");
      expect(response.statusCode, response.body).toBe(200);
      const items = response.json().items as any[];
      expect(items.some((item) => item.manifest.id === "friday-memory")).toBe(false);
      expect(items.some((item) => item.manifest.category === "memory")).toBe(true);
    } finally {
      await api.close();
    }
  });
});
