// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocationWeatherArea } from "./LocationWeatherArea";

const mocks = vi.hoisted(() => ({
  saveLocation: vi.fn(async () => undefined),
  searchLocations: vi.fn(),
  currentWeather: vi.fn(),
  settings: { dashboard: { location: null as null | { label: string; latitude: number; longitude: number } } },
}));
vi.mock("./SettingsDrafts", () => ({
  useAreaDraft: () => ({ value: mocks.settings.dashboard, readOnly: false }),
  useSettingsDrafts: () => ({ settings: mocks.settings, saveLocation: mocks.saveLocation, conflicts: [] }),
}));
vi.mock("@/lib/api/domains/weather", () => ({
  weatherApi: { searchLocations: mocks.searchLocations, currentWeather: mocks.currentWeather },
}));
afterEach(() => { mocks.saveLocation.mockClear(); mocks.searchLocations.mockReset(); mocks.currentWeather.mockReset(); mocks.settings.dashboard.location = null; vi.unstubAllGlobals(); });

const confirm = () => {
  fireEvent.click(screen.getByRole("button", { name: "Standort aktivieren" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Ja, Standort ermitteln" }));
};

it("asks before browser geolocation and leaves manual search available after denial", async () => {
  const getCurrentPosition = vi.fn((_success: unknown, error: (reason: { code: number }) => void) => error({ code: 1 }));
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  render(<LocationWeatherArea />);
  expect(getCurrentPosition).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Standort aktivieren" }));
  expect(getCurrentPosition).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Ja, Standort ermitteln" }));
  await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Standortzugriff abgelehnt/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Stadt oder Postleitzahl" })).toBeInTheDocument();
  expect(mocks.saveLocation).not.toHaveBeenCalled();
});

it("explains a browser location timeout and leaves settings unchanged", async () => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition: (_success: unknown, error: (reason: { code: number }) => void) => error({ code: 3 }),
  } });
  render(<LocationWeatherArea />);
  confirm();
  expect(await screen.findByText(/Standort konnte nicht ermittelt werden/)).toBeInTheDocument();
  expect(mocks.saveLocation).not.toHaveBeenCalled();
});

it("shows progress, resolves an actual city, then persists only on the explicit save action", async () => {
  let complete!: (position: { coords: { latitude: number; longitude: number } }) => void;
  const getCurrentPosition = vi.fn((success: typeof complete) => { complete = success; });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  const provider = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ lookupSource: "reverseGeocoding", latitude: 52.52, longitude: 13.41,
    city: "Berlin", countryName: "Deutschland", countryCode: "DE" }));
  vi.stubGlobal("fetch", provider);
  render(<LocationWeatherArea />);
  confirm();
  expect(screen.getByText(/Browserstandort wird ermittelt/)).toBeInTheDocument();
  complete({ coords: { latitude: 52.52437, longitude: 13.41053 } });
  expect(await screen.findByText("Ausgewählt: Berlin, Deutschland")).toBeInTheDocument();
  expect(provider).toHaveBeenCalledTimes(1);
  const url = new URL(provider.mock.calls[0]![0] as string);
  expect(url.hostname).toBe("api.bigdatacloud.net");
  expect(url.searchParams.get("latitude")).toBe("52.52");
  expect(url.searchParams.get("longitude")).toBe("13.41");
  expect(mocks.saveLocation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Standort übernehmen und speichern" }));
  await waitFor(() => expect(mocks.saveLocation).toHaveBeenCalledWith({ label: "Berlin, Deutschland", countryCode: "DE", latitude: 52.52, longitude: 13.41 }));
  expect(await screen.findByText(/Standort gespeichert\. Das Wetter/)).toBeInTheDocument();
});

it("saves a selected postal-code result directly without requiring the global settings button", async () => {
  mocks.searchLocations.mockResolvedValue({ data: { items: [
    { label: "Paris", region: "Texas", country: "USA", countryCode: "US", latitude: 33.66, longitude: -95.56 },
  ] } });
  render(<LocationWeatherArea />);
  fireEvent.change(screen.getByRole("textbox", { name: "Stadt oder Postleitzahl" }), { target: { value: "Paris" } });
  fireEvent.click(screen.getByRole("button", { name: "Ort suchen" }));
  await waitFor(() => expect(mocks.searchLocations).toHaveBeenCalledWith("Paris", expect.any(String)));
  fireEvent.click(await screen.findByRole("button", { name: "Paris, Texas, USA" }));
  expect(mocks.saveLocation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Standort übernehmen und speichern" }));
  await waitFor(() => expect(mocks.saveLocation).toHaveBeenCalledWith({ label: "Paris, Texas, USA", countryCode: "US", latitude: 33.66, longitude: -95.56 }));
});

it("keeps previous settings if reverse lookup fails", async () => {
  mocks.settings.dashboard.location = { label: "Vorheriger Ort", latitude: 50, longitude: 8 };
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (success: (position: unknown) => void) => success({ coords: { latitude: 52.52, longitude: 13.41 } }) } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ lookupSource: "ipGeolocation", latitude: 52.52, longitude: 13.41, city: "Berlin", countryName: "Deutschland", countryCode: "DE" })));
  render(<LocationWeatherArea />);
  confirm();
  expect(await screen.findByText(/Ortsname konnte nicht ermittelt/)).toBeInTheDocument();
  expect(screen.getByText("Gespeichert: Vorheriger Ort")).toBeInTheDocument();
  expect(mocks.saveLocation).not.toHaveBeenCalled();
});
