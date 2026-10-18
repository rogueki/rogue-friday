import { afterEach, expect, it, vi } from "vitest";
import { MailOAuthService } from "./mail-oauth";
import type { MailAccountsService, MailAccount } from "./mail-accounts";

const account = (authMode: MailAccount["authMode"]): MailAccount => ({ id: "work", displayName: "Work",
  email: "owner@example.test", senderName: "Owner", aliases: [], signature: "", imapHost: "imap.example.test",
  imapPort: 993, imapSecurity: "tls", imapLogin: "owner@example.test", smtpHost: "smtp.example.test",
  smtpPort: 587, smtpSecurity: "start-tls", smtpLogin: "owner@example.test", sentFolder: "Sent",
  draftsFolder: "Drafts", trashFolder: "Trash", archiveFolder: "Archive", spamFolder: "Spam", revision: 1,
  authMode, oauthClientId: "synthetic-client-id", oauthTenant: authMode === "microsoft-oauth" ? "common" : "",
  secretState: { imapPassword: false, smtpPassword: false, oauthRefreshToken: false } });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("starts Google PKCE with local callback and accepts a matching loopback state only", async () => {
  const completeOAuth = vi.fn().mockResolvedValue(undefined);
  const accounts = { list: vi.fn().mockResolvedValue({ accounts: [account("google-oauth")] }), completeOAuth } as unknown as MailAccountsService;
  const service = new MailOAuthService(accounts, 4137);
  const started = await service.start("work", "owner-user");
  const url = new URL(started.authorizationUrl!);
  expect(url.origin).toBe("https://accounts.google.com");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4137/api/v1/integrations/mail/oauth/google/callback");
  await expect(service.googleCallback(started.flowId, "synthetic-code-123", "192.0.2.1")).rejects.toThrow();
  const response = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ access_token: "access",
    refresh_token: "synthetic-refresh-token", scope: "https://mail.google.com/" }) });
  vi.stubGlobal("fetch", response);
  expect(await service.googleCallback(started.flowId, "synthetic-code-123", "127.0.0.1"))
    .toEqual({ authorized: true, accountId: "work" });
  expect(completeOAuth).toHaveBeenCalledWith("work", 1, "synthetic-refresh-token", ["https://mail.google.com/"]);
  expect(new URLSearchParams(response.mock.calls[0]![1].body).get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  await expect(service.googleCallback(started.flowId, "synthetic-code-123", "127.0.0.1")).rejects.toThrow();
});

it("uses Microsoft device authorization, waits for polling interval, then enforces both mail scopes", async () => {
  const completeOAuth = vi.fn().mockResolvedValue(undefined);
  const accounts = { list: vi.fn().mockResolvedValue({ accounts: [account("microsoft-oauth")] }), completeOAuth } as unknown as MailAccountsService;
  const service = new MailOAuthService(accounts, 4137);
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const response = vi.fn()
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ device_code: "private-device-code",
      user_code: "ABC-123", verification_uri: "https://microsoft.com/devicelogin", interval: 5, expires_in: 600 }) })
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ access_token: "access",
      refresh_token: "synthetic-refresh-token", scope: "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send" }) });
  vi.stubGlobal("fetch", response);
  const started = await service.start("work", "owner-user");
  expect(started).toMatchObject({ authorizationUrl: null, userCode: "ABC-123" });
  expect(await service.microsoftPoll(started.flowId, "owner-user", "work")).toMatchObject({ pending: true });
  expect(response).toHaveBeenCalledTimes(1);
  await expect(service.microsoftPoll(started.flowId, "other-user", "work")).rejects.toThrow();
  now += 6000;
  expect(await service.microsoftPoll(started.flowId, "owner-user", "work")).toMatchObject({ authorized: true, pending: false });
  expect(completeOAuth).toHaveBeenCalledWith("work", 1, "synthetic-refresh-token", [
    "https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"]);
});
