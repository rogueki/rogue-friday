import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Stand der Ersteinrichtung per Sprache: dieselben Schrittzustaende wie `GET /api/v1/onboarding`, und wie die Route nur
 * fuer den Eigentuemer.
 */
describe("spoken onboarding read", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });
  afterEach(async () => { await api.close(); });

  async function command(client: ApiClient, text: string) {
    const response = await client.post("/api/v1/commands", { text, source: "voice" });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().result.message as string;
  }

  it("reports the steps the onboarding route stores", async () => {
    expect(await command(owner, "wie weit ist die einrichtung")).toBe(
      "Einrichtung läuft: 0 von 5 Schritten entschieden (0 erledigt, 0 übersprungen); offen: Einführung, Profil, Skills, Konten, Abschluss.");
    const steps = { intro: "completed", profile: "skipped", skills: "completed", accounts: "skipped", finish: "pending" };
    const saved = await owner.request("PUT", "/api/v1/onboarding", { body: { preferredName: "Alex", steps, goals: [], selectedSkillIds: [] }, headers: { "if-match": "0" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await command(owner, "wie weit ist die einrichtung")).toBe(
      "Einrichtung läuft: 4 von 5 Schritten entschieden (2 erledigt, 2 übersprungen); offen: Abschluss.");
  });

  it("keeps the onboarding state owner-only like the route", async () => {
    const operator = api.client();
    await operator.loginDev("operator");
    expect((await operator.get("/api/v1/onboarding")).statusCode).toBe(403);
    const response = await operator.post("/api/v1/commands", { text: "wie weit ist die einrichtung", source: "voice" });
    expect(response.statusCode).toBe(403);
  });
});
