import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startTestApi } from "./helpers";

describe("calendar-only Hermes bridge", () => {
  it("uses a separate persisted key and permits only loopback calendar list GET", async () => {
    const api = await startTestApi();
    try {
      const calendarKey = api.runtime.calendarBridgeKey.toString("base64");
      expect(calendarKey).not.toBe(api.runtime.voiceBridgeKey.toString("base64"));
      expect(readFileSync(join(api.config.paths.dataDir, "calendar-bridge", "auth.key"), "utf8").trim()).toBe(calendarKey);
      const bridge = { authorization: `Bearer ${calendarKey}` };
      const client = api.client();
      expect((await client.get("/api/v1/calendar/events?limit=1", { headers: bridge })).statusCode).toBe(200);
      expect((await client.get("/api/v1/calendar/events?limit=1", { headers: { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` } })).statusCode).toBe(401);
      expect((await client.get("/api/v1/calendar/events?limit=1")).statusCode).toBe(401);
      expect((await client.get("/api/v1/calendar/conflicts", { headers: bridge })).statusCode).toBe(403);
      expect((await client.get("/api/v1/skills", { headers: bridge })).statusCode).toBe(403);
      expect((await client.post("/api/v1/calendar/proposals", {}, { headers: bridge })).statusCode).toBe(403);
      expect((await api.fastify.inject({ method: "GET", url: "/api/v1/calendar/events", remoteAddress: "192.0.2.2", headers: bridge })).statusCode).toBe(403);
    } finally { await api.close(); }
  });
});
