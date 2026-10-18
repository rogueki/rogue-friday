import type { SettingsService } from "./settings";

export interface SavedLocation {
  label: string;
  latitude: number;
  longitude: number;
  countryCode?: string;
}

export interface LocationCandidate extends SavedLocation {
  region?: string;
  country: string;
}

export interface CurrentWeather {
  location: SavedLocation;
  temperatureC: number;
  weatherCode: number;
  observedAt: string;
  fetchedAt: string;
  stale: boolean;
  provider: "Open-Meteo";
}

const SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const MAX_BODY_BYTES = 120_000;
const FRESH_MS = 10 * 60_000;
const STALE_MS = 60 * 60_000;

export const roundCoordinate = (value: number): number => Math.round(value * 100) / 100;

async function providerJson(url: URL, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(5_000), redirect: "error", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Wetterdienst antwortet mit HTTP ${response.status}.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Wetterdienst-Antwort fehlt.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error("Wetterdienst-Antwort ist zu groß.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Wetterdienst-Antwort ist ungültig.");
  return parsed as Record<string, unknown>;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

export class LocationWeatherService {
  private readonly cache = new Map<string, CurrentWeather>();

  constructor(private readonly settings: SettingsService, private readonly fetcher: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {}

  async search(query: string, language: "de" | "en" = "de"): Promise<LocationCandidate[]> {
    const name = query.trim();
    if (name.length < 2 || name.length > 80 || /[\p{C}]/u.test(name)) throw new Error("Bitte Stadt oder Postleitzahl mit 2 bis 80 Zeichen eingeben.");
    const url = new URL(SEARCH_URL);
    url.searchParams.set("name", name);
    url.searchParams.set("count", "8");
    url.searchParams.set("language", language);
    const body = await providerJson(url, this.fetcher);
    if (body.results === undefined) return [];
    if (!Array.isArray(body.results)) throw new Error("Ortssuche-Antwort ist ungültig.");
    return body.results.slice(0, 8).flatMap((entry: unknown): LocationCandidate[] => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      const { name: city, country, country_code: countryCode, admin1: region, latitude, longitude } = item;
      if (typeof city !== "string" || !city || typeof country !== "string" || !country ||
          typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode) ||
          typeof latitude !== "number" || typeof longitude !== "number" || !validCoordinate(latitude, longitude)) return [];
      return [{ label: city, country, countryCode, ...(typeof region === "string" && region && region !== city ? { region } : {}),
        latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) }];
    });
  }

  async current(): Promise<CurrentWeather | null> {
    const location = this.settings.area("dashboard").location;
    if (!location) return null;
    if (!validCoordinate(location.latitude, location.longitude)) throw new Error("Gespeicherter Standort ist ungültig.");
    const key = `${location.latitude},${location.longitude}`;
    const cached = this.cache.get(key);
    const age = cached ? this.now().getTime() - Date.parse(cached.fetchedAt) : Infinity;
    if (cached && age >= 0 && age < FRESH_MS) return { ...cached, location, stale: false };
    try {
      const url = new URL(WEATHER_URL);
      url.searchParams.set("latitude", String(location.latitude));
      url.searchParams.set("longitude", String(location.longitude));
      url.searchParams.set("current", "temperature_2m,weather_code");
      url.searchParams.set("timezone", "UTC");
      const body = await providerJson(url, this.fetcher);
      const current = body.current;
      if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error("Wetterdaten fehlen.");
      const item = current as Record<string, unknown>;
      if (typeof item.temperature_2m !== "number" || !Number.isFinite(item.temperature_2m) ||
          typeof item.weather_code !== "number" || !Number.isInteger(item.weather_code) ||
          typeof item.time !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(item.time)) throw new Error("Wetterdaten sind ungültig.");
      const weather: CurrentWeather = { location, temperatureC: item.temperature_2m, weatherCode: item.weather_code,
        observedAt: `${item.time}:00Z`, fetchedAt: this.now().toISOString(), stale: false, provider: "Open-Meteo" };
      if (!this.cache.has(key) && this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, weather);
      return weather;
    } catch (error) {
      if (cached && age >= 0 && age < STALE_MS) return { ...cached, location, stale: true };
      throw error;
    }
  }
}
