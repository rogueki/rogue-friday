import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

describe("scoped Hermes inbound bridge", () => {
  it("classifies admitted DMs, requires owner link, and never exposes message text in observations or logs", async () => {
    const logs: string[] = [];
    const api = await startTestApi({ logs });
    try {
      vi.spyOn(api.runtime.auth, "ownerPasswordConfigured").mockReturnValue(true);
      const key = api.runtime.messengerInboundBridgeKey.toString("base64");
      expect(key).not.toBe(api.runtime.hermesMemoryBridgeKey.toString("base64"));
      expect(readFileSync(join(api.config.paths.dataDir, "hermes-messenger-bridge", "auth.key"), "utf8").trim()).toBe(key);
      const bridge = { authorization: `Bearer ${key}` };
      const payload = { platform: "discord", accountId: "default", accountEpoch: "a".repeat(64), senderId: "123456789012345678",
        chatId: "234567890123456789", chatType: "dm", messageId: "fixture-1", text: "Synthetic inbound text" };
      const anonymous = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      expect((await anonymous.post("/api/v1/integrations/messenger/events", payload)).statusCode).toBe(401);
      expect((await viewer.post("/api/v1/integrations/messenger/events", payload)).statusCode).toBe(403);
      expect((await anonymous.get("/api/v1/messenger/senders", { headers: bridge })).statusCode).toBe(403);
      const group = await anonymous.post("/api/v1/integrations/messenger/events", { ...payload, chatType: "group" }, { headers: bridge });
      expect(group.statusCode, group.body).toBe(200);
      expect(group.body).toContain('"reason":"not_private_dm"');
      const first = await anonymous.post("/api/v1/integrations/messenger/events", payload, { headers: bridge });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.body).toContain('"reason":"policy_disabled"');
      api.runtime.durableMemory.setSettings({ enabled: true, privateMode: false,
        channels: { dashboard: true, voice: true, hermes: true, messenger: true } });
      const observed = await anonymous.post("/api/v1/integrations/messenger/events", payload, { headers: bridge });
      expect(observed.body).toContain('"reason":"unlinked"');
      const listing = await owner.get("/api/v1/messenger/senders");
      expect(listing.statusCode, listing.body).toBe(200);
      expect(listing.body).not.toContain(payload.text);
      const id = (listing.json() as { data: { items: Array<{ id: string }> } }).data.items[0]!.id;
      expect((await viewer.post(`/api/v1/messenger/senders/${id}/link`)).statusCode).toBe(403);
      expect((await owner.post(`/api/v1/messenger/senders/${id}/link`, undefined, { csrf: false })).statusCode).toBe(403);
      expect((await owner.post(`/api/v1/messenger/senders/${id}/link`)).statusCode).toBe(200);
      const captured = await anonymous.post("/api/v1/integrations/messenger/events", payload, { headers: bridge });
      expect(captured.statusCode, captured.body).toBe(200);
      expect(captured.body).toMatch(/"reason":"(captured|pending)"/);
      expect((await anonymous.post("/api/v1/integrations/messenger/events", payload, { headers: bridge })).statusCode).toBe(200);
      expect((await owner.delete(`/api/v1/messenger/senders/${id}/link`)).statusCode).toBe(200);
      expect((await anonymous.post("/api/v1/integrations/messenger/events", { ...payload, messageId: "fixture-2" }, { headers: bridge })).body)
        .toContain('"reason":"unlinked"');
      expect(logs.join("\n")).not.toContain(payload.text);
    } finally { await api.close(); }
  });
});
