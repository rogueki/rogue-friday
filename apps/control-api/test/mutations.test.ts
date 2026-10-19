/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, startTestApi, type TestApi } from "./helpers";
import { createApprovedTask } from "./support/task-actions";
import { confirmedHeaders, stageKnowledgeWrite } from "./support/knowledge-actions";

const errorOf = (response: { json(): unknown }) => (response.json() as { error: { code: string; details: Record<string, any> } }).error;

async function stageTask(client: ApiClient, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const staged = await client.post("/api/v1/tasks", body, { headers });
  expect(staged.statusCode, staged.body).toBe(403);
  expect(errorOf(staged).details.stage).toBe("preview");
  return errorOf(staged).details.previewId as string;
}

const confirmTask = (client: ApiClient, body: Record<string, unknown>, previewId: string, headers: Record<string, string> = {}) =>
  client.post("/api/v1/tasks", body, { headers: { ...headers, "x-action-preview-id": previewId } });

/** Task updates go through the same staged preview as creates; the confirmation forwards If-Match to the task write. */
async function patchTask(client: ApiClient, id: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const staged = await client.patch(`/api/v1/tasks/${id}`, body, { headers });
  expect(staged.statusCode, staged.body).toBe(403);
  expect(errorOf(staged).details.stage).toBe("preview");
  return client.patch(`/api/v1/tasks/${id}`, body,
    { headers: { ...headers, "x-action-preview-id": errorOf(staged).details.previewId as string } });
}

describe("idempotency", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
  });
  afterAll(async () => {
    await api.close();
  });

  const taskCount = async (): Promise<number> => ((await owner.get("/api/v1/tasks", { query: { limit: "100" } })).json().items as unknown[]).length;
  const auditCount = (): number => api.runtime.stores.audit.count();

  it("replays the stored response for a repeated key and executes only once", async () => {
    const before = await taskCount();
    const headers = { "idempotency-key": "idem-replay-0001" };
    const body = { title: "Einmalig anlegen", priority: "P2" };
    const previewId = await stageTask(owner, body, headers);
    const first = await confirmTask(owner, body, previewId, headers);
    expect(first.statusCode, first.body).toBe(201);
    const audits = auditCount();
    const second = await confirmTask(owner, body, previewId, headers);
    expect(second.statusCode).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(first.headers["idempotent-replayed"]).toBe("false");
    expect(second.json()).toEqual(first.json());
    expect(second.headers.location).toBe(first.headers.location);
    expect(await taskCount()).toBe(before + 1);
    expect(auditCount(), "a replay is not a second audited action").toBe(audits);
  });

  it("rejects the same key with a different body as IDEMPOTENCY_CONFLICT", async () => {
    const headers = { "idempotency-key": "idem-conflict-001" };
    const previewId = await stageTask(owner, { title: "Erste Fassung" }, headers);
    expect((await confirmTask(owner, { title: "Erste Fassung" }, previewId, headers)).statusCode).toBe(201);
    const conflict = await confirmTask(owner, { title: "Andere Fassung" }, previewId, headers);
    expect(conflict.statusCode).toBe(409);
    expect(errorOf(conflict).code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("scopes keys to the operation and path", async () => {
    const task = (await createApprovedTask(owner, { title: "Pfad-Test" })).task;
    const other = (await createApprovedTask(owner, { title: "Pfad-Test 2" })).task;
    const headers = { "idempotency-key": "idem-path-scope-1" };
    expect((await owner.post(`/api/v1/tasks/${task.id}/pause`, {}, { headers })).statusCode).toBeLessThan(500);
    const elsewhere = await owner.post(`/api/v1/tasks/${other.id}/pause`, {}, { headers });
    expect(elsewhere.headers["idempotent-replayed"], "same key on another resource is a new request").toBeUndefined();
  });

  it("scopes keys to the user", async () => {
    const operator = api.client();
    await operator.loginDev("operator");
    const headers = { "idempotency-key": "idem-user-scope-1" };
    const body = { title: "Gleicher Schluessel" };
    const a = await confirmTask(owner, body, await stageTask(owner, body, headers), headers);
    const b = await confirmTask(operator, body, await stageTask(operator, body, headers), headers);
    expect(b.statusCode).toBe(201);
    expect(b.headers["idempotent-replayed"]).toBe("false");
    expect(b.json().data.id).not.toBe(a.json().data.id);
  });

  it("does not store failures: a corrected retry with the same key executes", async () => {
    const headers = { "idempotency-key": "idem-failure-0001" };
    const bad = await owner.post("/api/v1/tasks", { title: "" }, { headers });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    const body = { title: "Jetzt korrekt" };
    const good = await confirmTask(owner, body, await stageTask(owner, body, headers), headers);
    expect(good.statusCode).toBe(201);
  });

  it("treats parallel requests with one key as one execution", async () => {
    const before = await taskCount();
    const headers = { "idempotency-key": "idem-parallel-001" };
    const body = { title: "Doppelklick" };
    const previewId = await stageTask(owner, body, headers);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => confirmTask(owner, body, previewId, headers)),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((response) => response.json().data.id)).size).toBe(1);
    expect(await taskCount()).toBe(before + 1);
  });

  it("validates the key length", async () => {
    const response = await owner.post("/api/v1/tasks", { title: "Zu kurz" }, { headers: { "idempotency-key": "short" } });
    expect(response.statusCode).toBe(422);
    expect(errorOf(response).code).toBe("VALIDATION_FAILED");
  });

  it("does not require a key (and ignores one on operations that do not accept it)", async () => {
    const body = { title: "Ohne Schluessel" };
    expect((await confirmTask(owner, body, await stageTask(owner, body))).statusCode).toBe(201);
    const search = await owner.post("/api/v1/memory/search", { query: "Arbeitszeit" }, { headers: { "idempotency-key": "idem-ignored-0001" } });
    expect(search.statusCode).toBe(200);
    expect(search.headers["idempotent-replayed"]).toBeUndefined();
  });

  it("keeps replaying after a restart of the API", async () => {
    const first = await startTestApi({ dir: undefined });
    const dir = first.dir;
    const client = first.client();
    await client.loginDev("owner");
    const settings = (await client.get("/api/v1/settings")).json().data;
    expect((await client.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const headers = { "idempotency-key": "idem-restart-0001" };
    const body = { title: "Ueberlebt den Neustart" };
    const previewId = await stageTask(client, body, headers);
    const created = await confirmTask(client, body, previewId, headers);
    expect(created.statusCode).toBe(201);
    // Close without deleting the data directory (a `dir` option keeps it), then boot a second instance on it.
    await first.app.close();
    const second = await startTestApi({ dir });
    try {
      const again = second.client();
      await again.loginDev("owner");
      const replay = await confirmTask(again, body, previewId, headers);
      expect(replay.statusCode).toBe(201);
      expect(replay.headers["idempotent-replayed"]).toBe("true");
      expect(replay.json()).toEqual(created.json());
    } finally {
      await second.app.close();
      const { rmSync } = await import("node:fs");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("optimistic concurrency (If-Match)", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
  });
  afterAll(async () => {
    await api.close();
  });

  const newTask = async () => (await createApprovedTask(owner, { title: "Versionstest", priority: "P3" })).task as { id: string; version: number };

  it("applies an update whose If-Match equals the current version and increments the version", async () => {
    const task = await newTask();
    const response = await patchTask(owner, task.id, { title: "Neu" }, { "if-match": String(task.version) });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.version).toBe(task.version + 1);
  });

  it("answers 409 CONFLICT for a stale version and leaves the resource untouched", async () => {
    const task = await newTask();
    await patchTask(owner, task.id, { title: "Erste Änderung" }, { "if-match": String(task.version) });
    const stale = await patchTask(owner, task.id, { title: "Veraltete Änderung" }, { "if-match": String(task.version) });
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale).code).toBe("CONFLICT");
    const current = (await owner.get(`/api/v1/tasks/${task.id}`)).json().data;
    expect(current.title).toBe("Erste Änderung");
    expect(current.version).toBe(task.version + 1);
  });

  it.each([
    ["quoted", (version: number) => `"${version}"`],
    ["weak", (version: number) => `W/"${version}"`],
  ])("understands a %s If-Match value", async (_label, format) => {
    const task = await newTask();
    const ok = await patchTask(owner, task.id, { title: "Formtest" }, { "if-match": format(task.version) });
    expect(ok.statusCode, ok.body).toBe(200);
    const stale = await patchTask(owner, task.id, { title: "Formtest 2" }, { "if-match": format(task.version) });
    expect(stale.statusCode).toBe(409);
  });

  it("rejects an If-Match that is not a version number", async () => {
    const task = await newTask();
    const response = await owner.patch(`/api/v1/tasks/${task.id}`, { title: "x" }, { headers: { "if-match": "abc" } });
    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe("VALIDATION_FAILED");
  });

  it("does not require If-Match (last write wins) and treats * as no precondition", async () => {
    const task = await newTask();
    expect((await patchTask(owner, task.id, { title: "ohne Header" })).statusCode).toBe(200);
    expect((await patchTask(owner, task.id, { title: "Stern" }, { "if-match": "*" })).statusCode).toBe(200);
  });

  it("guards action endpoints too (pause with a stale version)", async () => {
    const running = (await owner.get("/api/v1/tasks", { query: { status: ["running"] } })).json().items[0] as { id: string; version: number };
    const stale = await owner.post(`/api/v1/tasks/${running.id}/pause`, {}, { headers: { "if-match": String(running.version + 5) } });
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale).code).toBe("CONFLICT");
  });

  it("guards memory updates and deletes", async () => {
    const createPreview = await stageKnowledgeWrite(owner, "POST", "/api/v1/memory", { type: "fact", content: "Versionstest" });
    const created = await owner.post("/api/v1/memory", { type: "fact", content: "Versionstest" },
      { headers: confirmedHeaders(createPreview) });
    expect(created.statusCode, created.body).toBe(201);
    const memory = created.json().data as { id: string; version: number };
    const stale = await owner.patch(`/api/v1/memory/${memory.id}`, { content: "x" }, { headers: { "if-match": String(memory.version + 1) } });
    expect(stale.statusCode).toBe(409);
    const staleDelete = await owner.delete(`/api/v1/memory/${memory.id}`, { headers: { "if-match": String(memory.version + 1) } });
    expect(staleDelete.statusCode).toBe(409);
    const deletePreview = await stageKnowledgeWrite(owner, "DELETE", `/api/v1/memory/${memory.id}`,
      undefined, { "if-match": String(memory.version) });
    const deleted = await owner.delete(`/api/v1/memory/${memory.id}`,
      { headers: confirmedHeaders(deletePreview, { "if-match": String(memory.version) }) });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({ accepted: true, status: "completed", resourceId: memory.id });
  });

  it("guards settings and persists assistantName", async () => {
    const current = (await owner.get("/api/v1/settings")).json().data;
    expect(current.profile.assistantName).toBe("F.R.I.D.A.Y.");
    const stale = await owner.patch("/api/v1/settings", { profile: { ...current.profile, assistantName: "Fridolin" } }, { headers: { "if-match": String(current.version + 3) } });
    expect(stale.statusCode).toBe(409);
    const ok = await owner.patch("/api/v1/settings", { profile: { ...current.profile, assistantName: "Fridolin" } }, { headers: { "if-match": String(current.version) } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.profile.assistantName).toBe("Fridolin");
    expect((await owner.get("/api/v1/settings")).json().data.profile.assistantName).toBe("Fridolin");
  });
});
