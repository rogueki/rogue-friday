import { expect, it } from "vitest";
import type { FileItem, Memory } from "@friday/sdk";
import { startTestApi, type TestApi } from "./helpers";
import { confirmedHeaders, stageKnowledgeWrite } from "./support/knowledge-actions";

type Client = ReturnType<TestApi["client"]>;

async function disableTier2(owner: Client): Promise<void> {
  const settings = (await owner.get("/api/v1/settings")).json().data;
  expect((await owner.patch("/api/v1/settings", { approvals: { ...settings.approvals, confirmTier2: false } },
    { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
}

async function approveNative(owner: Client, approvalId: string) {
  const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
  expect(opened.statusCode, opened.body).toBe(200);
  const decision = await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
    { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
  expect(decision.statusCode, decision.body).toBe(200);
  return decision.json().data;
}

async function createMemory(owner: Client, content: string, extra: Record<string, unknown> = {}): Promise<Memory> {
  const body = { type: "fact", content, ...extra };
  const previewId = await stageKnowledgeWrite(owner, "POST", "/api/v1/memory", body);
  const created = await owner.post("/api/v1/memory", body, { headers: confirmedHeaders(previewId) });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().data as Memory;
}

function stagedRows(api: TestApi): number {
  return (api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number }).count;
}

const previewOf = (response: { json(): { error: { details: { previewId: string; previewText: string } } } }): string =>
  response.json().error.details.previewId;

it("stages a memory create and executes it only after the exact confirmation, replay included", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const body = { type: "fact", content: "Wasserstand im Keller monatlich prüfen", tags: ["haus"] };
    const staged = await owner.post("/api/v1/memory", body);
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details).toMatchObject({ stage: "preview",
      previewText: "Gedächtniseintrag „Wasserstand im Keller monatlich prüfen“ anlegen?" });
    expect((await owner.get("/api/v1/memory", { query: { q: "Wasserstand" } })).json().items).toHaveLength(0);
    const wrong = await owner.post("/api/v1/memory", body,
      { headers: { "x-action-preview-id": "corr_0000000000000000000000zz99" } });
    expect(wrong.statusCode).toBe(409);
    const previewId = previewOf(staged);
    const confirmed = await owner.post("/api/v1/memory", body, { headers: confirmedHeaders(previewId) });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    expect(confirmed.headers.location).toBe(`/api/v1/memory/${confirmed.json().data.id}`);
    // A replayed confirmation answers the stored receipt; no second entry is created.
    const replay = await owner.post("/api/v1/memory", body, { headers: confirmedHeaders(previewId) });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data.id).toBe(confirmed.json().data.id);
    expect((await owner.get("/api/v1/memory", { query: { q: "Wasserstand" } })).json().items).toHaveLength(1);
  } finally { await api.close(); }
});

it("stages a memory update and refuses a tampered confirmation or a replay after the version changed", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const memory = await createMemory(owner, "Notiz zur Heizung");
    const staged = await owner.patch(`/api/v1/memory/${memory.id}`, { content: "Neuer Inhalt" });
    expect(staged.statusCode, staged.body).toBe(403);
    const previewId = previewOf(staged);
    const tampered = await owner.patch(`/api/v1/memory/${memory.id}`, { content: "Anders" },
      { headers: confirmedHeaders(previewId) });
    expect(tampered.statusCode).toBe(409);
    // A concurrent write moves the version; the stored draft still pins the old one and the port refuses the dispatch.
    const other = await owner.patch(`/api/v1/memory/${memory.id}`, { pinned: true });
    const confirmedOther = await owner.patch(`/api/v1/memory/${memory.id}`, { pinned: true },
      { headers: confirmedHeaders(previewOf(other)) });
    expect(confirmedOther.statusCode, confirmedOther.body).toBe(200);
    const drifted = await owner.patch(`/api/v1/memory/${memory.id}`, { content: "Neuer Inhalt" },
      { headers: confirmedHeaders(previewId) });
    expect(drifted.statusCode, drifted.body).toBe(409);
    expect(drifted.json().error.code).toBe("CONFLICT");
    expect((await owner.get(`/api/v1/memory/${memory.id}`)).json().data.content).toBe("Notiz zur Heizung");
    // A fresh preview/confirmation pair applies the change once.
    const stagedAgain = await owner.patch(`/api/v1/memory/${memory.id}`, { content: "Neuer Inhalt" });
    const confirmed = await owner.patch(`/api/v1/memory/${memory.id}`, { content: "Neuer Inhalt" },
      { headers: confirmedHeaders(previewOf(stagedAgain)) });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data).toMatchObject({ content: "Neuer Inhalt", pinned: true });
  } finally { await api.close(); }
});

it("stages a memory delete and answers a replayed confirmation from the stored receipt", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const memory = await createMemory(owner, "Vorläufige Notiz");
    const staged = await owner.delete(`/api/v1/memory/${memory.id}`);
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details.previewText).toBe(
      "Gedächtniseintrag „Vorläufige Notiz“ vergessen? Die Löschung bleibt im Audit nachvollziehbar.");
    const previewId = previewOf(staged);
    const confirmed = await owner.delete(`/api/v1/memory/${memory.id}`, { headers: confirmedHeaders(previewId) });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ accepted: true, status: "completed", resourceId: memory.id });
    expect((await owner.get(`/api/v1/memory/${memory.id}`)).statusCode).toBe(404);
    // The replay cannot re-dispatch a delete (the entry is gone); it answers the stored receipt instead.
    const replay = await owner.delete(`/api/v1/memory/${memory.id}`, { headers: confirmedHeaders(previewId) });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ accepted: true, status: "completed", resourceId: memory.id,
      auditEventId: confirmed.json().auditEventId });
  } finally { await api.close(); }
});

it("runs a memory update through the tier-2 approval exactly once", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const memory = await (async () => {
      // Tier 2 is on: the create itself needs an approval decision first.
      const body = { type: "fact", content: "Freigabepfad-Test", title: "Freigabepfad" };
      const staged = await owner.post("/api/v1/memory", body);
      const confirmed = await owner.post("/api/v1/memory", body, { headers: confirmedHeaders(previewOf(staged)) });
      expect(confirmed.statusCode, confirmed.body).toBe(403);
      expect(confirmed.json().error.details.stage).toBe("approval");
      const decided = await approveNative(owner, confirmed.json().error.details.approvalId);
      expect(decided.status).toBe("executed");
      expect(decided.executionResult).toMatch(/^Gedaechtniseintrag mem_[0-9A-Za-z]{26} angelegt\.$/);
      return (await owner.get(`/api/v1/memory`, { query: { q: "Freigabepfad" } })).json().items[0] as Memory;
    })();
    const staged = await owner.patch(`/api/v1/memory/${memory.id}`, { content: "Freigabepfad-Test, bestätigt" });
    const confirmed = await owner.patch(`/api/v1/memory/${memory.id}`, { content: "Freigabepfad-Test, bestätigt" },
      { headers: confirmedHeaders(previewOf(staged)) });
    expect(confirmed.statusCode, confirmed.body).toBe(403);
    const approvalId = confirmed.json().error.details.approvalId;
    const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect(opened.json().data.action).toBe("Gedaechtniseintrag aktualisieren: Freigabepfad");
    const decided = await approveNative(owner, approvalId);
    expect(decided.status).toBe("executed");
    expect(decided.executionResult).toBe(`Gedaechtniseintrag ${memory.id} aktualisiert.`);
    expect((await owner.get(`/api/v1/memory/${memory.id}`)).json().data.content).toBe("Freigabepfad-Test, bestätigt");
    const reopened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect((await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
      { headers: { "x-approval-token": String(reopened.headers["x-approval-token"] ?? "") } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("fails unknown, locked or capability-blocked memory writes before any preview is staged", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const unknown = "mem_0000000000000000000000zz99";
    expect((await owner.patch(`/api/v1/memory/${unknown}`, { content: "x" })).statusCode).toBe(404);
    expect((await owner.delete(`/api/v1/memory/${unknown}`)).statusCode).toBe(404);
    expect((await owner.post(`/api/v1/memory/${unknown}/conflicts/${unknown}/resolve`, { resolution: "dismiss" })).statusCode).toBe(404);
    const locked = (await owner.get("/api/v1/memory", { query: { locked: "true", limit: "10" } })).json().items[0] as Memory;
    expect(locked.locked).toBe(true);
    const lockedUpdate = await owner.patch(`/api/v1/memory/${locked.id}`, { content: "Überschreiben?" });
    expect(lockedUpdate.statusCode, lockedUpdate.body).toBe(409);
    const lockedDelete = await owner.delete(`/api/v1/memory/${locked.id}`);
    expect(lockedDelete.statusCode, lockedDelete.body).toBe(409);
    await owner.post("/api/v1/dev/scenarios/control", { action: "capability_toggle", module: "memory", capability: "write", enabled: false });
    const denied = await owner.patch(`/api/v1/memory/${locked.id}`, { pinned: true });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().error.code).toBe("CAPABILITY_MISSING");
    expect(stagedRows(api)).toBe(0);
  } finally { await api.close(); }
});

it("stages a conflict resolution with pre-staging guards and version binding", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const list = (await owner.get("/api/v1/memory", { query: { limit: "100" } })).json().items as Memory[];
    const memory = list.find((entry) => entry.conflicts.some((conflict) => conflict.resolution === "pending"))!;
    const conflictId = memory.conflicts.find((conflict) => conflict.resolution === "pending")!.memoryId;
    expect((await owner.post(`/api/v1/memory/${memory.id}/conflicts/mem_0000000000000000000000zz99/resolve`,
      { resolution: "dismiss" })).statusCode).toBe(404);
    const staged = await owner.post(`/api/v1/memory/${memory.id}/conflicts/${conflictId}/resolve`, { resolution: "dismiss" });
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details.previewText).toContain("als gegenstandslos");
    const previewId = previewOf(staged);
    // A concurrent write moves the version; the stored draft pins the old one and the port refuses the dispatch.
    const pin = await owner.patch(`/api/v1/memory/${memory.id}`, { pinned: true });
    await owner.patch(`/api/v1/memory/${memory.id}`, { pinned: true }, { headers: confirmedHeaders(previewOf(pin)) });
    const drifted = await owner.post(`/api/v1/memory/${memory.id}/conflicts/${conflictId}/resolve`, { resolution: "dismiss" },
      { headers: confirmedHeaders(previewId) });
    expect(drifted.statusCode, drifted.body).toBe(409);
    const stagedAgain = await owner.post(`/api/v1/memory/${memory.id}/conflicts/${conflictId}/resolve`, { resolution: "dismiss" });
    const resolved = await owner.post(`/api/v1/memory/${memory.id}/conflicts/${conflictId}/resolve`, { resolution: "dismiss" },
      { headers: confirmedHeaders(previewOf(stagedAgain)) });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(resolved.json().data.conflicts.find((entry: { memoryId: string }) => entry.memoryId === conflictId).resolution)
      .toBe("dismissed");
    // An already resolved conflict fails 409 before any new preview is staged.
    const again = await owner.post(`/api/v1/memory/${memory.id}/conflicts/${conflictId}/resolve`, { resolution: "keep_both" });
    expect(again.statusCode, again.body).toBe(409);
  } finally { await api.close(); }
});

it("stages a file rename with a sibling 409 guard and replays the receipt", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const files = (await owner.get("/api/v1/files", { query: { limit: "100" } })).json().items as FileItem[];
    const target = files.find((file) => file.name === "Angebotsvergleich Büromöbel.md")!;
    const sibling = files.find((file) => file.location === target.location && file.id !== target.id)!;
    const taken = await owner.patch(`/api/v1/files/${target.id}`, { name: sibling.name });
    expect(taken.statusCode, taken.body).toBe(409);
    const staged = await owner.patch(`/api/v1/files/${target.id}`, { name: "Angebotsvergleich final.md" });
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details.previewText)
      .toBe("Datei „Angebotsvergleich Büromöbel.md“ in „Angebotsvergleich final.md“ umbenennen?");
    const previewId = previewOf(staged);
    const confirmed = await owner.patch(`/api/v1/files/${target.id}`, { name: "Angebotsvergleich final.md" },
      { headers: confirmedHeaders(previewId) });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().data).toMatchObject({ name: "Angebotsvergleich final.md", version: target.version + 1 });
    const audit = (api.runtime.stores.audit.recent(500) as Array<{ action: string; before?: { name?: string }; after?: { name?: string } }>)
      .find((entry) => entry.action === "file.renamed");
    expect(audit).toMatchObject({ before: { name: target.name }, after: { name: "Angebotsvergleich final.md" } });
    // The replayed confirmation answers the stored receipt without a second rename.
    const replay = await owner.patch(`/api/v1/files/${target.id}`, { name: "Angebotsvergleich final.md" },
      { headers: confirmedHeaders(previewId) });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().data.name).toBe("Angebotsvergleich final.md");
    expect((await owner.get(`/api/v1/files/${target.id}`)).json().data.version).toBe(target.version + 1);
    expect((await owner.patch("/api/v1/files/file_0000000000000000000000zz99", { name: "x.md" })).statusCode).toBe(404);
  } finally { await api.close(); }
});

it("deletes a temporary file immediately and hands a gated deletion to the adapter approval", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const files = (await owner.get("/api/v1/files", { query: { limit: "100" } })).json().items as FileItem[];
    const temporary = files.find((file) => file.category === "temporary")!;
    const staged = await owner.delete(`/api/v1/files/${temporary.id}`);
    expect(staged.statusCode, staged.body).toBe(403);
    const previewId = previewOf(staged);
    const removed = await owner.delete(`/api/v1/files/${temporary.id}`, { headers: confirmedHeaders(previewId) });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toMatchObject({ accepted: true, status: "completed", resourceId: temporary.id });
    expect((await owner.get(`/api/v1/files/${temporary.id}`)).statusCode).toBe(404);
    // The replay answers the stored receipt; the file is not "deleted" a second time.
    const replay = await owner.delete(`/api/v1/files/${temporary.id}`, { headers: confirmedHeaders(previewId) });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().auditEventId).toBe(removed.json().auditEventId);

    const gated = files.find((file) => file.category === "reports")!;
    const stagedGated = await owner.delete(`/api/v1/files/${gated.id}`);
    expect(stagedGated.statusCode, stagedGated.body).toBe(403);
    expect(stagedGated.json().error.details.previewText).toContain("Adapter");
    const gatedDecision = await owner.delete(`/api/v1/files/${gated.id}`, { headers: confirmedHeaders(previewOf(stagedGated)) });
    expect(gatedDecision.statusCode, gatedDecision.body).toBe(202);
    const approval = gatedDecision.json().data as { id: string; type: string; status: string };
    expect(approval.type).toBe("delete_file");
    expect((await owner.get(`/api/v1/files/${gated.id}`)).statusCode).toBe(200);
    // The adapter approval executes the actual deletion once approved.
    const opened = await owner.get(`/api/v1/approvals/${approval.id}`);
    expect(opened.statusCode, opened.body).toBe(200);
    const decided = await owner.post(`/api/v1/approvals/${approval.id}/approve`, {},
      { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
    expect(decided.statusCode, decided.body).toBe(200);
    expect((await owner.get(`/api/v1/files/${gated.id}`)).statusCode).toBe(404);
    // A replayed confirmation of the gated deletion re-serves the adapter approval.
    const gatedReplay = await owner.delete(`/api/v1/files/${gated.id}`, { headers: confirmedHeaders(previewOf(stagedGated)) });
    expect(gatedReplay.statusCode, gatedReplay.body).toBe(202);
    expect(gatedReplay.json().data.id).toBe(approval.id);
  } finally { await api.close(); }
});

it("drives spoken knowledge actions through the command path with live-registry resolution", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);

    const createText = "Merke dir: Sprachnotiz aus dem Kommandopfad";
    const createPreview = await owner.post("/api/v1/commands", { text: createText, source: "text" });
    expect(createPreview.statusCode, createPreview.body).toBe(200);
    expect(createPreview.json().status).toBe("requires_confirmation");
    expect(createPreview.json().previewText).toBe("Gedächtniseintrag „Sprachnotiz aus dem Kommandopfad“ anlegen?");
    const createConfirm = await owner.post("/api/v1/commands",
      { text: createText, source: "text", confirm: true, previewId: createPreview.json().previewId });
    expect(createConfirm.statusCode, createConfirm.body).toBe(200);
    expect(createConfirm.json().status).toBe("executed");
    expect(createConfirm.json().result.message).toBe("Gedaechtniseintrag wurde angelegt.");
    const created = (await owner.get("/api/v1/memory", { query: { q: "Sprachnotiz" } })).json().items as Memory[];
    expect(created).toHaveLength(1);

    const updateText = "Aktualisiere den Gedächtniseintrag Sprachnotiz aus dem Kommandopfad auf Sprachnotiz aktualisiert";
    const updatePreview = await owner.post("/api/v1/commands", { text: updateText, source: "text" });
    expect(updatePreview.json().previewText).toBe("Gedächtniseintrag „Sprachnotiz aus dem Kommandopfad“ aktualisieren?");
    const updateConfirm = await owner.post("/api/v1/commands",
      { text: updateText, source: "text", confirm: true, previewId: updatePreview.json().previewId });
    expect(updateConfirm.json().status).toBe("executed");
    const updatedId = created[0]!.id;
    expect((await owner.get(`/api/v1/memory/${updatedId}`)).json().data.content).toBe("Sprachnotiz aktualisiert");

    const unknown = await owner.post("/api/v1/commands", { text: "Lösche den Gedächtniseintrag Hologramm", source: "text" });
    expect(unknown.statusCode, unknown.body).toBe(404);
    // Two entries with the same title make the spoken reference ambiguous: 409 before anything is staged.
    await createMemory(owner, "Duplikatstest");
    await createMemory(owner, "Duplikatstest");
    const ambiguous = await owner.post("/api/v1/commands", { text: "Vergiss den Eintrag Duplikatstest", source: "text" });
    expect(ambiguous.statusCode, ambiguous.body).toBe(409);
    expect(ambiguous.json().error.message).toContain("Mehrere Gedächtniseinträge");
    expect(stagedRows(api)).toBe(4);

    const files = (await owner.get("/api/v1/files", { query: { limit: "100" } })).json().items as FileItem[];
    const target = files.find((file) => file.name === "Quartalsbericht Q3 2026.pdf")!;
    const renameText = "Benenne die Datei Quartalsbericht Q3 2026.pdf um in Abschlussbericht Q3 2026.pdf";
    const renamePreview = await owner.post("/api/v1/commands", { text: renameText, source: "text" });
    expect(renamePreview.statusCode, renamePreview.body).toBe(200);
    expect(renamePreview.json().previewText)
      .toBe("Datei „Quartalsbericht Q3 2026.pdf“ in „Abschlussbericht Q3 2026.pdf“ umbenennen?");
    const renameConfirm = await owner.post("/api/v1/commands",
      { text: renameText, source: "text", confirm: true, previewId: renamePreview.json().previewId });
    expect(renameConfirm.json().status).toBe("executed");
    expect((await owner.get(`/api/v1/files/${target.id}`)).json().data.name).toBe("Abschlussbericht Q3 2026.pdf");

    const deleteText = "Lösche die Datei Abschlussbericht Q3 2026.pdf";
    const deletePreview = await owner.post("/api/v1/commands", { text: deleteText, source: "text" });
    expect(deletePreview.json().status).toBe("requires_confirmation");
    const deleteConfirm = await owner.post("/api/v1/commands",
      { text: deleteText, source: "text", confirm: true, previewId: deletePreview.json().previewId });
    expect(deleteConfirm.json().status).toBe("executed");
    expect(deleteConfirm.json().result.message).toContain("zur Freigabe angemeldet");
  } finally { await api.close(); }
});

it("clears staged knowledge drafts with the dev scenario reset", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginDev("owner");
    const staged = await owner.post("/api/v1/memory", { type: "fact", content: "Wird verworfen" });
    expect(staged.statusCode).toBe(403);
    expect(stagedRows(api)).toBe(1);
    await owner.post("/api/v1/dev/scenarios/control", { action: "reset" });
    expect(stagedRows(api)).toBe(0);
    const confirmed = await owner.post("/api/v1/memory", { type: "fact", content: "Wird verworfen" },
      { headers: confirmedHeaders(previewOf(staged)) });
    expect(confirmed.statusCode, confirmed.body).toBe(409);
  } finally { await api.close(); }
});
