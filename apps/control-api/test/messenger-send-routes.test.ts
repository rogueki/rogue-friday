import { describe, expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";
import type { MessengerDraft } from "../src/services/messenger-send";

const draft: MessengerDraft = { accountId: "default", platform: "telegram", recipient: "12345678", text: "Synthetic only" };

describe("owner messenger delivery routes", () => {
  it("requires owner and CSRF and keeps payload out of audit logs", async () => {
    const logs: string[] = [];
    const api = await startTestApi({ logs });
    try {
      const anonymous = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
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
});
