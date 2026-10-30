import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * Wetter per Sprache: die Antwort muss dasselbe Wetter nennen wie `GET /api/v1/weather/current` (gleicher Service,
 * gleicher Cache); ohne Standort wird nichts erfunden und der Wetterdienst nicht gefragt.
 */
describe("spoken weather read", () => {
  let api: TestApi;
  let owner: ApiClient;
  const provider = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.hostname === "api.open-meteo.com") return Response.json({ current: { temperature_2m: 17.4, weather_code: 2, time: "2026-10-18T12:00" } });
    throw new Error(`Unexpected host ${url.hostname}`);
  });

  beforeAll(async () => {
    vi.stubGlobal("fetch", provider);
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });
  afterAll(async () => { await api.close(); vi.unstubAllGlobals(); });

  async function command(client: ApiClient, text: string) {
    const response = await client.post("/api/v1/commands", { text, source: "voice" });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().result.message as string;
  }

  it("says that no location is saved instead of inventing weather", async () => {
    expect(await command(owner, "wie ist das wetter")).toContain("Kein Standort gespeichert");
    expect(provider).not.toHaveBeenCalled();
  });

  it("reports the weather the overview shows, for operators too", async () => {
    const settings = (await owner.get("/api/v1/settings")).json().data as { version: number; dashboard: Record<string, unknown> };
    const saved = await owner.patch("/api/v1/settings", { dashboard: { ...settings.dashboard,
      location: { label: "Berlin", countryCode: "DE", latitude: 52.52, longitude: 13.41 } } },
    { headers: { "if-match": String(settings.version) } });
    expect(saved.statusCode, saved.body).toBe(200);
    const route = (await owner.get("/api/v1/weather/current")).json().data as { temperatureC: number; location: { label: string } };
    const operator = api.client();
    await operator.loginDev("operator");
    const message = await command(operator, "wie ist das wetter");
    expect(message).toContain(`Wetter in ${route.location.label}`);
    expect(message).toContain("17,4 Grad");
    expect(message).toContain("teilweise bewölkt");
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
