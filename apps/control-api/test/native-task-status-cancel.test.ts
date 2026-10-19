import { expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

const TODO_TITLE = "Bestellstatus im Lieferantenportal auslesen";
const READY_TITLE = "Kalenderwoche 43 optimieren und Terminkonflikte auflösen";
const DONE_TITLE = "Backup-Verifikation der Sicherungen auf D:\\ durchführen";

async function taskByTitle(api: TestApi, owner: ReturnType<TestApi["client"]>, title: string) {
  const list = await owner.get("/api/v1/tasks", { query: { q: title } });
  expect(list.statusCode, list.body).toBe(200);
  const task = (list.json().items as Array<{ id: string; title: string }>).find((item) => item.title === title);
  expect(task, title).toBeTruthy();
  return (await owner.get(`/api/v1/tasks/${task!.id}`)).json().data;
}

async function disableTier2(owner: ReturnType<TestApi["client"]>): Promise<void> {
  const settings = (await owner.get("/api/v1/settings")).json().data;
  expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
    { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
}

async function approveNative(owner: ReturnType<TestApi["client"]>, approvalId: string) {
  const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
  expect(opened.statusCode, opened.body).toBe(200);
  const decision = await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
    { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
  expect(decision.statusCode, decision.body).toBe(200);
  return decision.json().data;
}

it("takes a spoken status change through preview and native approval exactly once", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const before = await taskByTitle(api, owner, TODO_TITLE);
    const text = `Markiere die Aufgabe ${TODO_TITLE} als erledigt`;
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().status).toBe("requires_confirmation");
    expect(preview.json().previewText).toContain("Erledigt");
    const previewId = preview.json().previewId as string;
    const changed = await owner.post("/api/v1/commands",
      { text: `Markiere die Aufgabe ${TODO_TITLE} als offen`, source: "text", confirm: true, previewId });
    expect(changed.statusCode).toBe(409);
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.json().status).toBe("requires_approval");
    const decided = await approveNative(owner, confirmed.json().approvalId as string);
    expect(decided.status).toBe("executed");
    expect(decided.executionResult).toContain("aktualisiert");
    const after = await taskByTitle(api, owner, TODO_TITLE);
    expect(after.status).toBe("done");
    expect(after.id).toBe(before.id);
    const reopened = await owner.get(`/api/v1/approvals/${confirmed.json().approvalId}`);
    expect((await owner.post(`/api/v1/approvals/${confirmed.json().approvalId}/approve`, {},
      { headers: { "x-approval-token": String(reopened.headers["x-approval-token"] ?? "") } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("executes a spoken cancel by id once when tier-2 approval is disabled", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const task = await taskByTitle(api, owner, READY_TITLE);
    const text = `Storniere den Task ${task.id as string}`;
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.json().previewText).toContain("abbrechen");
    const previewId = preview.json().previewId as string;
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect(confirmed.json().result.taskId).toBe(task.id);
    const repeated = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().result.taskId).toBe(task.id);
    expect((await taskByTitle(api, owner, READY_TITLE)).status).toBe("cancelled");
  } finally { await api.close(); }
});

it("cancels a status preview and never revives its action", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const text = `Setze die Aufgabe ${TODO_TITLE} auf in Arbeit`;
    const preview = await owner.post("/api/v1/commands", { text, source: "palette" });
    const previewId = preview.json().previewId as string;
    const dismissed = await owner.post("/api/v1/commands", { text, source: "palette", previewId, confirm: false });
    expect(dismissed.json().status).toBe("rejected");
    expect((await owner.post("/api/v1/commands", { text, source: "palette", previewId, confirm: true })).statusCode).toBe(409);
    expect((await taskByTitle(api, owner, TODO_TITLE)).status).toBe("todo");
  } finally { await api.close(); }
});

it("fails unknown or finished tasks before any preview is staged", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const unknown = await owner.post("/api/v1/commands", { text: "Markiere die Aufgabe Gibtesnicht als erledigt", source: "text" });
    expect(unknown.statusCode, unknown.body).toBe(404);
    const done = await taskByTitle(api, owner, DONE_TITLE);
    const cancelDone = await owner.post(`/api/v1/tasks/${done.id}/cancel`, { reason: "zu spaet" });
    expect(cancelDone.statusCode, cancelDone.body).toBe(409);
    const missing = await owner.patch(`/api/v1/tasks/task_${"Z".repeat(26)}`, { status: "done" });
    expect(missing.statusCode, missing.body).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");
    const invalid = await owner.patch(`/api/v1/tasks/${done.id}`, { status: "unbekannt" });
    expect(invalid.statusCode, invalid.body).toBe(422);
    const stagedRows = api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number };
    expect(stagedRows.count).toBe(0);
  } finally { await api.close(); }
});

it("gates direct task PATCH through the same saved preview and native approval", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const task = await taskByTitle(api, owner, TODO_TITLE);
    const body = { status: "ready" };
    const staged = await owner.patch(`/api/v1/tasks/${task.id}`, body);
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.code).toBe("APPROVAL_REQUIRED");
    expect(staged.json().error.details.stage).toBe("preview");
    expect(staged.json().error.details.previewText).toContain("auf ready setzen");
    const previewId = staged.json().error.details.previewId as string;
    expect((await taskByTitle(api, owner, TODO_TITLE)).status).toBe("todo");
    const changed = await owner.patch(`/api/v1/tasks/${task.id}`, { status: "waiting" },
      { headers: { "x-action-preview-id": previewId } });
    expect(changed.statusCode).toBe(409);
    const confirmed = await owner.patch(`/api/v1/tasks/${task.id}`, body, { headers: { "x-action-preview-id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(403);
    expect(confirmed.json().error.details.stage).toBe("approval");
    const decided = await approveNative(owner, confirmed.json().error.details.approvalId as string);
    expect(decided.status).toBe("executed");
    expect((await taskByTitle(api, owner, TODO_TITLE)).status).toBe("ready");
    expect((await owner.patch(`/api/v1/tasks/${task.id}`, body, { headers: { "x-action-preview-id": previewId } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("returns a direct receipt for PATCH when tier-2 approval is disabled and replays it", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const task = await taskByTitle(api, owner, TODO_TITLE);
    const body = { status: "review" };
    const staged = await owner.patch(`/api/v1/tasks/${task.id}`, body);
    const previewId = staged.json().error.details.previewId as string;
    const confirmed = await owner.patch(`/api/v1/tasks/${task.id}`, body, { headers: { "x-action-preview-id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data.status).toBe("review");
    const replay = await owner.patch(`/api/v1/tasks/${task.id}`, body, { headers: { "x-action-preview-id": previewId } });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().data.id).toBe(confirmed.json().data.id);
    expect((await taskByTitle(api, owner, TODO_TITLE)).version).toBe(confirmed.json().data.version);
  } finally { await api.close(); }
});

it("uses one intent key across cancel staging and approval without caching the preview error", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const task = await taskByTitle(api, owner, READY_TITLE);
    const key = "native-task-cancel-001";
    const staged = await owner.post(`/api/v1/tasks/${task.id}/cancel`, { reason: "nicht mehr noetig" },
      { headers: { "idempotency-key": key } });
    expect(staged.statusCode).toBe(403);
    const previewId = staged.json().error.details.previewId as string;
    const headers = { "idempotency-key": key, "x-action-preview-id": previewId };
    const confirmed = await owner.post(`/api/v1/tasks/${task.id}/cancel`, { reason: "nicht mehr noetig" }, { headers });
    expect(confirmed.statusCode, confirmed.body).toBe(403);
    expect(confirmed.json().error.details.stage).toBe("approval");
    const approvalId = confirmed.json().error.details.approvalId as string;
    const decided = await approveNative(owner, approvalId);
    expect(decided.status).toBe("executed");
    expect(decided.executionResult).toContain("abgebrochen");
    expect((await taskByTitle(api, owner, READY_TITLE)).status).toBe("cancelled");
    expect((await owner.post(`/api/v1/tasks/${task.id}/cancel`, { reason: "nicht mehr noetig" }, { headers })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("denies update and cancel when the capability is switched off", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const task = await taskByTitle(api, owner, TODO_TITLE);
    await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "tasks", capability: "update", enabled: false });
    const refused = await owner.patch(`/api/v1/tasks/${task.id}`, { status: "done" });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json().error.code).toBe("CAPABILITY_MISSING");
    expect(refused.json().error.details.capability).toBe("tasks.update");
    await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "tasks", capability: "update", enabled: true });
    await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "tasks", capability: "cancel", enabled: false });
    const refusedCancel = await owner.post(`/api/v1/tasks/${task.id}/cancel`, {});
    expect(refusedCancel.statusCode, refusedCancel.body).toBe(403);
    expect(refusedCancel.json().error.details.capability).toBe("tasks.cancel");
    const spoken = await owner.post("/api/v1/commands", { text: `Markiere die Aufgabe ${TODO_TITLE} als erledigt`, source: "text" });
    expect(spoken.statusCode, spoken.body).toBe(200);
    expect(spoken.json().status).toBe("requires_confirmation");
    expect((await owner.post("/api/v1/tasks", { title: "Unveraendert", priority: "P3" })).statusCode).toBe(403);
  } finally { await api.close(); }
});
