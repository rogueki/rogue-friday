import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MailAccountsService } from "../src/services/mail-accounts";
import { ApiError } from "../src/util/errors";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** Install layout the service expects: `<root>/config/install-state.json` plus a Windows-absolute data dir. */
function installRoot(): string {
  const parent = mkdtempSync(join(tmpdir(), "friday-mail-"));
  roots.push(parent);
  const root = join(parent, "Friday");
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "install-state.json"),
    JSON.stringify({ distro_name: "Friday", linux_user: "friday" }));
  return join(root, "data");
}

const service = (failure: () => Promise<Record<string, unknown>>) =>
  new MailAccountsService(installRoot(), async () => failure());

async function codeOf(promise: Promise<unknown>): Promise<{ code: string; message: string; details: unknown }> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    return { code: api.code, message: api.message, details: api.details };
  }
  throw new Error("Die Bruecke haette den Fehler melden muessen.");
}

describe("mail runner error mapping", () => {
  it("turns a stale folder into a conflict that asks for a fresh list", async () => {
    const mapped = await codeOf(service(async () => {
      throw new Error("mail_runner_4:uidvalidity_conflict");
    }).message("work", "INBOX", "17", "41"));
    expect(mapped.code).toBe("CONFLICT");
    expect(mapped.message).toContain("Ordner wurde neu aufgebaut");
  });

  it("names the sender field when the alias does not belong to the account", async () => {
    const mapped = await codeOf(service(async () => {
      throw new Error("mail_runner_4:invalid_sender");
    }).send("work", { to: ["recipient@example.test"], from: "fremd@example.test", subject: "Test", body: "Hallo" }));
    expect(mapped.code).toBe("VALIDATION_FAILED");
    expect(mapped.message).toContain("Absender gehört nicht zu diesem Konto");
    expect(mapped.details).toEqual({ fieldErrors: [{ path: "from", message: expect.stringContaining("Alias") }] });
  });

  it("explains a missing recipient and keeps unknown runner failures unavailable", async () => {
    const recipient = await codeOf(service(async () => ({ error: "invalid_recipients" }))
      .send("work", { to: [], from: "sender@example.test", subject: "Test", body: "Hallo" }));
    expect(recipient.code).toBe("VALIDATION_FAILED");
    expect(recipient.details).toEqual({ fieldErrors: [{ path: "to", message: expect.stringContaining("Empfänger") }] });
    const unknown = await codeOf(service(async () => ({ error: "something_else" })).folders("work"));
    expect(unknown.code).toBe("ADAPTER_UNAVAILABLE");
    expect(unknown.message).toContain("nicht erreichbar");
  });

  it("maps a revision conflict and a missing account before the generic fallback", async () => {
    const revision = await codeOf(service(async () => ({ error: "revision_conflict" })).upsert(
      { displayName: "Geschäft", email: "sender@example.test", senderName: "Sender", aliases: [], signature: "",
        imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", imapLogin: "sender@example.test",
        smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls", smtpLogin: "sender@example.test",
        sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash", archiveFolder: "Archive", spamFolder: "Spam" },
      { imapPassword: "synthetic", smtpPassword: "synthetic" }, 4));
    expect(revision.code).toBe("CONFLICT");
    expect(revision.message).toContain("inzwischen geändert");
    const missing = await codeOf(service(async () => {
      throw new Error("mail_runner_6:account_not_found");
    }).folders("work"));
    expect(missing.code).toBe("VALIDATION_FAILED");
    expect(missing.message).toContain("existiert nicht");
  });
});