import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

describe("saved location and weather API", () => {
  let api: TestApi;
  const provider = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.hostname === "geocoding-api.open-meteo.com") return Response.json({ results: [
      { name: "Berlin", country: "Deutschland", country_code: "DE", latitude: 52.52437, longitude: 13.41053 },
    ] });
    if (url.hostname === "api.open-meteo.com") return Response.json({ current: { temperature_2m: 17.4, weather_code: 2, time: "2026-10-18T12:00" } });
    throw new Error(`Unexpected host ${url.hostname}`);
  });

  beforeAll(async () => {
    vi.stubGlobal("fetch", provider);
    api = await startTestApi();
  });
  afterAll(async () => { await api.close(); vi.unstubAllGlobals(); });

  it("requires owner to search, keeps default unset, persists city and returns weather for it", async () => {
    const owner = api.client(); await owner.loginDev("owner");
    const viewer = api.client(); await viewer.loginDev("viewer");
    expect((await viewer.get("/api/v1/location/search", { query: { q: "Berlin" } })).statusCode).toBe(403);
    expect((await viewer.get("/api/v1/weather/current")).json()).toMatchObject({ data: null });
    expect(provider).not.toHaveBeenCalled();
    const found = await owner.get("/api/v1/location/search", { query: { q: "Berlin" } });
    expect(found.statusCode, found.body).toBe(200);
    const location = found.json().data.items[0] as { label: string; countryCode: string; latitude: number; longitude: number };
    expect(location).toMatchObject({ label: "Berlin", latitude: 52.52, longitude: 13.41 });
    const settingsResponse = await owner.get("/api/v1/settings");
    const settings = settingsResponse.json().data as { version: number; dashboard: Record<string, unknown> };
    const tooPrecise = await owner.patch("/api/v1/settings", { dashboard: { ...settings.dashboard,
      location: { label: "Berlin", latitude: 52.52437, longitude: 13.41053 } } },
    { headers: { "if-match": String(settings.version) } });
    expect(tooPrecise.statusCode).toBe(422);
    const saved = await owner.patch("/api/v1/settings", { dashboard: { ...settings.dashboard,
      location: { label: location.label, countryCode: location.countryCode, latitude: location.latitude, longitude: location.longitude } } },
    { headers: { "if-match": String(settings.version) } });
    expect(saved.statusCode, saved.body).toBe(200);
    const weather = await viewer.get("/api/v1/weather/current");
    expect(weather.statusCode, weather.body).toBe(200);
    expect(weather.json()).toMatchObject({ data: { location: { label: "Berlin" }, temperatureC: 17.4, provider: "Open-Meteo", stale: false } });
    const latest = saved.json().data as { version: number; dashboard: Record<string, unknown> };
    const cleared = await owner.patch("/api/v1/settings", { dashboard: { ...latest.dashboard, location: null } }, { headers: { "if-match": String(latest.version) } });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect((await viewer.get("/api/v1/weather/current")).json()).toMatchObject({ data: null });
  });
});
