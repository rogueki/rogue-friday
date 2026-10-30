import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Dateiabfrage per Sprache: der Befehl muss dieselben Dateien nennen, die die Oberflaeche ueber `GET /api/v1/files`
 * bekommt, und eine Einzeldatei mit Name, Kategorie und Version beschreiben.
 */
describe("spoken file reads", () => {
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

  async function files(query = "") {
    const response = await owner.get(`/api/v1/files?limit=5${query}`);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().items as Array<{ id: string; name: string; category: string; currentVersion: number }>;
  }

  it("lists the files the dashboard lists", async () => {
    const expected = await files();
    expect(expected.length, "Mock-Seed ohne Dateien").toBeGreaterThan(0);
    const message = await command("zeige meine dateien");
    for (const file of expected) expect(message, `${file.id} fehlt in: ${message}`).toContain(file.id);
  });

  it("filters by category like the route", async () => {
    const all = await files("&limit=100");
    const category = all[0]!.category;
    const words: Record<string, string> = { generated: "erzeugte", uploaded: "hochgeladene", reports: "berichte",
      presentations: "praesentationen", invoices: "rechnungen", research: "recherche", exports: "exporte", temporary: "temporaere" };
    const expected = await files(`&category=${category}`);
    const message = await command(`zeige ${words[category]} dateien`);
    for (const file of expected) expect(message, `${file.id} fehlt in: ${message}`).toContain(file.id);
    for (const other of all.filter((file) => file.category !== category))
      expect(message, `${other.id} gehoert nicht zur Kategorie ${category}`).not.toContain(other.id);
  });

  it("reads one file by identifier", async () => {
    const file = (await files())[0]!;
    const message = await command(`zeige datei ${file.id}`);
    expect(message).toContain(file.id);
    expect(message).toContain(file.name);
    expect(message).toContain(`Version ${file.currentVersion}`);
  });

  it("asks back for a name search instead of passing free text to the adapter", async () => {
    const response = await owner.post("/api/v1/commands", { text: "suche die datei angebot", source: "voice" });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    expect(response.json().result.message).toContain("sucht nicht nach Namen");
  });
});
