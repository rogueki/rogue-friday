import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";
import type { MailAccount } from "../src/services/mail-accounts";

describe("read-only Hermes mail bridge", () => {
  it("uses a distinct persisted key and reads only the three GET operations on loopback", async () => {
    const logs: string[] = [];
    const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", logs });
    try {
      const key = api.runtime.mailBridgeKey.toString("base64");
      expect(key).not.toBe(api.runtime.voiceBridgeKey.toString("base64"));
      expect(key).not.toBe(api.runtime.calendarBridgeKey.toString("base64"));
      expect(readFileSync(join(api.config.paths.dataDir, "mail-bridge", "auth.key"), "utf8").trim()).toBe(key);
      const bridge = { authorization: `Bearer ${key}` };
      const client = api.client();
      const account = { id: "work", displayName: "Work", email: "sender@example.test", senderName: "Sender", aliases: [],
        signature: "", imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", imapLogin: "sender@example.test",
        smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls", smtpLogin: "sender@example.test",
        sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash", archiveFolder: "Archive", spamFolder: "Spam",
        revision: 1, authMode: "password", oauthClientId: "", oauthTenant: "",
        secretState: { imapPassword: true, smtpPassword: true, oauthRefreshToken: false } } as MailAccount;
      vi.spyOn(api.runtime.mailAccounts, "list").mockResolvedValue({ revision: 1, defaultAccountId: "work", accounts: [account] });
      vi.spyOn(api.runtime.mailAccounts, "folders").mockResolvedValue({ folders: [] });
      vi.spyOn(api.runtime.mailAccounts, "envelopes").mockResolvedValue({ mailbox: "INBOX", uidValidity: "1", page: 1, items: [] });
      vi.spyOn(api.runtime.mailAccounts, "message").mockResolvedValue({ mailbox: "INBOX", uid: "1", uidValidity: "1",
        subject: "Test", from: "sender@example.test", date: "2026-10-16", bodyText: "Hello", messageId: "<synthetic@example.test>",
        replyTo: "", references: "", to: "sender@example.test", attachments: [] });

      expect((await client.get("/api/v1/communication/himalaya/mailboxes", { headers: bridge })).statusCode).toBe(200);
      expect((await client.get("/api/v1/communication/himalaya/envelopes?mailbox=INBOX", { headers: bridge })).statusCode).toBe(200);
      expect((await client.get("/api/v1/communication/himalaya/message?mailbox=INBOX&id=1", { headers: bridge })).statusCode).toBe(200);
      expect((await client.get("/api/v1/communication/himalaya/mailboxes", { headers: { authorization: "Bearer invalid" } })).statusCode).toBe(401);
      expect((await client.get("/api/v1/communication/himalaya/mailboxes", { headers: { authorization: `Bearer ${api.runtime.calendarBridgeKey.toString("base64")}` } })).statusCode).toBe(403);
      expect((await client.get("/api/v1/communication/himalaya/mailboxes", { headers: { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` } })).statusCode).toBe(200);
      expect((await api.fastify.inject({ method: "GET", url: "/api/v1/communication/himalaya/mailboxes", remoteAddress: "192.0.2.2", headers: bridge })).statusCode).toBe(403);
      expect((await client.get("/api/v1/skills", { headers: bridge })).statusCode).toBe(403);
      expect((await client.get("/api/v1/settings/himalaya-account", { headers: bridge })).statusCode).toBe(403);

      const owner = api.client();
      expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
      expect((await owner.post("/api/v1/communication/himalaya/send", {}, { headers: bridge })).statusCode).toBe(403);
      expect((await owner.get("/api/v1/skills", { headers: bridge })).statusCode).toBe(403);
      expect(logs.join("\n")).not.toContain(key);
    } finally { await api.close(); }
  });

  it("reaches the mail service and reports unconfigured state without an Owner session", async () => {
    const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password" });
    try {
      const bridge = { authorization: `Bearer ${api.runtime.mailBridgeKey.toString("base64")}` };
      const client = api.client();
      expect((await client.get("/api/v1/communication/himalaya/mailboxes", { headers: bridge })).statusCode).toBe(503);
      expect((await client.get("/api/v1/communication/himalaya/mailboxes")).statusCode).toBe(401);
    } finally { await api.close(); }
  });
});
