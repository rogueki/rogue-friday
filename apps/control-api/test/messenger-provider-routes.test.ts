import { describe, expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

describe("pinned Hermes provider setup routes", () => {
  it("requires owner and CSRF, binds path to platform, and never logs credential value", async () => {
    const logs: string[] = [];
    const api = await startTestApi({ logs });
    try {
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      const state = { state: "available" as const, platform: "matrix", revision: "a".repeat(64) };
      vi.spyOn(api.runtime.messengerProvider, "status").mockResolvedValue(state);
      const update = vi.spyOn(api.runtime.messengerProvider, "update").mockResolvedValue({ ...state, state: "saved", gatewayRestarted: false });
      expect((await viewer.request("GET", "/api/v1/messenger/providers/matrix")).statusCode).toBe(403);
      expect((await viewer.request("PUT", "/api/v1/messenger/providers/matrix", { body: {
        platform: "matrix", revision: state.revision, values: { MATRIX_ACCESS_TOKEN: "synthetic-secret-never-log" },
      } })).statusCode).toBe(403);
      const body = { platform: "matrix", revision: state.revision, values: { MATRIX_ACCESS_TOKEN: "synthetic-secret-never-log" } };
      expect((await owner.request("PUT", "/api/v1/messenger/providers/matrix", { body, csrf: false })).statusCode).toBe(403);
      expect((await owner.request("PUT", "/api/v1/messenger/providers/slack", { body })).statusCode).toBe(422);
      expect((await owner.request("GET", "/api/v1/messenger/providers/matrix")).statusCode).toBe(200);
      const saved = await owner.request("PUT", "/api/v1/messenger/providers/matrix", { body });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.body).toContain('"gatewayRestarted":false');
      expect(update).toHaveBeenCalledOnce();
      expect(saved.body + logs.join("\n")).not.toContain("synthetic-secret-never-log");
    } finally { await api.close(); }
  });
});
