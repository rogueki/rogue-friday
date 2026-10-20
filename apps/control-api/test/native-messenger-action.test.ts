import { expect, it, vi } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

type RunSpy = (action: "check" | "send", draft: unknown, revision?: string) => Promise<unknown>;

/** Routes the private runner bridge to a synthetic gateway: configured checks, sent deliveries. */
function mockRunner(api: TestApi, sendResult: unknown = { state: "sent", externalId: "syn-1" }) {
  const run = vi.spyOn(api.runtime.messengerSend as unknown as { run: RunSpy }, "run");
  run.mockImplementation(async (action: "check" | "send") =>
    action === "check" ? { state: "configured", revision: "r1" } : sendResult);
  return { run };
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

async function registerTarget(owner: ReturnType<TestApi["client"]>, platform: string, recipient: string) {
  const registered = await owner.post("/api/v1/messenger/targets",
    { accountId: "default", platform, recipient });
  expect(registered.statusCode, registered.body).toBe(200);
}

function stagedRows(api: TestApi): number {
  return (api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number }).count;
}

function sendCalls(run: ReturnType<typeof vi.spyOn>): number {
  return run.mock.calls.filter((call: unknown[]) => call[0] === "send").length;
}

it("takes a spoken compose through preview and native approval exactly once", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const { run } = mockRunner(api);
    const owner = api.client();
    await owner.loginDev("owner");
    await registerTarget(owner, "teams", "Anna");
    const text = "Schreib Anna über Teams dass das Release fertig ist";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().status).toBe("requires_confirmation");
    expect(preview.json().previewText).toBe("Nachricht über teams an Anna senden? Text: „das Release fertig ist“");
    const previewId = preview.json().previewId as string;
    const changed = await owner.post("/api/v1/commands",
      { text: "Schreib Anna über Teams dass das Release manipuliert ist", source: "text", confirm: true, previewId });
    expect(changed.statusCode).toBe(409);
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.json().status).toBe("requires_approval");
    const approvalId = confirmed.json().approvalId as string;
    const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect(opened.json().data.action).toBe("Nachricht senden: teams/Anna");
    const decided = await approveNative(owner, approvalId);
    expect(decided.status).toBe("executed");
    expect(decided.executionResult).toMatch(/^Nachricht [a-f0-9]{64} versendet\.$/);
    expect(sendCalls(run)).toBe(1);
    const sentDraft = run.mock.calls.find((call: unknown[]) => call[0] === "send")![1] as Record<string, unknown>;
    expect(sentDraft).toMatchObject({ platform: "teams", recipient: "Anna", text: "das Release fertig ist" });
    const reopened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect((await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
      { headers: { "x-approval-token": String(reopened.headers["x-approval-token"] ?? "") } })).statusCode).toBe(409);
    expect(sendCalls(run)).toBe(1);
  } finally { await api.close(); }
});

it("executes a spoken compose once with tier-2 disabled and answers the replay from the journal", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const { run } = mockRunner(api);
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    await registerTarget(owner, "telegram", "12345678");
    const text = "Schick eine Telegram-Nachricht dass ich morgen später komme";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().status).toBe("requires_confirmation");
    expect(preview.json().previewText).toBe("Nachricht über telegram an 12345678 senden? Text: „ich morgen später komme“");
    const previewId = preview.json().previewId as string;
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect(confirmed.json().result.message).toBe("Nachricht wurde versendet.");
    expect(sendCalls(run)).toBe(1);
    const repeated = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().status).toBe("executed");
    expect(sendCalls(run)).toBe(1);
    const receipts = await owner.get("/api/v1/messenger/receipts");
    expect(receipts.json().data.items).toHaveLength(1);
    expect(receipts.json().data.items[0]).toMatchObject({ platform: "telegram", recipient: "12345678", state: "sent" });
  } finally { await api.close(); }
});

it("binds a spoken reply to the newest inbound observation of the channel", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const { run } = mockRunner(api);
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    await registerTarget(owner, "telegram", "12345678");
    api.runtime.db.prepare("INSERT INTO messenger_sender_observations VALUES (?,?,?,?,?,?)")
      .run("a".repeat(64), "telegram", "default", "sender-1", "12345678", new Date().toISOString());
    const text = "Antworte auf die letzte Telegram-Nachricht dass ich unterwegs bin";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().previewText).toBe("Nachricht über telegram an 12345678 senden? Text: „ich unterwegs bin“");
    const confirmed = await owner.post("/api/v1/commands",
      { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    const sentDraft = run.mock.calls.find((call: unknown[]) => call[0] === "send")![1] as Record<string, unknown>;
    expect(sentDraft).toMatchObject({ platform: "telegram", recipient: "12345678", text: "ich unterwegs bin" });
  } finally { await api.close(); }
});

it("fails unknown recipients, ambiguous channels and unconfigured channels before any preview is staged", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const { run } = mockRunner(api);
    const owner = api.client();
    await owner.loginDev("owner");
    await registerTarget(owner, "teams", "Anna");
    await registerTarget(owner, "teams", "Bert");
    const unknown = await owner.post("/api/v1/commands",
      { text: "Schreib Unbekannt über Teams dass hallo", source: "text" });
    expect(unknown.statusCode, unknown.body).toBe(404);
    const ambiguous = await owner.post("/api/v1/commands",
      { text: "Schick eine Teams-Nachricht dass hallo", source: "text" });
    expect(ambiguous.statusCode, ambiguous.body).toBe(409);
    expect(ambiguous.json().error.message).toContain("Mehrere Empfaenger");
    const noTarget = await owner.post("/api/v1/commands",
      { text: "Schick eine Signal-Nachricht dass hallo", source: "text" });
    expect(noTarget.statusCode, noTarget.body).toBe(404);
    await registerTarget(owner, "whatsapp", "+4915112345678");
    run.mockImplementation(async (action: "check" | "send") =>
      action === "check" ? { state: "rejected", reason: "platform_not_configured" } : { state: "uncertain" });
    const unconfigured = await owner.post("/api/v1/commands",
      { text: "Schreib +4915112345678 über WhatsApp dass hallo", source: "text" });
    expect(unconfigured.statusCode, unconfigured.body).toBe(503);
    expect(unconfigured.json().error.message).toContain("nicht konfiguriert");
    expect(stagedRows(api)).toBe(0);
  } finally { await api.close(); }
});

it("fails a reply without a registered target for the observed chat before staging", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    mockRunner(api);
    const owner = api.client();
    await owner.loginDev("owner");
    const noObservation = await owner.post("/api/v1/commands",
      { text: "Antworte auf die letzte Telegram-Nachricht dass hallo", source: "text" });
    expect(noObservation.statusCode, noObservation.body).toBe(404);
    api.runtime.db.prepare("INSERT INTO messenger_sender_observations VALUES (?,?,?,?,?,?)")
      .run("b".repeat(64), "telegram", "default", "sender-9", "87654321", new Date().toISOString());
    const unregistered = await owner.post("/api/v1/commands",
      { text: "Antworte auf die letzte Telegram-Nachricht dass hallo", source: "text" });
    expect(unregistered.statusCode, unregistered.body).toBe(404);
    expect(stagedRows(api)).toBe(0);
  } finally { await api.close(); }
});

it("records an uncertain gateway outcome and never sends twice on replay", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const { run } = mockRunner(api, { state: "uncertain" });
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    await registerTarget(owner, "teams", "Anna");
    const text = "Schreib Anna über Teams dass der Router neu startet";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    const confirmed = await owner.post("/api/v1/commands",
      { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect(confirmed.json().result.message).toBe("Zustellung unklar; bitte den Kanal pruefen.");
    const repeated = await owner.post("/api/v1/commands",
      { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(sendCalls(run)).toBe(1);
    const receipts = await owner.get("/api/v1/messenger/receipts");
    expect(receipts.json().data.items[0]).toMatchObject({ state: "uncertain" });
  } finally { await api.close(); }
});

it("clears staged messenger drafts with the dev scenario reset", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    mockRunner(api);
    const owner = api.client();
    await owner.loginDev("owner");
    await registerTarget(owner, "teams", "Anna");
    const text = "Schreib Anna über Teams dass Reset ansteht";
    const staged = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(staged.json().status).toBe("requires_confirmation");
    expect(stagedRows(api)).toBe(1);
    await owner.post("/api/v1/dev/scenarios/control", { action: "reset" });
    expect(stagedRows(api)).toBe(0);
    const confirmed = await owner.post("/api/v1/commands",
      { text, source: "text", confirm: true, previewId: staged.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(409);
  } finally { await api.close(); }
});

it("keeps the message text out of the audit trail while the stored draft binds it", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    mockRunner(api);
    const owner = api.client();
    await owner.loginDev("owner");
    await registerTarget(owner, "teams", "Anna");
    const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
    const text = "Schreib Anna über Teams dass das Passwort geheim-123 intern bleibt";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.json().status).toBe("requires_confirmation");
    const row = api.runtime.db.prepare("SELECT action_json FROM native_approval_requests WHERE owner_id = ?")
      .get(ownerId) as { action_json: string };
    expect(row.action_json).toContain("geheim-123"); // the stored draft binds the exact text…
    const audit = api.runtime.db.prepare("SELECT json FROM audit_log ORDER BY seq DESC LIMIT 10")
      .all() as Array<{ json: string }>;
    expect(JSON.stringify(audit)).not.toContain("geheim-123"); // …but nothing reaches the audit trail.
  } finally { await api.close(); }
});
