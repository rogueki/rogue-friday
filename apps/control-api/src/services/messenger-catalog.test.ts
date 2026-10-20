import { describe, expect, it, vi } from "vitest";
import { MessengerCatalogService } from "./messenger-catalog";

const platforms = ["telegram", "discord", "whatsapp", "whatsapp_cloud", "slack", "signal", "mattermost",
  "matrix", "sms", "dingtalk", "feishu", "wecom", "weixin", "bluebubbles", "qqbot", "yuanbao", "teams",
  "buzz", "google_chat", "irc", "line", "ntfy", "photon", "simplex"];

describe("pinned Hermes messenger catalog", () => {
  it("distinguishes configured prerequisites from verified connection and exact send support", async () => {
    const invoke = vi.fn(async () => ({ state: "available", pin: "d923a5eb", items: platforms.map((platform) => ({
      platform, source: "bundled_plugin", fields: [{ name: "SLACK_BOT_TOKEN", secret: true, required: true,
        present: true, value: "secret-value" }],
      configured: platform === "slack", gatewayRunning: false, connectionState: "unknown",
    })) }));
    const service = new MessengerCatalogService("unused", invoke);
    // The WSL target resolution is Windows-host-only (drive-letter to /mnt path); stub it like messenger-send does.
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/fixed/messaging_catalog.py", distro: "Friday-Ubuntu", user: "friday" });
    const result = await service.list();
    expect(result.items).toHaveLength(24);
    expect(result.items.find((item) => item.platform === "slack")).toMatchObject({ configured: true,
      connectionState: "unknown", exactSendSupported: true, nativeSetupAvailable: false });
    expect(result.items.find((item) => item.platform === "teams")).toMatchObject({ configured: false,
      exactSendSupported: true, nativeSetupAvailable: false });
    expect(result.items.filter((item) => item.exactSendSupported)).toHaveLength(24);
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(invoke).toHaveBeenCalledOnce();
  });
});
