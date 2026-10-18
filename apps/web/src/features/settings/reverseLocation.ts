export interface NamedLocation {
  label: string;
  latitude: number;
  longitude: number;
  countryCode: string;
}

const coarse = (value: number): number => Math.round(value * 100) / 100;

/** Called only with a fresh, consented browser position. The free endpoint rejects stored/server-side coordinates. */
export async function nameCurrentBrowserLocation(latitude: number, longitude: number, language: "de" | "en"): Promise<NamedLocation> {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error("invalid coordinates");
  }
  const lat = coarse(latitude), lon = coarse(longitude);
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("localityLanguage", language);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("reverse geocoding unavailable");
    const declaredSize = Number(response.headers.get("content-length"));
    if (declaredSize > 120_000) throw new Error("reverse geocoding response too large");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("reverse geocoding response unavailable");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 120_000) { await reader.cancel(); throw new Error("reverse geocoding response too large"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const city = typeof data.city === "string" ? data.city.trim() : "";
    const locality = typeof data.locality === "string" ? data.locality.trim() : "";
    const country = typeof data.countryName === "string" ? data.countryName.trim() : "";
    const countryCode = typeof data.countryCode === "string" ? data.countryCode.trim() : "";
    const source = data.lookupSource;
    if ((!city && !locality) || city.length > 80 || locality.length > 80 || !country || country.length > 60 || !/^[A-Z]{2}$/.test(countryCode)
      || (source !== "reverseGeocoding" && source !== "coordinates") || typeof data.latitude !== "number" || typeof data.longitude !== "number"
      || Math.abs(data.latitude - lat) > 0.011 || Math.abs(data.longitude - lon) > 0.011) {
      throw new Error("reverse geocoding returned no city");
    }
    const label = [city || locality, country].join(", ");
    return { label: label.slice(0, 120), latitude: lat, longitude: lon, countryCode };
  } finally {
    window.clearTimeout(timeout);
  }
}
