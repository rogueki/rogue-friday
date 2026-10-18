import { describe, expect, it, vi } from "vitest";
import { LocationWeatherService } from "../src/services/location-weather";
import type { SettingsService } from "../src/services/settings";

const berlin = { label: "Berlin, Deutschland", latitude: 52.52, longitude: 13.41, countryCode: "DE" };
const paris = { label: "Paris, France", latitude: 48.86, longitude: 2.35, countryCode: "FR" };
const weatherBody = (temperature: number) => ({ current: { temperature_2m: temperature, weather_code: 3, time: "2026-10-18T12:00" } });

describe("location weather", () => {
  it("does not call the provider until a location is saved, then keys cache by location and marks stale fallback", async () => {
    let location: typeof berlin | typeof paris | null = null;
    let now = new Date("2026-10-18T12:01:00Z");
    let broken = false;
    const fetcher = vi.fn(async (url: URL) => {
      if (broken) throw new Error("offline");
      expect(url.hostname).toBe("api.open-meteo.com");
      return new Response(JSON.stringify(weatherBody(url.searchParams.get("latitude") === "52.52" ? 15.2 : 21.1)));
    }) as unknown as typeof fetch;
    const settings = { area: () => ({ location }) } as unknown as SettingsService;
    const service = new LocationWeatherService(settings, fetcher, () => now);
    expect(await service.current()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    location = berlin;
    expect((await service.current())?.temperatureC).toBe(15.2);
    expect((await service.current())?.stale).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    location = paris;
    expect((await service.current())?.temperatureC).toBe(21.1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    now = new Date("2026-10-18T12:15:00Z"); broken = true;
    expect((await service.current())?.stale).toBe(true);
    location = null;
    expect(await service.current()).toBeNull();
    location = berlin;
    expect((await service.current())?.location.label).toBe(berlin.label);
    expect((await service.current())?.temperatureC).toBe(15.2);
  });

  it("returns disambiguated coarse locations and rejects malformed provider data", async () => {
    const settings = { area: () => ({ location: null }) } as unknown as SettingsService;
    const service = new LocationWeatherService(settings, async () => new Response(JSON.stringify({ results: [
      { name: "Paris", country: "Frankreich", country_code: "FR", admin1: "Île-de-France", latitude: 48.8566, longitude: 2.3522 },
      { name: "Paris", country: "Vereinigte Staaten", country_code: "US", admin1: "Texas", latitude: 33.6609, longitude: -95.5555 },
      { name: "bad", latitude: "0" },
    ] })));
    const result = await service.search("Paris");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ countryCode: "FR", latitude: 48.86, longitude: 2.35 });
    expect(result[1]).toMatchObject({ countryCode: "US", latitude: 33.66, longitude: -95.56 });
    await expect(service.search("x")).rejects.toThrow("2 bis 80");
  });
});
