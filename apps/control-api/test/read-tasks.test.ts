import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Sprachlicher Lesepfad fuer Aufgaben: der Befehl muss dieselben Aufgaben nennen, die die Oberflaeche ueber
 * `GET /api/v1/tasks` bekommt. Vorher fiel "Zeige meine offenen Aufgaben" in den Freitextpfad.
 */
const OPEN = new Set(["todo", "ready", "running", "waiting", "review"]);

describe("spoken task reads", () => {
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

  it("lists exactly the tasks the dashboard lists", async () => {
    const direct = await owner.get("/api/v1/tasks?limit=50&sort=priority");
    expect(direct.statusCode, JSON.stringify(direct.body)).toBe(200);
    const expected = (direct.json().items as Array<{ id: string; status: string }>)
      .filter((task) => OPEN.has(task.status))
      .slice(0, 5)
      .map((task) => task.id);
    expect(expected.length).toBeGreaterThan(0);

    const message = await command("Zeige meine offenen Aufgaben");
    for (const id of expected) expect(message, `Aufgabe ${id} fehlt in: ${message}`).toContain(id);
    expect(message).not.toContain("erfunden");
  });

  it("reads one task by its identifier", async () => {
    const direct = await owner.get("/api/v1/tasks?limit=1");
    const id = (direct.json().items as Array<{ id: string }>)[0]?.id;
    expect(id).toBeTruthy();
    const message = await command(`zeige aufgabe ${id}`);
    expect(message).toContain(id!);
  });

  it("never turns a creation sentence into a read and never guesses a status", async () => {
    const created = await owner.post("/api/v1/commands", { text: "Trage Zahnarzt als Aufgabe ein", source: "voice" });
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
    // Kein Lese-Intent: der Befehl laeuft ueber den regulaeren Aufgaben-Anlagepfad, nicht ueber die Listenabfrage.
    expect(JSON.stringify(created.json())).not.toContain("Aufgaben geladen");
  });
});