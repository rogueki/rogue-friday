import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

it("takes a text task draft through native approval and the real task port exactly once", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const text = "Neue Aufgabe: Quartalsbericht pruefen";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().status).toBe("requires_confirmation");
    const previewId = preview.json().previewId as string;
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("requires_approval");
    const approvalId = confirmed.json().approvalId as string;
    const operator = api.client();
    await operator.loginDev("operator");
    expect((await operator.get(`/api/v1/approvals/${approvalId}`)).statusCode).toBe(404);
    const list = await owner.get("/api/v1/approvals", { query: { status: ["pending"] } });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items.some((item: { id: string }) => item.id === approvalId)).toBe(true);
    const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().data.editable).toBe(false);
    const token = opened.headers["x-approval-token"] as string;
    expect((await owner.post(`/api/v1/approvals/${approvalId}/approve`, {})).statusCode).toBe(403);
    expect((await owner.post(`/api/v1/approvals/${approvalId}/approve`,
      { editedPreview: { kind: "text", title: "Andere Aufgabe", body: "Manipuliert" } },
      { headers: { "x-approval-token": token } })).statusCode).toBe(422);
    const decision = await owner.post(`/api/v1/approvals/${approvalId}/approve`, {}, { headers: { "x-approval-token": token } });
    expect(decision.statusCode, decision.body).toBe(200);
    expect(decision.json().data.status).toBe("executed");
    const tasks = await owner.get("/api/v1/tasks", { query: { q: "Quartalsbericht pruefen" } });
    expect(tasks.json().items.filter((item: { title: string }) => item.title === "Quartalsbericht pruefen")).toHaveLength(1);
    expect((await owner.post(`/api/v1/approvals/${approvalId}/approve`, {}, { headers: { "x-approval-token": token } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("keeps confirmation bound to the exact draft and executes once when tier-2 approval is disabled", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const text = "Erstelle eine Aufgabe: Ersatzteile pruefen";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    const previewId = preview.json().previewId as string;
    const changed = await owner.post("/api/v1/commands", { text: "Erstelle eine Aufgabe: Andere Sache", source: "text", confirm: true, previewId });
    expect(changed.statusCode).toBe(409);
    const first = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().status).toBe("executed");
    const repeated = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().result.taskId).toBe(first.json().result.taskId);
    const tasks = await owner.get("/api/v1/tasks", { query: { q: "Ersatzteile pruefen" } });
    expect(tasks.json().items.filter((item: { title: string }) => item.title === "Ersatzteile pruefen")).toHaveLength(1);
  } finally { await api.close(); }
});

it("cannot decide a rejected native task action or consume an expired one", async () => {
  let now = Date.parse("2026-10-19T12:00:00Z");
  const api = await startTestApi({ now: () => now, responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const text = "Neue Aufgabe: Lieferliste pruefen";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId: preview.json().previewId });
    const id = confirmed.json().approvalId as string;
    expect((await owner.post(`/api/v1/approvals/${id}/reject`, { comment: "Nicht jetzt" })).json().data.status).toBe("rejected");
    expect((await owner.post(`/api/v1/approvals/${id}/approve`, {})).statusCode).toBe(409);
    const next = await owner.post("/api/v1/commands", { text: "Neue Aufgabe: Archiv pruefen", source: "text" });
    const pending = await owner.post("/api/v1/commands", { text: "Neue Aufgabe: Archiv pruefen", source: "text", confirm: true, previewId: next.json().previewId });
    expect(pending.statusCode, pending.body).toBe(200);
    expect(pending.json().approvalId).toBeTruthy();
    now += 61 * 60_000;
    await owner.loginDev("owner");
    const expired = await owner.get(`/api/v1/approvals/${pending.json().approvalId}`);
    expect(expired.statusCode, expired.body).toBe(200);
    expect(expired.json().data.status).toBe("expired");
    const pendingList = await owner.get("/api/v1/approvals", { query: { status: ["pending"] } });
    expect(pendingList.json().items.some((item: { id: string }) => item.id === pending.json().approvalId)).toBe(false);
    expect((await owner.post(`/api/v1/approvals/${pending.json().approvalId}/approve`, {})).statusCode).toBe(409);
    const tasks = await owner.get("/api/v1/tasks", { query: { q: "Lieferliste pruefen" } });
    expect(tasks.json().items).toHaveLength(0);
  } finally { await api.close(); }
});

it("cancels a task preview and never revives its action", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const text = "Neue Aufgabe: Verworfenes Konzept";
    const preview = await owner.post("/api/v1/commands", { text, source: "palette" });
    const previewId = preview.json().previewId as string;
    const cancelled = await owner.post("/api/v1/commands", { text, source: "palette", previewId, confirm: false });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().status).toBe("rejected");
    expect((await owner.post("/api/v1/commands", { text, source: "palette", previewId, confirm: true })).statusCode).toBe(409);
    expect((await owner.get("/api/v1/tasks", { query: { q: "Verworfenes Konzept" } })).json().items).toHaveLength(0);
  } finally { await api.close(); }
});

it("gates direct task POST through the same saved preview and native approval", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const body = { title: "Direkte API-Aufgabe", priority: "P1", description: "Exakter Inhalt" };
    const staged = await owner.post("/api/v1/tasks", body);
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.code).toBe("APPROVAL_REQUIRED");
    expect(staged.json().error.details.stage).toBe("preview");
    const previewId = staged.json().error.details.previewId as string;
    expect((await owner.get("/api/v1/tasks", { query: { q: body.title } })).json().items).toHaveLength(0);
    const changed = await owner.post("/api/v1/tasks", { ...body, description: "Ausgetauscht" },
      { headers: { "x-action-preview-id": previewId } });
    expect(changed.statusCode).toBe(409);
    const confirmed = await owner.post("/api/v1/tasks", body, { headers: { "x-action-preview-id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(403);
    expect(confirmed.json().error.details.stage).toBe("approval");
    const approvalId = confirmed.json().error.details.approvalId as string;
    const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect(opened.json().data.preview.body).toContain("Exakter Inhalt");
    const token = opened.headers["x-approval-token"] as string;
    const executed = await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
      { headers: { "x-approval-token": token } });
    expect(executed.statusCode, executed.body).toBe(200);
    expect(executed.json().data.status).toBe("executed");
    expect((await owner.get("/api/v1/tasks", { query: { q: body.title } })).json().items).toHaveLength(1);
    expect((await owner.post("/api/v1/tasks", body, { headers: { "x-action-preview-id": previewId } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("direct task POST needs an exact preview even when tier-2 approval is disabled", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const body = { title: "Direkte Aufgabe ohne Tier-2-Gate", priority: "P2" };
    const staged = await owner.post("/api/v1/tasks", body);
    const previewId = staged.json().error.details.previewId as string;
    expect(staged.statusCode).toBe(403);
    const confirmed = await owner.post("/api/v1/tasks", body, { headers: { "x-action-preview-id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    const replay = await owner.post("/api/v1/tasks", body, { headers: { "x-action-preview-id": previewId } });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data.id).toBe(confirmed.json().data.id);
    expect((await owner.get("/api/v1/tasks", { query: { q: body.title } })).json().items).toHaveLength(1);
  } finally { await api.close(); }
});

it("discards a direct task-create preview only for its owner and never revives it", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const body = { title: "Direkt verworfener Entwurf", priority: "P2" };
    const staged = await owner.post("/api/v1/tasks", body);
    expect(staged.statusCode).toBe(403);
    const previewId = staged.json().error.details.previewId as string;
    const cancelHeaders = { "x-action-preview-id": previewId, "x-action-preview-cancel": "true" };

    const otherUser = api.client();
    await otherUser.loginDev("operator");
    expect((await otherUser.post("/api/v1/tasks", body, { headers: cancelHeaders })).statusCode).toBe(409);
    expect((await owner.post("/api/v1/tasks", { ...body, priority: "P1" }, { headers: cancelHeaders })).statusCode).toBe(409);
    expect((await owner.post("/api/v1/tasks", body, { headers: cancelHeaders })).statusCode).toBe(204);
    expect((await owner.post("/api/v1/tasks", body, { headers: cancelHeaders })).statusCode).toBe(409);
    expect((await owner.post("/api/v1/tasks", body, { headers: { "x-action-preview-id": previewId } })).statusCode).toBe(409);
    expect((await owner.get("/api/v1/tasks", { query: { q: body.title } })).json().items).toHaveLength(0);
  } finally { await api.close(); }
});

it("rejects malformed direct task-preview cancellation headers without consuming the draft", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const body = { title: "Draft nach Headerfehler" };
    const staged = await owner.post("/api/v1/tasks", body);
    const previewId = staged.json().error.details.previewId as string;
    expect((await owner.post("/api/v1/tasks", body, { headers: { "x-action-preview-cancel": "true" } })).statusCode).toBe(422);
    expect((await owner.post("/api/v1/tasks", body, { headers: { "x-action-preview-id": previewId, "x-action-preview-cancel": "false" } })).statusCode).toBe(422);
    expect((await owner.post("/api/v1/tasks", body, { headers: { "x-action-preview-id": previewId, "x-action-preview-cancel": "true" } })).statusCode).toBe(204);
  } finally { await api.close(); }
});

it("uses one intent key across preview and approval without caching the preview error", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const body = { title: "Gleicher Intent mit Freigabe" };
    const key = "native-task-preview-approval-001";
    const staged = await owner.post("/api/v1/tasks", body, { headers: { "idempotency-key": key } });
    expect(staged.statusCode).toBe(403);
    const previewId = staged.json().error.details.previewId as string;
    const headers = { "idempotency-key": key, "x-action-preview-id": previewId };
    const confirmed = await owner.post("/api/v1/tasks", body, { headers });
    expect(confirmed.statusCode, confirmed.body).toBe(403);
    expect(confirmed.json().error.details.stage).toBe("approval");
    const approvalId = confirmed.json().error.details.approvalId as string;
    const approval = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect(approval.json().data.correlationId).toBe(previewId);
    const decision = await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
      { headers: { "x-approval-token": String(approval.headers["x-approval-token"]) } });
    expect(decision.statusCode, decision.body).toBe(200);
    expect((await owner.get("/api/v1/tasks", { query: { q: body.title } })).json().items).toHaveLength(1);
    expect((await owner.post("/api/v1/tasks", body, { headers })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("uses one intent key across preview and direct receipt when tier-2 approval is disabled", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const body = { title: "Gleicher Intent ohne Freigabe" };
    const key = "native-task-preview-direct-001";
    const staged = await owner.post("/api/v1/tasks", body, { headers: { "idempotency-key": key } });
    expect(staged.statusCode).toBe(403);
    const previewId = staged.json().error.details.previewId as string;
    const headers = { "idempotency-key": key, "x-action-preview-id": previewId };
    const confirmed = await owner.post("/api/v1/tasks", body, { headers });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    expect(confirmed.json().data.id).toMatch(/^task_[0-9A-Za-z]{26}$/);
    const repeated = await owner.post("/api/v1/tasks", body, { headers });
    expect(repeated.statusCode, repeated.body).toBe(201);
    expect(repeated.json().data.id).toBe(confirmed.json().data.id);
    expect((await owner.get("/api/v1/tasks", { query: { q: body.title } })).json().items).toHaveLength(1);
  } finally { await api.close(); }
});
