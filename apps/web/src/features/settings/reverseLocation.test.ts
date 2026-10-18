// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { nameCurrentBrowserLocation } from "./reverseLocation";

afterEach(() => vi.unstubAllGlobals());

it("uses only the fixed client endpoint with rounded coordinates and a real city", async () => {
  const provider = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ lookupSource: "reverseGeocoding", latitude: 52.52, longitude: 13.41,
    city: "Berlin", countryName: "Deutschland", countryCode: "DE" }));
  vi.stubGlobal("fetch", provider);
  await expect(nameCurrentBrowserLocation(52.52437, 13.41053, "de")).resolves.toEqual({
    label: "Berlin, Deutschland", latitude: 52.52, longitude: 13.41, countryCode: "DE",
  });
  const url = new URL(provider.mock.calls[0]![0] as string);
  expect(url.origin).toBe("https://api.bigdatacloud.net");
  expect(url.searchParams.get("latitude")).toBe("52.52");
  expect(url.searchParams.get("longitude")).toBe("13.41");
});

it("accepts the provider SDK's documented coordinates source value", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ lookupSource: "coordinates", latitude: 52.52, longitude: 13.41,
    city: "Berlin", countryName: "Deutschland", countryCode: "DE" })));
  await expect(nameCurrentBrowserLocation(52.52, 13.41, "de")).resolves.toMatchObject({ label: "Berlin, Deutschland" });
});

it.each([
  { lookupSource: "ipGeolocation", latitude: 52.52, longitude: 13.41, city: "Berlin", countryName: "Deutschland", countryCode: "DE" },
  { lookupSource: "reverseGeocoding", latitude: 48.14, longitude: 11.58, city: "München", countryName: "Deutschland", countryCode: "DE" },
  { lookupSource: "reverseGeocoding", latitude: 52.52, longitude: 13.41, city: "", locality: "", countryName: "Deutschland", countryCode: "DE" },
])("rejects an IP guess, mismatched coordinates, or missing locality", async (response) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(response)));
  await expect(nameCurrentBrowserLocation(52.52, 13.41, "de")).rejects.toThrow();
});

it("rejects invalid coordinates without an outbound request", async () => {
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  await expect(nameCurrentBrowserLocation(Number.NaN, 13, "de")).rejects.toThrow();
  expect(provider).not.toHaveBeenCalled();
});
