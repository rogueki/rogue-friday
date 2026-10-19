import { expect, it, vi } from "vitest";
import type { MailAccount } from "../src/services/mail-accounts";
import { startTestApi } from "./helpers";

const account = { id: "work", displayName: "Geschäftspostfach", email: "sender@example.test",
  senderName: "Sender", signature: "", aliases: [], sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash",
  archiveFolder: "Archive", spamFolder: "Spam", revision: 1, authMode: "password", oauthClientId: "", oauthTenant: "",
  imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", imapLogin: "sender@example.test",
  smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls", smtpLogin: "sender@example.test",
  secretState: { imapPassword: true, smtpPassword: true, oauthRefreshToken: false } } as MailAccount;
const message = { to: ["recipient@example.test"], from: "sender@example.test", subject: "Synthetic",
  body: "Fixture body" };

it("exposes account-scoped receipts and retries only the Sent archive after SMTP acknowledgement", async () => {
  const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
  try {
    vi.spyOn(api.runtime.mailAccounts, "list").mockResolvedValue({ revision: 1, defaultAccountId: "work", accounts: [account] });
    vi.spyOn(api.runtime.mailAccounts, "check").mockResolvedValue({ ok: true });
    const send = vi.spyOn(api.runtime.mailAccounts, "send").mockResolvedValue({ state: "sent", archivePending: true });
    const archive = vi.spyOn(api.runtime.mailAccounts, "archive").mockResolvedValue({ state: "archived", alreadyPresent: false });
    const owner = api.client();
    await owner.loginOwner("synthetic-test-password");
    const base = "/api/v1/integrations/mail/accounts/work";
    const sent = await owner.post(base + "/send", message, { headers: { "Idempotency-Key": "mail-route-key-123" } });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.headers["idempotent-replayed"]).toBe("false");
    expect(sent.json().data).toMatchObject({ state: "sent", archivePending: true });
    const receiptId = sent.json().data.receiptId as string;
    expect(receiptId).toMatch(/^[a-f0-9]{64}$/);
    const listed = await owner.get(base + "/receipts");
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().data.items).toContainEqual(expect.objectContaining({ receiptId, archivePending: true }));
    expect((await owner.post(base + "/receipts/" + receiptId + "/archive", { ...message, body: "tampered" })).statusCode).toBe(409);
    const reconciled = await owner.post(base + "/receipts/" + receiptId + "/archive", message);
    expect(reconciled.statusCode, reconciled.body).toBe(200);
    expect(reconciled.json().data).toMatchObject({ receiptId, state: "sent", archivePending: false });
    expect(send).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenCalledTimes(1);
    const replay = await owner.post(base + "/send", message, { headers: { "Idempotency-Key": "mail-route-key-123" } });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(send).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});

it("requires owner session to start OAuth and completes Google callback only with issued state", async () => {
  const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
  try {
    vi.spyOn(api.runtime.mailAccounts, "list").mockResolvedValue({ revision: 1, defaultAccountId: "work",
      accounts: [{ ...account, authMode: "google-oauth", oauthClientId: "synthetic-client-id" }] });
    const complete = vi.spyOn(api.runtime.mailAccounts, "completeOAuth").mockResolvedValue({ ...account,
      authMode: "google-oauth", oauthClientId: "synthetic-client-id",
      secretState: { ...account.secretState, oauthRefreshToken: true } });
    const startPath = "/api/v1/integrations/mail/accounts/work/oauth/start";
    expect((await api.client().post(startPath)).statusCode).toBe(401);
    const owner = api.client();
    await owner.loginOwner("synthetic-test-password");
    const started = await owner.post(startPath);
    expect(started.statusCode, started.body).toBe(200);
    const flowId = started.json().data.flowId as string;
    const callback = "/api/v1/integrations/mail/oauth/google/callback";
    expect((await api.client().get(callback, { query: { state: "bad-state-1234567890", code: "synthetic-code-123" } })).statusCode).toBe(422);
    const provider = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ access_token: "access",
      refresh_token: "synthetic-refresh-token", scope: "https://mail.google.com/" }) });
    vi.stubGlobal("fetch", provider);
    const result = await api.client().get(callback, { query: { state: flowId, code: "synthetic-code-123" } });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().data).toMatchObject({ authorized: true, pending: false, accountId: "work" });
    expect(complete).toHaveBeenCalledWith("work", 1, "synthetic-refresh-token", ["https://mail.google.com/"]);
  } finally { vi.unstubAllGlobals(); await api.close(); }
});

it("marks a first draft response and its replay without a second provider append", async () => {
  const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
  try {
    const draft = vi.spyOn(api.runtime.mailAccounts, "draft").mockResolvedValue({ state: "drafted",
      messageId: "<friday-" + "a".repeat(64) + "@friday.local>", alreadyPresent: false });
    const owner = api.client();
    await owner.loginOwner("synthetic-test-password");
    const path = "/api/v1/integrations/mail/accounts/work/draft";
    const first = await owner.post(path, { subject: "", body: "" }, { headers: { "Idempotency-Key": "draft-fixture-123" } });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.headers["idempotent-replayed"]).toBe("false");
    const replay = await owner.post(path, { subject: "", body: "" }, { headers: { "Idempotency-Key": "draft-fixture-123" } });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(draft).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});
