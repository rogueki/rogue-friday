import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Automationenabfrage per Sprache: der Befehl muss dieselben Automationen nennen, die die Oberflaeche ueber
 * `GET /api/v1/automations` bekommt - inklusive Filter auf aktiv/deaktiviert und Rueckfrage bei gemischten Filtern.
 */
describe("spoken automation reads", () => {
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

  async function automations(query: string) {
    const response = await owner.get(`/api/v1/automations?limit=5${query}`);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().items as Array<{ id: string; name: string; enabled: boolean }>;
  }

  it("lists the automations the dashboard lists", async () => {
    const expected = await automations("");
    expect(expected.length).toBeGreaterThan(0);
    const message = await command("zeige meine automationen");
    for (const automation of expected) expect(message, `${automation.id} fehlt in: ${message}`).toContain(automation.id);
  });

  it("filters by enabled exactly like the route", async () => {
    const enabled = await automations("&enabled=true");
    const disabled = await automations("&enabled=false");
    expect(enabled.length + disabled.length).toBeGreaterThan(0);
    if (enabled.length > 0) {
      const message = await command("zeige aktive automationen");
      for (const automation of enabled) expect(message).toContain(automation.id);
      for (const automation of disabled) expect(message, `deaktivierte Automation ${automation.id} taucht bei aktiv auf`).not.toContain(automation.id);
    }
    if (disabled.length > 0) {
      const message = await command("zeige deaktivierte automationen");
      for (const automation of disabled) expect(message).toContain(automation.id);
      for (const automation of enabled) expect(message, `aktive Automation ${automation.id} taucht bei deaktiviert auf`).not.toContain(automation.id);
    }
  });

  it("reads one automation by identifier", async () => {
    const first = (await automations(""))[0]!;
    const message = await command(`zeige automation ${first.id}`);
    expect(message).toContain(first.id);
    expect(message).toContain(first.name);
  });

  it("asks back instead of guessing", async () => {
    const expected = await automations("");
    const message = await command("zeige aktive und deaktivierte automationen");
    for (const automation of expected) expect(message, `Automation ${automation.id} taucht in der Rueckfrage auf`).not.toContain(automation.id);
  });
});
