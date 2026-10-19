import { describe, expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

const path = "/api/v1/settings/whatsapp-pairing";
const pairing = { id: "abcdefghijklmnopqrstuvwx", state: "waiting" as const, mode: "bot" as const,
  qr: "FAKE_PRIVATE_QR", expiresAt: Date.now() + 60_000, linkedIdentity: null, connectionState: "unknown" as const };

describe("owner WhatsApp pairing", () => {
  it("restricts QR reads and all pairing mutations to owner plus CSRF", async () => {
    const logs: string[] = [];
    const api = await startTestApi({ logs });
    try {
      const anonymous = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      const bridge = vi.spyOn(api.runtime.whatsappGateway, "pairing").mockResolvedValue(pairing);
      expect((await anonymous.get(path)).statusCode).toBe(401);
      expect((await viewer.get(path)).statusCode).toBe(403);
      const read = await owner.get(path);
      expect(read.statusCode).toBe(200);
      expect(read.body).toContain("FAKE_PRIVATE_QR");
      expect(read.headers["cache-control"]).toBe("no-store");
      const body = { mode: "bot" };
      expect((await viewer.request("POST", path, { body })).statusCode).toBe(403);
      expect((await owner.request("POST", path, { body, csrf: false })).statusCode).toBe(403);
      expect((await owner.request("POST", path, { body })).statusCode).toBe(200);
      expect((await owner.request("DELETE", path)).statusCode).toBe(200);
      expect((await owner.request("POST", "/api/v1/settings/whatsapp-session/reconnect")).statusCode).toBe(200);
      expect((await owner.request("DELETE", "/api/v1/settings/whatsapp-session")).statusCode).toBe(200);
      expect(bridge.mock.calls.map(([action]) => action)).toEqual(["status", "start", "cancel", "reconnect", "logout"]);
      expect(logs.join("\n")).not.toContain("FAKE_PRIVATE_QR");
    } finally { await api.close(); }
  });
});
