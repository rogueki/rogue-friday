import { describe, expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

const path = "/api/v1/settings/hermes-skill-keys/NOTION_API_KEY/check";

describe("Hermes skill key connection check", () => {
  it("requires owner and CSRF and returns only a transient bounded result", async () => {
    const api = await startTestApi();
    try {
      const anonymous = api.client();
      const viewer = api.client(); await viewer.loginDev("viewer");
      const owner = api.client(); await owner.loginDev("owner");
      const check = vi.spyOn(api.runtime.hermesSkillKeys, "check").mockResolvedValue({ key: "NOTION_API_KEY", state: "verified", checkedAt: "2026-10-16T12:00:00Z" });
      expect((await anonymous.post(path, {})).statusCode).toBe(401);
      expect((await viewer.post(path, {})).statusCode).toBe(403);
      expect((await owner.request("POST", path, { body: {}, csrf: false })).statusCode).toBe(403);
      expect(check).not.toHaveBeenCalled();
      const result = await owner.post(path, {});
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().data).toEqual({ key: "NOTION_API_KEY", state: "verified", checkedAt: "2026-10-16T12:00:00Z" });
      expect(check).toHaveBeenCalledOnce();
    } finally { await api.close(); }
  });
});
