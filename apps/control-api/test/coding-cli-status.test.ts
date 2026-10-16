import { describe, expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

describe("GET coding CLI status", () => {
  it("shows only normalized local status to the owner", async () => {
    const api = await startTestApi();
    try {
      const path = "/api/v1/coding-runs/cli-status";
      expect((await api.client().get(path)).statusCode).toBe(401);
      const viewer = api.client(); await viewer.loginDev("viewer");
      expect((await viewer.get(path)).statusCode).toBe(403);
      const owner = api.client(); await owner.loginDev("owner");
      vi.spyOn(api.runtime.codingRuns, "cliStatus").mockResolvedValue([
        { cli: "codex", installed: true, version: "0.163.0", authState: "signed_out" },
        { cli: "opencode", installed: true, version: "1.19.2", authState: "stored_credentials" },
        { cli: "claude-code", installed: true, version: "2.1.301", authState: "unknown" },
      ]);
      const response = await owner.get(path);
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(3);
      expect(response.body).not.toContain("email");
      expect(response.body).not.toContain("token");
    } finally { await api.close(); }
  });
});
