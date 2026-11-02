import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, type ListMemoryParams, type MemoryPort } from "@friday/adapter-core";
import { createCorrelationId } from "@friday/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { stableUserId } from "../security/auth-service";
import { DurableMemoryService, type IntegrationEvent } from "./durable-memory";
import { createNativeMemoryFactory, memoryIdOf, NATIVE_MEMORY_PROVIDER_ID } from "./native-memory-adapter";

const OWNER = stableUserId("owner");
const roots: string[] = [];
const services: DurableMemoryService[] = [];
const registries: AdapterRegistry[] = [];

function fixture(): { data: string; vault: string } {
  const root = mkdtempSync(join(tmpdir(), "friday-native-memory-"));
  roots.push(root);
  return { data: join(root, "data"), vault: join(root, "vault") };
}

function openService(data: string, vault: string): DurableMemoryService {
  const service = new DurableMemoryService(data, vault);
  services.push(service);
  return service;
}

function closeService(service: DurableMemoryService): void {
  const index = services.indexOf(service);
  if (index >= 0) services.splice(index, 1);
  service.close();
}

async function closeRegistry(registry: AdapterRegistry): Promise<void> {
  const index = registries.indexOf(registry);
  if (index >= 0) registries.splice(index, 1);
  await registry.shutdownAll();
}

function event(id: string, overrides: Partial<IntegrationEvent> = {}): IntegrationEvent {
  return { eventId: id, contractVersion: "1.0.0", eventType: "user_utterance", actor: { type: "user", id: OWNER, role: null },
    identityId: OWNER, channel: "dashboard", sessionId: "s1", dialogId: "d1", correlationId: null, source: "dashboard/chat",
    occurredAt: "2026-10-19T10:00:00Z", outcome: "completed", captureEligibility: "eligible", redaction: "required",
    payload: { kind: "text", text: "Projekt Nordwind besprochen" }, ...overrides };
}

async function start(service: DurableMemoryService): Promise<{ registry: AdapterRegistry; port: MemoryPort }> {
  const registry = new AdapterRegistry({ allowlist: [NATIVE_MEMORY_PROVIDER_ID] });
  registries.push(registry);
  registry.registerFactory(NATIVE_MEMORY_PROVIDER_ID, createNativeMemoryFactory(() => service));
  await registry.initialize({ mode: "live",
    adapters: { memory: { provider: NATIVE_MEMORY_PROVIDER_ID, enabled: true, retry: false, circuitBreaker: false } } });
  return { registry, port: registry.getPort("memory") };
}

const call = (actorId = OWNER): { correlationId: string; actor: { type: "user"; id: string } } =>
  ({ correlationId: createCorrelationId(), actor: { type: "user" as const, id: actorId } });

afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.shutdownAll();
  for (const service of services.splice(0)) service.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("NativeMemoryAdapter", () => {
  it("maps a written conversation event to a contract-valid memory", async () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = openService(data, vault);
    expect(service.capture(event("e1", { channel: "voice", source: "voice/friday",
      payload: { kind: "text", text: "Entscheidung: Release am Freitag\nDetails folgen" } }))).toMatchObject({ pending: false });
    const first = await start(service);
    const page = await first.port.listMemory({}, call());
    expect(page.items).toHaveLength(1);
    const [memory] = page.items;
    const id = memoryIdOf("e1");
    expect(memory?.id).toBe(id);
    expect(memory?.id).toMatch(/^mem_[0-9A-Za-z]{26}$/);
    expect(memory?.type).toBe("episode");
    expect(memory?.title).toBe("Entscheidung: Release am Freitag");
    expect(memory?.content).toContain("Details folgen");
    expect(memory?.tags).toEqual(["voice"]);
    expect(memory?.sensitivity).toBe("normal");
    expect(memory?.confidence).toBe(1);
    expect(memory?.locked).toBe(false);
    expect(memory?.pinned).toBe(false);
    expect(memory?.entities).toEqual([]);
    expect(memory?.conflicts).toEqual([]);
    expect(memory?.history).toEqual([]);
    expect(memory?.version).toBe(1);
    expect(memory?.createdAt).toBe("2026-10-19T10:00:00.000Z");
    expect(memory?.updatedAt).toBe("2026-10-19T10:00:00.000Z");
    expect(memory?.source.adapterId).toBe("friday-memory");
    expect(memory?.source.externalId).toBe("e1");
    expect(memory?.provenance.kind).toBe("conversation");
    expect(memory?.provenance.referenceId).toBe("e1");
    expect(page.pageInfo.totalCount).toBe(1);
    expect(page.pageInfo.hasNextPage).toBe(false);
    // Reverse lookup: a fresh registry over a new service resolves the memory id without a prior list call.
    await closeRegistry(first.registry);
    closeService(service);
    const restarted = await start(openService(data, vault));
    const single = await restarted.port.getMemory({ id }, call());
    expect(single.data.id).toBe(id);
  });

  it("pages newest first with a stable cursor and the total count", async () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = openService(data, vault);
    for (let day = 1; day <= 5; day += 1) {
      expect(service.capture(event(`e${day}`, { occurredAt: `2026-10-0${day}T08:00:00Z` }))).toMatchObject({ pending: false });
    }
    const { port } = await start(service);
    const first = await port.listMemory({ limit: 2 }, call());
    expect(first.items.map((item) => item.source.externalId)).toEqual(["e5", "e4"]);
    expect(first.pageInfo.totalCount).toBe(5);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const second = await port.listMemory({ limit: 2, cursor: first.pageInfo.nextCursor }, call());
    expect(second.items.map((item) => item.source.externalId)).toEqual(["e3", "e2"]);
    const third = await port.listMemory({ limit: 2, cursor: second.pageInfo.nextCursor }, call());
    expect(third.items.map((item) => item.source.externalId)).toEqual(["e1"]);
    expect(third.pageInfo.hasNextPage).toBe(false);
    expect(third.pageInfo.nextCursor).toBeNull();
    await expect(port.listMemory({ cursor: "kaputt" }, call())).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("filters by keyword, channel and the fixed archive properties", async () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = openService(data, vault);
    service.capture(event("a1", { payload: { kind: "text", text: "Ärger mit dem Drucker" } }));
    service.capture(event("a2", { channel: "voice", source: "voice/friday",
      payload: { kind: "text", text: "Einkaufsliste für Samstag" } }));
    const { port } = await start(service);
    const titles = async (params: ListMemoryParams): Promise<(string | undefined)[]> =>
      (await port.listMemory(params, call())).items.map((item) => item.title);
    expect(await titles({ q: "ärger" })).toEqual(["Ärger mit dem Drucker"]);
    expect(await titles({ q: "drucker ÄRGER" })).toEqual(["Ärger mit dem Drucker"]);
    expect(await titles({ tag: "voice" })).toEqual(["Einkaufsliste für Samstag"]);
    const facts = await port.listMemory({ type: ["fact"] }, call());
    expect(facts.items).toHaveLength(0);
    expect(facts.pageInfo.totalCount).toBe(0);
    expect((await port.listMemory({ type: ["episode"] }, call())).items).toHaveLength(2);
    expect((await port.listMemory({ sensitivity: ["restricted"] }, call())).items).toHaveLength(0);
    expect((await port.listMemory({ locked: true }, call())).items).toHaveLength(0);
    expect((await port.listMemory({ pinned: true }, call())).items).toHaveLength(0);
  });

  it("lists only written, not forgotten memories of the caller's identity", async () => {
    const { data, vault } = fixture();
    const service = openService(data, vault);
    expect(service.capture(event("p1"))).toMatchObject({ pending: true });
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const { port } = await start(service);
    // A pending event is not in the vault yet, so it is not part of the archive.
    expect((await port.listMemory({}, call())).items).toHaveLength(0);
    service.flush();
    expect((await port.listMemory({}, call())).items).toHaveLength(1);
    const guest = stableUserId("guest");
    expect(service.capture(event("other", { identityId: guest, actor: { type: "user", id: guest, role: null } })))
      .toMatchObject({ pending: false });
    expect((await port.listMemory({}, call())).items.map((item) => item.source.externalId)).not.toContain("other");
    await expect(port.getMemory({ id: memoryIdOf("other") }, call())).rejects.toMatchObject({ code: "NOT_FOUND" });
    const guestView = await port.getMemory({ id: memoryIdOf("other") }, call(guest));
    expect(guestView.data.source.externalId).toBe("other");
    const anonymous = await port.listMemory({}, { correlationId: createCorrelationId() });
    expect(anonymous.items.map((item) => item.source.externalId)).toContain("p1");
    service.forget("p1");
    expect((await port.listMemory({}, call())).items.map((item) => item.source.externalId)).not.toContain("p1");
    await expect(port.getMemory({ id: memoryIdOf("p1") }, call())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("forgets a memory through deleteMemory with a version check", async () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = openService(data, vault);
    expect(service.capture(event("d1"))).toMatchObject({ pending: false });
    const { port } = await start(service);
    const id = memoryIdOf("d1");
    await expect(port.deleteMemory!({ id }, { ...call(), ifMatchVersion: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
    const outcome = await port.deleteMemory!({ id }, { ...call(), ifMatchVersion: 1 });
    expect(outcome).toMatchObject({ accepted: true, status: "completed" });
    expect(existsSync(join(vault, "Conversations", "2026", "10", "d1.md"))).toBe(false);
    expect((await port.listMemory({}, call())).items).toHaveLength(0);
  });

  it("is read-only, online for a readable vault and offline without it", async () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = openService(data, vault);
    const { registry, port } = await start(service);
    const adapters = registry.listAdapters();
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.manifest.name).toBe("Friday-Gedächtnis (Obsidian)");
    expect(adapters[0]?.provider).toBe(NATIVE_MEMORY_PROVIDER_ID);
    expect(adapters[0]?.health.status).toBe("online");
    expect(registry.aggregateCapabilities().modules.memory)
      .toMatchObject({ read: true, delete: true, write: false, search: false, export: false });
    await expect(port.createMemory!({ body: { type: "fact", content: "x" } } as never, call()))
      .rejects.toMatchObject({ code: "CAPABILITY_MISSING" });
    rmSync(join(vault, ".obsidian"), { recursive: true, force: true });
    // The health monitor degrades on the first failed probe and goes offline after repeated failures.
    const first = await registry.checkHealth(NATIVE_MEMORY_PROVIDER_ID);
    expect(first.status).not.toBe("online");
    expect(first.lastError?.code).toBe("VAULT_UNAVAILABLE");
    let health = first;
    for (let attempt = 0; attempt < 5 && health.status !== "offline"; attempt += 1)
      health = await registry.checkHealth(NATIVE_MEMORY_PROVIDER_ID);
    expect(health.status).toBe("offline");
    expect(health.lastError?.code).toBe("VAULT_UNAVAILABLE");
  });

  it("is refused in mock mode", async () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = openService(data, vault);
    const registry = new AdapterRegistry({ allowlist: [NATIVE_MEMORY_PROVIDER_ID] });
    registries.push(registry);
    registry.registerFactory(NATIVE_MEMORY_PROVIDER_ID, createNativeMemoryFactory(() => service));
    const report = await registry.initialize({ mode: "mock",
      adapters: { memory: { provider: NATIVE_MEMORY_PROVIDER_ID, enabled: true, retry: false, circuitBreaker: false } } });
    expect(report[0]?.error).toBeDefined();
  });
});
