import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Unterhaltungsabfrage per Sprache: der Befehl muss dieselben Threads nennen, die die Oberflaeche ueber
 * `GET /api/v1/communication/threads` bekommt. In der Antwort stehen Kennung, Kanal, Status und Betreff - kein Text.
 */
describe("spoken communication reads", () => {
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

  async function threads(query: string) {
    const response = await owner.get(`/api/v1/communication/threads?limit=5${query}`);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().items as Array<{ id: string; subject: string; status: string; needsReply: boolean }>;
  }

  it("lists the threads the dashboard lists", async () => {
    const expected = await threads("");
    expect(expected.length).toBeGreaterThan(0);
    const message = await command("zeige meine unterhaltungen");
    for (const thread of expected) expect(message, `${thread.id} fehlt in: ${message}`).toContain(thread.id);
    expect(message).toContain(expected[0]!.subject);
  });

  it("filters by status exactly like the route", async () => {
    const open = await threads("&status=open");
    expect(open.length).toBeGreaterThan(0);
    const message = await command("zeige offene unterhaltungen");
    for (const thread of open) expect(message).toContain(thread.id);
    const replied = await threads("&status=replied");
    for (const thread of replied) expect(message, `beantworteter Thread ${thread.id} taucht bei offen auf`).not.toContain(thread.id);
  });

  it("finds the threads that need an answer", async () => {
    const pending = await threads("&needsReply=true");
    expect(pending.length).toBeGreaterThan(0);
    const message = await command("zeige unterhaltungen die eine antwort brauchen");
    for (const thread of pending) expect(message, `${thread.id} fehlt in: ${message}`).toContain(thread.id);
    for (const thread of await threads("&needsReply=false")) expect(message).not.toContain(thread.id);
  });

  it("never shows message bodies", async () => {
    const message = await command("zeige meine unterhaltungen");
    // Der Lese-Intent rendert Kennung, Kanal, Status und Betreff - kein Fliesstext aus Nachrichten oder Zusammenfassungen.
    expect(message).not.toContain("Guten Tag Frau Becker");
    expect(message).not.toContain("Passt Ihnen 10:00 Uhr");
    expect(message).not.toContain("Frau Becker bittet um Bestätigung");
    expect(message).not.toContain("\n");
  });
});