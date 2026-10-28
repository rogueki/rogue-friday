import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Terminabfrage per Sprache: der Befehl muss genau die Termine nennen, die die Oberflaeche fuer denselben Tag liefert.
 * Die Mock-Welt steht auf 2026-10-14T08:15Z (Europe/Berlin, CEST), damit "heute" reproduzierbar zwei Seed-Termine trifft.
 */
const TODAY = { from: "2026-10-13T22:00:00.000Z", to: "2026-10-14T22:00:00.000Z" };
const TOMORROW = { from: "2026-10-14T22:00:00.000Z", to: "2026-10-15T22:00:00.000Z" };

describe("spoken calendar reads", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });

  afterEach(async () => {
    await api.close();
  });

  async function command(text: string) {
    const response = await owner.post("/api/v1/commands", { text, source: "voice" });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().result.message as string;
  }

  async function listFor(range: { from: string; to: string }) {
    const response = await owner.get(`/api/v1/calendar/events?from=${range.from}&to=${range.to}&limit=5`);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().items as Array<{ id: string; start: string }>;
  }

  it("lists exactly today's events the dashboard lists", async () => {
    const expected = await listFor(TODAY);
    expect(expected.length, "die Seed-Termine vom 2026-10-14 fehlen").toBeGreaterThan(0);

    const message = await command("Zeige meine Termine heute");
    for (const event of expected) expect(message, `${event.id} fehlt in: ${message}`).toContain(event.id);
    for (const event of await listFor(TOMORROW)) {
      expect(message, `Termin von morgen ${event.id} taucht bei heute auf`).not.toContain(event.id);
    }
  });

  it("lists tomorrow's events, not today's", async () => {
    const tomorrow = await listFor(TOMORROW);
    expect(tomorrow.length).toBeGreaterThan(0);
    const message = await command("zeige meine termine morgen");
    for (const event of tomorrow) expect(message, `${event.id} fehlt in: ${message}`).toContain(event.id);
    for (const event of await listFor(TODAY)) expect(message).not.toContain(event.id);
  });

  it("asks for a day instead of silently listing everything", async () => {
    const message = await command("zeige meine termine");
    expect(message).toContain("heute");
    expect(message).toContain("morgen");
  });
});