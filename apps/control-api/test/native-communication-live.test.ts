/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailAccount } from "../src/services/mail-accounts";
import type { MessengerCatalogItem } from "../src/services/messenger-catalog";
import type { TelephonyStatus } from "../src/services/telephony";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const PASSWORD = "friday-live-owner-2026";
const roots: string[] = [];
const apis: TestApi[] = [];

/** A fresh live installation: no adapters.yaml entry for communication, the WSL bridges are faked per test. */
async function boot(): Promise<{ api: TestApi; owner: ApiClient }> {
  const root = mkdtempSync(join(tmpdir(), "friday-native-communication-"));
  roots.push(root);
  const dir = join(root, "install");
  mkdirSync(dir, { recursive: true });
  const api = await startTestApi({ dir, dataMode: "live", authMode: "local", ownerPassword: PASSWORD, responseValidation: "throw" });
  apis.push(api);
  const owner = api.client();
  expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
  return { api, owner };
}

const messenger = (platform: string, partial: Partial<MessengerCatalogItem> = {}): MessengerCatalogItem => ({
  platform, source: "builtin", fields: [], configured: false, gatewayRunning: false, connectionState: "unknown",
  exactSendSupported: true, nativeSetupAvailable: true, ...partial,
});
const telephonyOff = { configured: false, mode: null, ariReachable: false, registration: "unavailable", ownerEndpoint: "unknown",
  configurationApplied: false, dialplanLoaded: false, ready: false, revision: 0, callerId: null } as TelephonyStatus;
const account = { id: "work", displayName: "Geschäft", email: "erik.brandt@example.test", senderName: "Erik Brandt", signature: "",
  aliases: [], sentFolder: "Sent", draftsFolder: "Drafts", trashFolder: "Trash", archiveFolder: "Archive", spamFolder: "Spam",
  revision: 1, authMode: "password", oauthClientId: "", oauthTenant: "", imapHost: "imap.example.test", imapPort: 993,
  imapSecurity: "tls", imapLogin: "erik.brandt@example.test", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
  smtpLogin: "erik.brandt@example.test", secretState: { imapPassword: true, smtpPassword: true, oauthRefreshToken: false } } as MailAccount;

function fakeBridges(api: TestApi, mailAccounts: MailAccount[], catalog: MessengerCatalogItem[]): void {
  vi.spyOn(api.runtime.mailAccounts, "list").mockResolvedValue({ revision: 1, defaultAccountId: mailAccounts[0]?.id ?? null, accounts: mailAccounts });
  vi.spyOn(api.runtime.messengerCatalog, "list").mockResolvedValue({ pin: "d923a5eb", items: catalog });
  vi.spyOn(api.runtime.telephony, "status").mockResolvedValue(telephonyOff);
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const api of apis.splice(0)) await api.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("the built-in communication adapter in the live runtime", () => {
  it("serves communication without adapter configuration and names unset channels honestly", async () => {
    const { api, owner } = await boot();
    fakeBridges(api, [], ["telegram", "whatsapp", "discord", "sms"].map((platform) => messenger(platform)));

    const capabilities = (await owner.get("/api/v1/capabilities")).json().modules.communication;
    expect(capabilities).toMatchObject({ read: true, draft: false, send: false, multiChannel: false });
    expect(capabilities.sources).toEqual(["friday-communication"]);

    const adapters = (await owner.get("/api/v1/adapters")).json().items as any[];
    const builtin = adapters.find((entry) => entry.manifest.category === "communication");
    expect(builtin?.manifest.id).toBe("friday-communication");
    expect(builtin?.health.status).toBe("online");

    const channels = await owner.get("/api/v1/communication/channels");
    expect(channels.statusCode, channels.body).toBe(200);
    const body = channels.json();
    expect(body.sources[0].adapterId).toBe("friday-communication");
    expect(body.items.map((channel: any) => [channel.kind, channel.status])).toEqual([
      ["email", "not_configured"], ["telegram", "not_configured"], ["whatsapp", "not_configured"],
      ["discord", "not_configured"], ["sms", "not_configured"], ["phone", "not_configured"],
    ]);
    for (const channel of body.items) expect(channel.capabilities).toEqual({ read: false, draft: false, send: false });

    const threads = await owner.get("/api/v1/communication/threads");
    expect(threads.statusCode, threads.body).toBe(200);
    expect(threads.json().items).toEqual([]);

    const overview = (await owner.get("/api/v1/overview")).json().data;
    expect(overview.degradedSections.map((entry: any) => entry.adapterId)).not.toContain("unconfigured-communication");
    expect(overview.degradedSections.map((entry: any) => entry.section)).not.toContain("E-Mail & Kommunikation");
    expect(overview.quickCommands.find((command: any) => command.id === "summarize-mail")).toMatchObject({ enabled: true });
  }, 30000);

  it("shows a set-up mailbox as online and lists its inbox through the port and the mail read command", async () => {
    const { api, owner } = await boot();
    fakeBridges(api, [account], [messenger("telegram", { configured: true, gatewayRunning: true, connectionState: "connected" })]);
    const envelopes = vi.spyOn(api.runtime.mailAccounts, "envelopes").mockResolvedValue({ mailbox: "INBOX", uidValidity: "42", page: 1,
      items: [{ id: "7", subject: "Wartung Heizungsanlage", from: "Katharina Becker <k.becker@beispiel.example>",
        date: "Mon, 02 Nov 2026 09:15:00 +0100", flags: ["flagged"] }] });

    const channels = (await owner.get("/api/v1/communication/channels")).json().items as any[];
    const email = channels.find((channel) => channel.kind === "email");
    expect(email).toMatchObject({ status: "online", name: "Geschäft", address: "erik.brandt@example.test",
      capabilities: { read: true, draft: false, send: true } });
    expect(channels.find((channel) => channel.kind === "telegram")).toMatchObject({ status: "online" });
    expect(channels.find((channel) => channel.kind === "whatsapp")).toMatchObject({ status: "not_configured" });

    const threads = await owner.get("/api/v1/communication/threads");
    expect(threads.statusCode, threads.body).toBe(200);
    const [thread] = threads.json().items;
    expect(thread).toMatchObject({ channelId: email.id, channelKind: "email", subject: "Wartung Heizungsanlage", priority: "P2",
      status: "open", unreadCount: 1, participants: [{ name: "Katharina Becker", address: "k.becker@beispiel.example" }] });

    // The spoken/typed mail read goes through the same port.
    const command = await owner.post("/api/v1/commands", { text: "Zeige meine Mails", source: "text" });
    expect(command.statusCode, command.body).toBe(200);
    expect(command.json().status).not.toBe("failed");
    expect(JSON.stringify(command.json())).toContain("Wartung Heizungsanlage");
    expect(envelopes).toHaveBeenCalledWith("work", "INBOX", 1);

    // The native mailbox routes stay untouched by the port.
    const native = await owner.get("/api/v1/integrations/mail/accounts");
    expect(native.statusCode, native.body).toBe(200);
    expect(native.json().data.accounts.map((entry: any) => entry.id)).toEqual(["work"]);
  }, 30000);

  it("reports unreachable bridges as offline channels, not as a missing adapter", async () => {
    const { owner } = await boot();
    const channels = await owner.get("/api/v1/communication/channels");
    expect(channels.statusCode, channels.body).toBe(200);
    expect(new Set((channels.json().items as any[]).map((channel) => channel.status))).toEqual(new Set(["offline"]));
    const threads = await owner.get("/api/v1/communication/threads");
    expect(threads.statusCode).toBe(503);
    expect(threads.json().error.code).toBe("ADAPTER_UNAVAILABLE");
  }, 30000);
});
