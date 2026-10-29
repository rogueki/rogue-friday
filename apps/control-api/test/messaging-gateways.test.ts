import { describe, expect, it, vi } from "vitest";
import { MessagingGatewayService } from "../src/services/messaging-gateways";
import { startTestApi } from "./helpers";

const discord = { tokenConfigured: true, allowedUserIds: ["123456789012345678"], allowedChannelIds: [],
  enabled: true, gatewayRunning: true, connectionState: "unknown" as const, applied: true, revision: 42,
  setupUrl: "http://127.0.0.1:43791/channels" };
const whatsapp = { mode: "bot" as const, sessionPresent: false, allowedUserIds: ["491701234567"],
  enabled: false, gatewayRunning: true, connectionState: "unknown" as const, applied: null, revision: 43,
  setupUrl: "http://127.0.0.1:43791/channels" };

describe.each([
  { platform: "discord" as const, status: discord, patch: { token: "a".repeat(40), clearToken: false,
    allowedUserIds: ["123456789012345678"], allowedChannelIds: [], enabled: true } },
  { platform: "whatsapp" as const, status: whatsapp, patch: { mode: "bot" as const,
    allowedUserIds: ["491701234567"], enabled: false } },
])("$platform gateway settings", ({ platform, status, patch }) => {
  const path = `/api/v1/settings/${platform}-gateway`;
  it("passes changes to WSL stdin without exposing credentials in arguments", async () => {
    const invoke = vi.fn(async () => status);
    const service = new MessagingGatewayService("unused", platform, invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string; setupUrl: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_messaging_gateway.py", distro: "Friday-Ubuntu", user: "friday", setupUrl: status.setupUrl });
    expect(await service.update(patch, status.revision)).toEqual(status);
    const args = invoke.mock.calls[0] as unknown as [string, string, string, string[], string];
    expect(JSON.parse(args[4])).toEqual({ ...patch, revision: status.revision });
    if (platform === "discord") expect(args.slice(0, 4).join(" ")).not.toContain(patch.token);
  });

  it("requires owner and CSRF and keeps the token out of responses and logs", async () => {
    const logs: string[] = [];
    const api = await startTestApi({ logs });
    try {
      const anonymous = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      const service = platform === "discord" ? api.runtime.discordGateway : api.runtime.whatsappGateway;
      vi.spyOn(service, "status").mockResolvedValue(status);
      const update = vi.spyOn(service, "update").mockResolvedValue(status);
      expect((await anonymous.get(path)).statusCode).toBe(401);
      expect((await viewer.get(path)).statusCode).toBe(403);
      expect((await owner.get(path)).statusCode).toBe(200);
      expect((await owner.request("PUT", path, { body: patch, csrf: false, headers: { "If-Match": String(status.revision) } })).statusCode).toBe(403);
      const saved = await owner.request("PUT", path, { body: patch, headers: { "If-Match": String(status.revision) } });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(update).toHaveBeenCalledWith(patch, status.revision);
      if (platform === "discord") expect(saved.body + logs.join("\n")).not.toContain(patch.token);
    } finally { await api.close(); }
  });
});

describe("WhatsApp pairing errors", () => {
  it("reports a refused re-pairing as conflict instead of an unreachable bridge", async () => {
    const invoke = vi.fn(async () => { throw new Error("runner_4: linked_session_present"); });
    const service = new MessagingGatewayService("unused", "whatsapp", invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string; setupUrl: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_messaging_gateway.py", distro: "Friday-Ubuntu", user: "friday", setupUrl: whatsapp.setupUrl });
    await expect(service.pairing("start", "bot")).rejects.toMatchObject({ code: "CONFLICT" });
    invoke.mockImplementationOnce(async () => { throw new Error("runner_5: pinned_bridge_or_dependencies_unavailable"); });
    await expect(service.pairing("start", "bot")).rejects.not.toMatchObject({ code: "CONFLICT" });
  });

  it("explains a rejected or unverifiable Discord token and keeps the stored one", async () => {
    const invoke = vi.fn(async () => { throw new Error("runner_4:bot_token_rejected"); });
    const service = new MessagingGatewayService("unused", "discord", invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string; setupUrl: string } }, "target")
      .mockReturnValue({ script: "/mnt/d/Friday/installer/wsl/configure_messaging_gateway.py", distro: "Friday-Ubuntu", user: "friday", setupUrl: "https://discord.com/developers/applications" });
    const patch = { token: "N".repeat(59), clearToken: false, allowedUserIds: ["123456789012345678"], allowedChannelIds: [], enabled: false };
    await expect(service.update(patch as never, 42)).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("bleibt unverändert") });
    invoke.mockImplementationOnce(async () => { throw new Error("runner_4:bot_unverified"); });
    await expect(service.update(patch as never, 42)).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });
});
