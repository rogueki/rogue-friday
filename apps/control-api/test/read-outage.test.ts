/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalCalendarService } from "../src/services/local-calendar";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Fehlerfall der Sprach-Leseabfragen: faellt ein Adapter aus, antwortet die Sprache wie die Route - ein klarer,
 * wiederholbarer 503 statt einer erfundenen leeren Liste; wo die Route einen Ausfall toleriert (Kalender), toleriert
 * ihn auch die Sprache; der Systemstatus nennt den Ausfall.
 */
describe("spoken reads during an adapter outage", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });
  afterEach(async () => { await api.close(); });

  async function offline(adapterId: string): Promise<void> {
    const response = await owner.post("/api/v1/dev/scenarios/control", { action: "adapter_offline", adapterId, offline: true });
    expect(response.statusCode, response.body).toBe(200);
  }

  const say = (text: string) => owner.post("/api/v1/commands", { text, source: "voice" });

  it("answers a task question with the route's retryable 503 instead of an empty list", async () => {
    await offline("mock-tasks");
    const route = await owner.get("/api/v1/tasks");
    expect(route.statusCode).toBe(503);
    const spoken = await say("zeige meine aufgaben");
    expect(spoken.statusCode, spoken.body).toBe(503);
    const error = (spoken.json() as any).error;
    expect(error.code).toBe("ADAPTER_UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.code).toBe((route.json() as any).error.code);
  });

  it.each([
    ["mock-agents", "/api/v1/agents", "zeige meine agenten"],
    ["mock-activity", "/api/v1/activity", "Zeige aktuelle Activity-Ereignisse"],
    ["mock-files", "/api/v1/files", "zeige meine dateien"],
    ["mock-memory", "/api/v1/memory", "zeige mein gedaechtnis"],
    ["mock-notifications", "/api/v1/notifications", "Zeige offene Meldungen"],
  ])("answers like the route when %s is offline", async (adapterId, path, text) => {
    await offline(adapterId);
    const route = await owner.get(path);
    expect(route.statusCode, route.body).toBe(503);
    const spoken = await say(text);
    expect(spoken.statusCode, spoken.body).toBe(503);
    const error = (spoken.json() as any).error;
    expect(error.code).toBe((route.json() as any).error.code);
    expect(error.retryable).toBe(true);
  });

  it("keeps naming local events when the calendar adapter is offline, like the calendar page", async () => {
    const ownerId = (await owner.get("/api/v1/auth/session")).json().data.user.id as string;
    const local = new LocalCalendarService(api.runtime.db).create({
      title: "Bleibt sichtbar", start: "2026-10-14T12:00:00.000Z", end: "2026-10-14T13:00:00.000Z", timeZone: "Europe/Berlin" }, ownerId);
    await offline("mock-calendar");
    const route = await owner.get("/api/v1/calendar/events?from=2026-10-13T22:00:00.000Z&to=2026-10-14T22:00:00.000Z&limit=5");
    expect(route.statusCode, route.body).toBe(200);
    const spoken = await say("Zeige meine Termine heute");
    expect(spoken.statusCode, spoken.body).toBe(200);
    expect((spoken.json() as any).result.message).toContain(local.id);
  });

  it("names the outage in the spoken system status", async () => {
    await offline("mock-tasks");
    const health = (await owner.get("/api/v1/health")).json() as { status: string; components: Array<{ name: string; status: string }> };
    expect(health.status).not.toBe("online");
    const spoken = await say("wie ist der systemstatus");
    expect(spoken.statusCode, spoken.body).toBe(200);
    const message = (spoken.json() as any).result.message as string;
    expect(message).toContain(`Systemstatus ${health.status}`);
    for (const component of health.components.filter((item) => item.status !== "online").slice(0, 5))
      expect(message, `${component.name} fehlt in: ${message}`).toContain(component.name);
  });
});
