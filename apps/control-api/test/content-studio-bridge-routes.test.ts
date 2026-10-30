import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startTestApi } from "./helpers";

const ENDPOINT = "/api/v1/content-studio/plan";
const plan = {
  version: 1,
  exportiert_am: "2026-10-30T00:00:00.000Z",
  content: [{ id: "idea-1", titel: "Start", plattform: "Instagram", ziele: ["Instagram"], format: "Story", beschreibung: "", zieldatum: "2026-11-02", status: "idee" }],
  postings: [],
};

describe("Content Studio plan bridge for Hermes (I-054)", () => {
  it("reads and saves the plan with revision and reaches nothing else", async () => {
    const api = await startTestApi();
    try {
      const key = api.runtime.contentStudioBridgeKey.toString("base64");
      expect(readFileSync(join(api.config.paths.dataDir, "content-studio-bridge", "auth.key"), "utf8").trim()).toBe(key);
      for (const other of [api.runtime.voiceBridgeKey, api.runtime.calendarBridgeKey, api.runtime.mailBridgeKey, api.runtime.hermesMemoryBridgeKey]) {
        expect(other.toString("base64")).not.toBe(key);
      }
      const bridge = { authorization: `Bearer ${key}` };
      const owner = api.client();
      await owner.loginDev("owner");
      const settings = (await owner.get("/api/v1/settings")).json().data;
      expect((await owner.patch("/api/v1/settings", { dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);

      const hermes = api.client();
      const read = await hermes.get(ENDPOINT, { headers: bridge });
      expect(read.statusCode, read.body).toBe(200);
      const revision = (read.json() as { data: { revision: number } }).data.revision;
      expect((await hermes.request("PUT", ENDPOINT, { body: plan, headers: { ...bridge, "if-match": String(revision + 1) } })).statusCode).toBe(409);
      const saved = await hermes.request("PUT", ENDPOINT, { body: plan, headers: { ...bridge, "if-match": String(revision) } });
      expect(saved.statusCode, saved.body).toBe(200);
      expect((saved.json() as { data: { revision: number } }).data.revision).toBe(revision + 1);
      expect((await owner.get(ENDPOINT)).json().data.plan.content[0].id).toBe("idea-1");

      // Paid studio actions and unrelated routes stay closed to this key.
      expect((await hermes.post("/api/v1/content-studio/production-jobs", { ideaId: "idea-1", planRevision: revision + 1, confirmed: true },
        { headers: { ...bridge, "idempotency-key": "bridge-test-0001" } })).statusCode).toBe(403);
      expect((await hermes.post("/api/v1/content-studio/kie/tasks", {}, { headers: bridge })).statusCode).toBe(403);
      expect((await hermes.get("/api/v1/settings", { headers: bridge })).statusCode).toBe(403);
      expect((await api.client().get(ENDPOINT)).statusCode).toBe(401);
    } finally {
      await api.close();
    }
  });
});
