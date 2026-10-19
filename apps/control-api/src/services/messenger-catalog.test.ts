import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MessengerCatalogService } from "./messenger-catalog";

const platforms = ["telegram", "discord", "whatsapp", "whatsapp_cloud", "slack", "signal", "mattermost",
  "matrix", "sms", "dingtalk", "feishu", "wecom", "weixin", "bluebubbles", "qqbot", "yuanbao", "teams",
  "buzz", "google_chat", "irc", "line", "ntfy", "photon", "simplex"];

describe("pinned Hermes messenger catalog", () => {
  it("distinguishes configured prerequisites from verified connection and exact send support", async () => {
    const root = mkdtempSync(join(tmpdir(), "friday-messenger-catalog-"));
    try {
      mkdirSync(join(root, "config"));
      writeFileSync(join(root, "config", "install-state.json"), JSON.stringify({ distro_name: "Friday-Ubuntu", linux_user: "friday" }));
      const invoke = vi.fn(async () => ({ state: "available", pin: "d923a5eb", items: platforms.map((platform) => ({
        platform, source: "bundled_plugin", fields: [{ name: "SLACK_BOT_TOKEN", secret: true, required: true,
          present: true, value: "secret-value" }],
        configured: platform === "slack", gatewayRunning: false, connectionState: "unknown",
      })) }));
      const service = new MessengerCatalogService(root, invoke);
      const result = await service.list();
      expect(result.items).toHaveLength(24);
      expect(result.items.find((item) => item.platform === "slack")).toMatchObject({ configured: true,
        connectionState: "unknown", exactSendSupported: true, nativeSetupAvailable: false });
      expect(result.items.find((item) => item.platform === "teams")).toMatchObject({ configured: false,
        exactSendSupported: false, nativeSetupAvailable: false });
      expect(JSON.stringify(result)).not.toContain("secret-value");
      expect(invoke).toHaveBeenCalledOnce();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
