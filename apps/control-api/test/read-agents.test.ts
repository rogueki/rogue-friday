import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Agentenabfrage per Sprache: der Befehl muss dieselben Agenten nennen, die die Oberflaeche ueber
 * `GET /api/v1/agents` bekommt - inklusive Statusfilter und "aktiv" als Menge der laufenden Zustaende.
 */
describe("spoken agent reads", () => {
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

  async function agents(query: string) {
    const response = await owner.get(`/api/v1/agents?limit=5${query}`);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().items as Array<{ id: string; name: string; status: string }>;
  }

  it("lists the agents the dashboard lists", async () => {
    const expected = await agents("");
    expect(expected.length).toBeGreaterThan(0);
    const message = await command("zeige meine agenten");
    for (const agent of expected) expect(message, `${agent.id} fehlt in: ${message}`).toContain(agent.id);
  });

  it("filters by status exactly like the route", async () => {
    const working = await agents("&status=working");
    expect(working.length).toBeGreaterThan(0);
    const message = await command("zeige laufende agenten");
    for (const agent of working) expect(message).toContain(agent.id);
    for (const agent of await agents("&status=idle")) expect(message, `idle-Agent ${agent.id} taucht bei laufend auf`).not.toContain(agent.id);
  });

  it("reads 'aktive agenten' as every non-paused, non-offline, non-error state", async () => {
    const expected = await agents("&status=idle&status=starting&status=working&status=waiting");
    const message = await command("zeige aktive agenten");
    const ids = new Set(message.match(/\bagent_[0-9A-Za-z]{26}\b/g) ?? []);
    expect([...ids].sort()).toEqual(expected.map((agent) => agent.id).sort());
    for (const agent of await agents("&status=paused")) {
      expect(ids.has(agent.id), `pausierter Agent ${agent.id} gilt als aktiv`).toBe(false);
    }
  });

  it("reads one agent by identifier", async () => {
    const first = (await agents(""))[0]!;
    const message = await command(`zeige agent ${first.id}`);
    expect(message).toContain(first.id);
    expect(message).toContain(first.name);
  });
});