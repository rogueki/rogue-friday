import { expect, it, vi } from "vitest";
import type { MailAccount } from "../src/services/mail-accounts";
import { startTestApi, type TestApi } from "./helpers";

const account = { id: "work", displayName: "Geschäftspostfach", email: "sender@example.test",
  senderName: "Sender", signature: "", aliases: [], sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash",
  archiveFolder: "Archive", spamFolder: "Spam", revision: 1, authMode: "password", oauthClientId: "", oauthTenant: "",
  imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", imapLogin: "sender@example.test",
  smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls", smtpLogin: "sender@example.test",
  secretState: { imapPassword: true, smtpPassword: true, oauthRefreshToken: false } } as MailAccount;

async function ownerIdOf(owner: ReturnType<TestApi["client"]>): Promise<string> {
  return (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
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

function mockMailbox(api: TestApi) {
  vi.spyOn(api.runtime.mailAccounts, "list").mockResolvedValue({ revision: 1, defaultAccountId: "work", accounts: [account] });
  vi.spyOn(api.runtime.mailAccounts, "check").mockResolvedValue({ ok: true });
  const send = vi.spyOn(api.runtime.mailAccounts, "send").mockResolvedValue({ state: "sent" as const, archivePending: false });
  return { send };
}

function stagedRows(api: TestApi): number {
  return (api.runtime.db.prepare("SELECT COUNT(*) AS count FROM native_approval_requests").get() as { count: number }).count;
}

it("takes a spoken compose through preview and native approval exactly once", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const { send } = mockMailbox(api);
    const owner = api.client();
    await owner.loginDev("owner");
    const text = "Schreibe eine Mail an erik@example.test mit dem Betreff Projektstatus: das Release ist fertig";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().status).toBe("requires_confirmation");
    expect(preview.json().previewText).toBe("E-Mail an erik@example.test senden? Betreff: „Projektstatus“");
    const previewId = preview.json().previewId as string;
    const changed = await owner.post("/api/v1/commands",
      { text: "Schreibe eine Mail an erik@example.test mit dem Betreff Projektstatus: manipuliert", source: "text", confirm: true, previewId });
    expect(changed.statusCode).toBe(409);
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.json().status).toBe("requires_approval");
    const approvalId = confirmed.json().approvalId as string;
    const opened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect(opened.json().data.action).toBe("Mail senden: Projektstatus");
    const decided = await approveNative(owner, approvalId);
    expect(decided.status).toBe("executed");
    expect(decided.executionResult).toMatch(/^Mail [a-f0-9]{64} versendet\.$/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe("work");
    expect(send.mock.calls[0]![1]).toMatchObject({ to: ["erik@example.test"], subject: "Projektstatus",
      body: "das Release ist fertig" });
    const reopened = await owner.get(`/api/v1/approvals/${approvalId}`);
    expect((await owner.post(`/api/v1/approvals/${approvalId}/approve`, {},
      { headers: { "x-approval-token": String(reopened.headers["x-approval-token"] ?? "") } })).statusCode).toBe(409);
    expect(send).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});

it("executes a spoken compose once with tier-2 disabled and answers the replay from the journal", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const { send } = mockMailbox(api);
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const text = "Sende eine Mail an anna@example.test dass ich morgen später komme";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.json().status).toBe("requires_confirmation");
    const previewId = preview.json().previewId as string;
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect(confirmed.json().result.message).toBe("E-Mail wurde versendet.");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toMatchObject({ to: ["anna@example.test"], subject: "ich morgen spaeter komme" });
    const repeated = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().status).toBe("executed");
    expect(send).toHaveBeenCalledTimes(1);
    const receipts = await owner.get("/api/v1/integrations/mail/accounts/work/receipts");
    expect(receipts.json().data.items).toHaveLength(1);
    expect(receipts.json().data.items[0]).toMatchObject({ state: "sent" });
  } finally { await api.close(); }
});

it("binds a spoken reply to the newest sender mail with reply headers", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const { send } = mockMailbox(api);
    vi.spyOn(api.runtime.mailAccounts, "search").mockResolvedValue({ mailbox: "INBOX", uidValidity: "u9", page: 1,
      items: [{ id: "55", subject: "Terminabstimmung", from: "Becker, Frau <becker@example.test>",
        date: "2026-10-18T09:00:00Z", messageId: "<m1@example.test>" }] });
    vi.spyOn(api.runtime.mailAccounts, "message").mockResolvedValue({ subject: "Terminabstimmung",
      from: "Becker, Frau <becker@example.test>", messageId: "<m1@example.test>", references: "<m0@example.test>",
      date: "2026-10-18T09:00:00Z" });
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const text = "Antworte auf die Mail von Frau Becker dass der Termin passt";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().previewText).toBe("E-Mail an becker@example.test senden? Betreff: „Re: Terminabstimmung“");
    const confirmed = await owner.post("/api/v1/commands",
      { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toMatchObject({ to: ["becker@example.test"], subject: "Re: Terminabstimmung",
      body: "der Termin passt", inReplyTo: "<m1@example.test>", references: "<m0@example.test> <m1@example.test>" });
  } finally { await api.close(); }
});

it("fails unknown or ambiguous recipients before any preview is staged", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    mockMailbox(api);
    const search = vi.spyOn(api.runtime.mailAccounts, "search");
    search.mockResolvedValueOnce({ mailbox: "INBOX", uidValidity: "u1", page: 1, items: [] });
    const owner = api.client();
    await owner.loginDev("owner");
    const unknown = await owner.post("/api/v1/commands", { text: "Schreibe eine Mail an Unbekannt dass hallo", source: "text" });
    expect(unknown.statusCode, unknown.body).toBe(404);
    search.mockResolvedValueOnce({ mailbox: "INBOX", uidValidity: "u1", page: 1, items: [
      { id: "1", from: "Becker, Anna <a.becker@example.test>", date: "2026-10-18T09:00:00Z" },
      { id: "2", from: "Becker, Bert <b.becker@example.test>", date: "2026-10-17T09:00:00Z" }] });
    const ambiguous = await owner.post("/api/v1/commands", { text: "Schreibe eine Mail an Becker dass hallo", source: "text" });
    expect(ambiguous.statusCode, ambiguous.body).toBe(409);
    expect(ambiguous.json().error.message).toContain("Mehrere Empfaenger");
    expect(ambiguous.json().error.details).toMatchObject({ clarificationRequired: true });
    expect(stagedRows(api)).toBe(0);
  } finally { await api.close(); }
});

it("records an uncertain SMTP outcome and never sends twice on replay", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    mockMailbox(api);
    vi.spyOn(api.runtime.mailAccounts, "send").mockRejectedValue(new Error("smtp timeout after RCPT"));
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const text = "Sende eine Mail an anna@example.test dass der Router neu startet";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    const confirmed = await owner.post("/api/v1/commands",
      { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("executed");
    expect(confirmed.json().result.message).toBe("Versand unklar; bitte Mail-Eingang pruefen.");
    const repeated = await owner.post("/api/v1/commands",
      { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(api.runtime.mailAccounts.send).toHaveBeenCalledTimes(1);
    const receipts = await owner.get("/api/v1/integrations/mail/accounts/work/receipts");
    expect(receipts.json().data.items[0]).toMatchObject({ state: "uncertain" });
  } finally { await api.close(); }
});

it("gates a move through staging and keeps an uidvalidity conflict uncertain without a second change", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    mockMailbox(api);
    const change = vi.spyOn(api.runtime.mailAccounts, "change").mockResolvedValue({ changed: true });
    const owner = api.client();
    await owner.loginDev("owner");
    await disableTier2(owner);
    const base = "/api/v1/integrations/mail/accounts/work/change";
    const body = { mailbox: "INBOX", uid: "55", uidValidity: "u9", kind: "move", destination: "Archive" };
    const staged = await owner.post(base, body);
    expect(staged.statusCode, staged.body).toBe(403);
    expect(staged.json().error.details.previewText).toBe("E-Mail aus „INBOX“ nach „Archive“ verschieben?");
    const previewId = staged.json().error.details.previewId as string;
    expect(change).not.toHaveBeenCalled();
    const confirmed = await owner.post(base, body, { headers: { "X-Action-Preview-Id": previewId } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.headers["idempotent-replayed"]).toBe("false");
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith("work", "INBOX", "55", "u9", "move", "Archive");
    const replay = await owner.post(base, body, { headers: { "X-Action-Preview-Id": previewId } });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(change).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});

it("fails an unknown account or foreign sender before any mail preview is staged", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    mockMailbox(api);
    const owner = api.client();
    await owner.loginDev("owner");
    const message = { to: ["recipient@example.test"], from: "sender@example.test", subject: "Synthetic", body: "Fixture" };
    const unknown = await owner.post("/api/v1/integrations/mail/accounts/ghost/send", message);
    expect(unknown.statusCode, unknown.body).toBe(422);
    const foreign = await owner.post("/api/v1/integrations/mail/accounts/work/send", { ...message, from: "other@example.test" });
    expect(foreign.statusCode, foreign.body).toBe(422);
    expect(stagedRows(api)).toBe(0);
  } finally { await api.close(); }
});

it("clears staged mail drafts with the dev scenario reset", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    mockMailbox(api);
    const owner = api.client();
    await owner.loginDev("owner");
    const staged = await owner.post("/api/v1/integrations/mail/accounts/work/send",
      { to: ["recipient@example.test"], subject: "Reset-Kandidat", body: "Fixture" });
    expect(staged.statusCode).toBe(403);
    expect(stagedRows(api)).toBe(1);
    await owner.post("/api/v1/dev/scenarios/control", { action: "reset" });
    expect(stagedRows(api)).toBe(0);
    expect((await owner.post("/api/v1/integrations/mail/accounts/work/send",
      { to: ["recipient@example.test"], subject: "Reset-Kandidat", body: "Fixture" },
      { headers: { "X-Action-Preview-Id": staged.json().error.details.previewId } })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("keeps mail contents out of staged previews and audit entries", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    mockMailbox(api);
    const owner = api.client();
    await owner.loginDev("owner");
    const ownerId = await ownerIdOf(owner);
    const text = "Sende eine Mail an anna@example.test mit dem Betreff Status: das Passwort geheim-123 bleibt intern";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.json().status).toBe("requires_confirmation");
    expect(preview.json().previewText).not.toContain("geheim-123");
    const row = api.runtime.db.prepare("SELECT action_json FROM native_approval_requests WHERE owner_id = ?")
      .get(ownerId) as { action_json: string };
    expect(row.action_json).toContain("geheim-123"); // stored draft binds the exact body…
    const audit = api.runtime.db.prepare("SELECT json FROM audit_log ORDER BY seq DESC LIMIT 10")
      .all() as Array<{ json: string }>;
    expect(JSON.stringify(audit)).not.toContain("geheim-123"); // …but nothing reaches the audit trail.
  } finally { await api.close(); }
});
