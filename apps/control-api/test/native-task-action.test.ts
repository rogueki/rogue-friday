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
