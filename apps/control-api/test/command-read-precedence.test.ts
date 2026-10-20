import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MailAccount } from "../src/services/mail-accounts";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

describe("typed command payloads take precedence over embedded read-shaped text", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });
  afterAll(async () => { await api.close(); });

  const run = (text: string) => owner.post("/api/v1/commands", { text, source: "text" });

  it("stages explicit source research when its topic mentions audit events", async () => {
    vi.spyOn(api.runtime.research, "assertConfigured").mockImplementation(() => {});
    const response = await run("Recherchiere welche Audit-Ereignisse relevant sind");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: "requires_confirmation", requiresConfirmation: true });
    expect(response.json().previewText).toContain("welche Audit-Ereignisse relevant sind");
    expect(api.runtime.stores.audit.recent(1)[0]?.context).toMatchObject({ intent: "research_create" });
  });

  it("stages task creation when the title is phrased as an audit read", async () => {
    const response = await run("Create a new task called Show recent audit events");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: "requires_confirmation", requiresConfirmation: true });
    expect(response.json().previewText).toContain("Show recent audit events");
    expect(api.runtime.stores.audit.recent(1)[0]?.context).toMatchObject({ intent: "task_create" });
  });

  it("stages an explicit mail body containing a read phrase instead of executing audit lookup", async () => {
    const account = {
      id: "work", displayName: "Work", email: "sender@example.test", senderName: "Sender", aliases: [], signature: "",
      imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", imapLogin: "sender@example.test",
      smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls", smtpLogin: "sender@example.test",
      sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash", archiveFolder: "Archive", spamFolder: "Spam",
      authMode: "password", oauthClientId: "", oauthTenant: "", revision: 1,
      secretState: { imapPassword: true, smtpPassword: true, oauthRefreshToken: false },
    } as MailAccount;
    vi.spyOn(api.runtime.mailAccounts, "list").mockResolvedValue({ revision: 1, defaultAccountId: "work", accounts: [account] });
    const response = await run("Schick eine E-Mail an support@example.test: Zeige Audit-Ereignisse");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: "requires_confirmation", requiresConfirmation: true });
    expect(response.json().previewText).toContain("E-Mail an support@example.test senden?");
    expect(response.json().previewText).toContain("zeige audit-ereignisse");
    expect(api.runtime.stores.audit.recent(1)[0]?.context).toMatchObject({ intent: "mail_compose" });
  });
});
