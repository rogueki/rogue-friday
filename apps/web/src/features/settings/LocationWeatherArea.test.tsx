// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocationWeatherArea } from "./LocationWeatherArea";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  value: { activeLayoutId: "default", location: null } as { activeLayoutId: string; location: null | { label: string } },
}));
vi.mock("./SettingsDrafts", () => ({ useAreaDraft: () => ({ value: mocks.value, update: mocks.update, readOnly: false }) }));
afterEach(() => { mocks.update.mockReset(); vi.unstubAllGlobals(); });

it("asks in the app before browser geolocation and offers manual fallback when denied", async () => {
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
  expect(mocks.update).not.toHaveBeenCalled();
});

it("rounds browser coordinates before showing them and waits for explicit acceptance", async () => {
  const getCurrentPosition = vi.fn((success: (position: { coords: { latitude: number; longitude: number } }) => void) =>
    success({ coords: { latitude: 52.52437, longitude: 13.41053 } }));
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  render(<LocationWeatherArea />);
  fireEvent.click(screen.getByRole("button", { name: "Standort aktivieren" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Ja, Standort ermitteln" }));
  expect(await screen.findByText(/52.52°, 13.41°/)).toBeInTheDocument();
  expect(mocks.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ort übernehmen" }));
  expect(mocks.update).toHaveBeenCalledWith({ location: { label: "Aktueller Standort (52.52°, 13.41°)", latitude: 52.52, longitude: 13.41 } });
});

it("shows disambiguated search results and only edits the draft after explicit selection", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { items: [
    { label: "Paris", region: "Texas", country: "USA", countryCode: "US", latitude: 33.66, longitude: -95.56 },
  ] } })));
  render(<LocationWeatherArea />);
  fireEvent.change(screen.getByRole("textbox", { name: "Stadt oder Postleitzahl" }), { target: { value: "Paris" } });
  fireEvent.click(screen.getByRole("button", { name: "Ort suchen" }));
  fireEvent.click(await screen.findByRole("button", { name: "Paris, Texas, USA" }));
  expect(mocks.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ort übernehmen" }));
  expect(mocks.update).toHaveBeenCalledWith({ location: { label: "Paris, Texas, USA", countryCode: "US", latitude: 33.66, longitude: -95.56 } });
});
