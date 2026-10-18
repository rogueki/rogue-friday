import { describe, expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";
import type { MessengerDraft } from "../src/services/messenger-send";

const draft: MessengerDraft = { accountId: "default", platform: "telegram", recipient: "12345678", text: "Synthetic only" };

describe("owner messenger delivery routes", () => {
  it("restricts the pinned 24-provider catalog to the owner without exposing credentials", async () => {
    const api = await startTestApi();
    try {
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      const names = ["telegram", "discord", "whatsapp", "whatsapp_cloud", "slack", "signal", "mattermost",
        "matrix", "sms", "dingtalk", "feishu", "wecom", "weixin", "bluebubbles", "qqbot", "yuanbao",
        "teams", "buzz", "google_chat", "irc", "line", "ntfy", "photon", "simplex"];
      vi.spyOn(api.runtime.messengerCatalog, "list").mockResolvedValue({ pin: "d923a5eb",
        items: names.map((platform) => ({ platform, source: "bundled_plugin", configured: false,
          gatewayRunning: false, connectionState: "unknown", exactSendSupported: false,
          nativeSetupAvailable: false, fields: [{ name: "SYNTHETIC_SECRET", secret: true, required: true, present: true }] })) });
      expect((await viewer.request("GET", "/api/v1/messenger/catalog")).statusCode).toBe(403);
      const result = await owner.request("GET", "/api/v1/messenger/catalog");
      expect(result.statusCode, result.body).toBe(200);
      expect(result.body).toContain("SYNTHETIC_SECRET");
      expect(result.body).not.toContain("synthetic-secret-value");
    } finally { await api.close(); }
  });

  it("requires owner and CSRF and keeps payload out of audit logs", async () => {
    const logs: string[] = [];
    const api = await startTestApi({ logs });
    try {
      const anonymous = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      expect((await viewer.request("GET", "/api/v1/messenger/targets")).statusCode).toBe(403);
      expect((await owner.request("POST", "/api/v1/messenger/targets", {
        body: { accountId: "default", platform: "telegram", recipient: "12345678" }, csrf: false,
      })).statusCode).toBe(403);
      const registered = await owner.request("POST", "/api/v1/messenger/targets", {
        body: { accountId: "default", platform: "telegram", recipient: "12345678" },
      });
      expect(registered.statusCode, registered.body).toBe(200);
      expect((await owner.request("GET", "/api/v1/messenger/targets")).body).toContain("12345678");
      const preview = vi.spyOn(api.runtime.messengerSend, "preview").mockResolvedValue({
        token: "synthetic-token-123", expiresAt: new Date(Date.now() + 10000).toISOString(), fingerprint: "a".repeat(64), draft,
      });
      const confirm = vi.spyOn(api.runtime.messengerSend, "confirm").mockResolvedValue({
        receiptId: "b".repeat(64), accountId: "default", platform: "telegram", recipient: "12345678",
        state: "uncertain", externalId: null, createdAt: new Date().toISOString(), replayed: false,
      });
      expect((await anonymous.request("POST", "/api/v1/messenger/preview", { body: draft })).statusCode).toBe(401);
      expect((await viewer.request("POST", "/api/v1/messenger/preview", { body: draft })).statusCode).toBe(403);
      expect((await owner.request("POST", "/api/v1/messenger/preview", { body: draft, csrf: false })).statusCode).toBe(403);
      expect((await owner.request("POST", "/api/v1/messenger/preview", { body: draft })).statusCode).toBe(200);
      expect(preview).toHaveBeenCalledOnce();
      const delivered = await owner.request("POST", "/api/v1/messenger/confirm", {
        body: { draft, token: "synthetic-token-123" }, headers: { "Idempotency-Key": "synthetic-key-123" },
      });
      expect(delivered.statusCode, delivered.body).toBe(200);
      expect(confirm).toHaveBeenCalledOnce();
      expect(delivered.body).toContain("uncertain");
      expect(logs.join("\n")).not.toContain(draft.text);
      vi.spyOn(api.runtime.durableMemory, "capture").mockImplementation(() => { throw new Error("vault offline"); });
      const deliveredWithoutMemory = await owner.request("POST", "/api/v1/messenger/confirm", {
        body: { draft, token: "synthetic-token-123" }, headers: { "Idempotency-Key": "synthetic-key-456" },
      });
      expect(deliveredWithoutMemory.statusCode, deliveredWithoutMemory.body).toBe(200);
      expect(deliveredWithoutMemory.body).toContain('"memoryCapture":"error"');
    } finally { await api.close(); }
  });

  it("binds alert previews to the exact live step and records only the resulting receipt", async () => {
    const api = await startTestApi({ logs: [] });
    try {
      const owner = api.client(); await owner.loginDev("owner");
      const world = api.runtime.world!;
      world.state.settings.notifications.channels = world.state.settings.notifications.channels.map((item) =>
        item.kind === "telegram" ? { ...item, enabled: true, minPriority: "P1", accountId: "default", recipient: "12345678" } : item);
      const makeAlert = (title: string) => world.notifications.raise({ priority: "P1", category: "system", title,
        body: "Synthetic alert", chain: ["telegram"], stepSeconds: [0] });
      const stale = makeAlert("Stale approval");
      const delivered = makeAlert("Receipt target");
      api.runtime.notifications.save(stale, false);
      api.runtime.notifications.save(delivered, false);
      await owner.request("POST", "/api/v1/messenger/targets", { body: { accountId: "default", platform: "telegram", recipient: "12345678" } });
      vi.spyOn(api.runtime.messengerSend, "preview").mockImplementation(async (_actor, value) => ({
        token: "synthetic-token-123", expiresAt: new Date(Date.now() + 10000).toISOString(), fingerprint: "a".repeat(64), draft: value,
      }));
      const previewAlert = async (id: string) => owner.request("POST", "/api/v1/messenger/preview", { body: {
        ...draft, notificationId: id, notificationStep: 1,
      } });
      const stalePreview = await previewAlert(stale.id);
      const staleData = JSON.parse(stalePreview.body).data as { idempotencyKey: string };
      world.notifications.acknowledge(stale.id);
      const confirm = vi.spyOn(api.runtime.messengerSend, "confirm").mockImplementation(async (_actor, _value, _token, _key, options) => {
        options?.beforeSend?.();
        return { receiptId: "c".repeat(64), accountId: "default", platform: "telegram", recipient: "12345678",
          state: "uncertain", externalId: null, createdAt: new Date().toISOString(), replayed: false };
      });
      const denied = await owner.request("POST", "/api/v1/messenger/confirm", { body: {
        draft: { ...draft, notificationId: stale.id, notificationStep: 1 }, token: "synthetic-token-123",
      }, headers: { "Idempotency-Key": staleData.idempotencyKey } });
      expect(denied.statusCode).toBe(409);
      expect(confirm).toHaveBeenCalledOnce();

      const goodPreview = await previewAlert(delivered.id);
      const goodData = JSON.parse(goodPreview.body).data as { idempotencyKey: string };
      const accepted = await owner.request("POST", "/api/v1/messenger/confirm", { body: {
        draft: { ...draft, notificationId: delivered.id, notificationStep: 1 }, token: "synthetic-token-123",
      }, headers: { "Idempotency-Key": goodData.idempotencyKey } });
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(delivered.escalation[0]).toMatchObject({ state: "uncertain", sentAt: null });
      const stageRow = api.runtime.db.prepare("SELECT notification_id,step,actor,state FROM notification_messenger_stages WHERE notification_id=?")
        .get(delivered.id) as { actor: string; state: string };
      expect(stageRow.state).toBe("uncertain");
      expect(api.runtime.notifications.messengerStage(delivered.id, 1, stageRow.actor)).toMatchObject({ state: "uncertain", idempotencyKey: goodData.idempotencyKey });

      const rollbackAlert = makeAlert("Atomic receipt mapping");
      api.runtime.notifications.save(rollbackAlert, false);
      const rollbackPreview = await previewAlert(rollbackAlert.id);
      const rollbackKey = (JSON.parse(rollbackPreview.body).data as { idempotencyKey: string }).idempotencyKey;
      const completionFailure = vi.spyOn(api.runtime.notifications, "completeMessengerStage").mockImplementation(() => {
        throw new Error("synthetic storage interruption");
      });
      const interrupted = await owner.request("POST", "/api/v1/messenger/confirm", { body: {
        draft: { ...draft, notificationId: rollbackAlert.id, notificationStep: 1 }, token: "synthetic-token-123",
      }, headers: { "Idempotency-Key": rollbackKey } });
      expect(interrupted.statusCode).toBe(503);
      expect(rollbackAlert.escalation[0]?.state).toBe("awaiting_approval");
      expect(api.runtime.notifications.get(rollbackAlert.id)?.escalation[0]?.state).toBe("awaiting_approval");
      const rollbackRow = api.runtime.db.prepare("SELECT actor,state FROM notification_messenger_stages WHERE notification_id=?")
        .get(rollbackAlert.id) as { actor: string; state: string };
      expect(api.runtime.notifications.messengerStage(rollbackAlert.id, 1, rollbackRow.actor).state).toBe("staged");
      completionFailure.mockRestore();
    } finally { await api.close(); }
  });
});
