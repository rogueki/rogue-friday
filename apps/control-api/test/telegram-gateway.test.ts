import { describe, expect, it, vi } from "vitest";
import { TelegramGatewayService } from "../src/services/telegram-gateway";
import { startTestApi } from "./helpers";

const PATH = "/api/v1/settings/telegram-gateway";
const TOKEN = `123456789:${"a".repeat(35)}`;
const status = { tokenConfigured: true, botAuthentication: "verified" as const, botId: "123456789", botUsername: "fake_bot", receiveMode: "polling" as const,
  allowedUserIds: ["123456789"], allowedChatIds: [], enabled: true, requireMention: null,
  gatewayRunning: true, connectionState: "unknown" as const, applied: true, revision: 42 };

describe("Telegram gateway settings", () => {
  it("sends the token only through WSL stdin and rejects unsafe input", async () => {
    const invoke = vi.fn(async (_script: string, _distro: string, _user: string, _args: string[], _input?: string) => status);
    const service = new TelegramGatewayService("unused", invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_telegram.py", distro: "Friday-Ubuntu", user: "friday" });
    const patch = { token: TOKEN, clearToken: false, allowedUserIds: ["123456789"], allowedChatIds: [], removeWebhook: false, enabled: true };
    expect(await service.update(patch, 42)).toEqual(status);
    const [script, distro, user, args, input] = invoke.mock.calls[0]!;
    expect([script, distro, user, ...args].join(" ")).not.toContain(TOKEN);
    expect(JSON.parse(input as string)).toEqual({ ...patch, revision: 42 });
    expect(() => service.update({ ...patch, token: "bad" }, 42)).toThrow();
    expect(() => service.update({ ...patch, allowedUserIds: ["@someone"] }, 42)).toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("requires owner and CSRF and never returns or logs the token", async () => {
    const logs: string[] = [];
    const api = await startTestApi({ logs });
    try {
      const anonymous = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      const patch = { token: TOKEN, clearToken: false, allowedUserIds: ["123456789"], allowedChatIds: [], removeWebhook: false, enabled: true };
      const read = vi.spyOn(api.runtime.telegramGateway, "status").mockResolvedValue(status);
      const update = vi.spyOn(api.runtime.telegramGateway, "update").mockResolvedValue(status);
      expect((await anonymous.get(PATH)).statusCode).toBe(401);
      expect((await viewer.get(PATH)).statusCode).toBe(403);
      expect((await owner.get(PATH)).statusCode).toBe(200);
      expect((await anonymous.request("PUT", PATH, { body: patch, headers: { "If-Match": "42" } })).statusCode).toBe(401);
      expect((await viewer.request("PUT", PATH, { body: patch, headers: { "If-Match": "42" } })).statusCode).toBe(403);
      expect((await owner.request("PUT", PATH, { body: patch, csrf: false, headers: { "If-Match": "42" } })).statusCode).toBe(403);
      const saved = await owner.request("PUT", PATH, { body: patch, headers: { "If-Match": "42" } });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(read).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(patch, 42);
      expect(saved.body + logs.join("\n")).not.toContain(TOKEN);
    } finally { await api.close(); }
  });
});

describe("Telegram token verification errors", () => {
  it("explains a rejected or unverifiable token and keeps the stored one", async () => {
    const invoke = vi.fn(async () => { throw new Error("runner_4:bot_token_rejected"); });
    const service = new TelegramGatewayService("unused", invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_telegram.py", distro: "Friday-Ubuntu", user: "friday" });
    const patch = { token: TOKEN, clearToken: false, allowedUserIds: ["123456789"], allowedChatIds: [], removeWebhook: false, enabled: false };
    await expect(service.update(patch, 42)).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("bleibt unverändert") });
    invoke.mockImplementationOnce(async () => { throw new Error("runner_4:bot_unverified"); });
    await expect(service.update(patch, 42)).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });
});

describe("Telegram group chat access and webhook removal", () => {
  it("rejects a positive group chat id before the runner is called", async () => {
    const invoke = vi.fn(async () => status);
    const service = new TelegramGatewayService("unused", invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_telegram.py", distro: "Friday-Ubuntu", user: "friday" });
    const patch = { token: TOKEN, clearToken: false, allowedUserIds: ["123456789"], allowedChatIds: ["123"], removeWebhook: false, enabled: true };
    await expect(async () => service.update(patch, 42)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports a webhook that Telegram did not remove", async () => {
    const invoke = vi.fn(async () => { throw new Error("runner_4:webhook_remove_failed"); });
    const service = new TelegramGatewayService("unused", invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_telegram.py", distro: "Friday-Ubuntu", user: "friday" });
    const patch = { token: TOKEN, clearToken: false, allowedUserIds: [], allowedChatIds: [], removeWebhook: true, enabled: false };
    await expect(service.update(patch, 42)).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE",
      message: expect.stringContaining("nicht bestätigt") });
  });

  it("rejects a status response with a positive group chat id", async () => {
    const invoke = vi.fn(async () => ({ ...status, allowedChatIds: ["42"] }));
    const service = new TelegramGatewayService("unused", invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_telegram.py", distro: "Friday-Ubuntu", user: "friday" });
    await expect(service.status()).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });
});

describe("Telegram mention rule", () => {
  it("passes requireMention through and rejects a non-boolean value", async () => {
    const invoke = vi.fn(async () => ({ ...status, requireMention: true }));
    const service = new TelegramGatewayService("unused", invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_telegram.py", distro: "Friday-Ubuntu", user: "friday" });
    const patch = { token: "", clearToken: false, allowedUserIds: [], allowedChatIds: ["-1001234567890"], removeWebhook: false, enabled: false, requireMention: true };
    expect(await service.update(patch, status.revision)).toMatchObject({ requireMention: true });
    const args = invoke.mock.calls[0] as unknown as [string, string, string, string[], string];
    expect(JSON.parse(args[4])).toMatchObject({ requireMention: true });
    expect(() => service.update({ ...patch, requireMention: "yes" } as never, status.revision)).toThrow();
    invoke.mockResolvedValueOnce({ ...status, requireMention: "yes" } as never);
    await expect(service.status()).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });
});
