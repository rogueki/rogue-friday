import type { AdapterConfigSettings } from "@friday/sdk";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, jsonResponse, renderWithProviders } from "@/test/render";
import { SettingsPage } from "./SettingsPage";
import { ADAPTERS, createFakeApi } from "./testApi";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams("area=adapters&adapter=caldav-calendar"),
}));

const calendar: AdapterConfigSettings = {
  adapterId: "caldav-calendar",
  category: "calendar",
  provider: "caldav-calendar",
  enabled: false,
  config: { mode: "ics" },
  configSchema: { type: "object", properties: { mode: { type: "string", title: "Modus" } } },
  secretFields: { feedUrl: { configured: false }, calendarUrl: { configured: false }, username: { configured: false }, password: { configured: false } },
};

afterEach(() => setApiClient(null));

describe("calendar provider guidance", () => {
  it("guides common providers without changing saved settings or losing drafts", async () => {
    const api = createFakeApi({ extra: (call) => call.method === "GET" && call.path === "/settings/adapters"
      ? jsonResponse({ contractVersion: "2.0.0", items: [calendar, ...ADAPTERS], pageInfo: { nextCursor: null, hasNextPage: false }, freshness: { state: "fresh", asOf: "2026-10-16T10:00:00Z" }, sources: [] })
      : undefined });
    renderWithProviders(<SettingsPage />, { fetchImpl: api.fetchImpl, capabilities: capabilitiesOf({ system: { read: true } }) });

    const provider = await screen.findByLabelText("Anbieterhilfe für Kalender");
    expect(screen.getByText(/Die Auswahl zeigt nur die passende Anleitung/)).toBeInTheDocument();
    fireEvent.change(provider, { target: { value: "google" } });
    expect(screen.getByText(/Geheimadresse im iCal-Format/)).toBeInTheDocument();
    expect(screen.getByText(/Google-CalDAV per Passwort wird hier nicht unterstützt/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Private ICS-URL"), { target: { value: "https://example.test/private.ics" } });

    fireEvent.change(provider, { target: { value: "outlook" } });
    expect(screen.getByText(/Direktes Microsoft-Login und Graph-Schreibzugriff/)).toBeInTheDocument();
    fireEvent.change(provider, { target: { value: "windows" } });
    expect(screen.getByText(/Windows Kalender ist eine App/)).toBeInTheDocument();
    fireEvent.change(provider, { target: { value: "caldav" } });
    expect(screen.getByLabelText("CalDAV-Kalendersammlung (HTTPS)")).toBeInTheDocument();
    fireEvent.change(provider, { target: { value: "ics" } });
    expect(screen.getByLabelText("Private ICS-URL")).toHaveValue("https://example.test/private.ics");
    expect(api.find("PATCH", "/settings/adapters/caldav-calendar")).toHaveLength(0);
    expect(api.find("POST", "/settings/adapters/caldav-calendar/test")).toHaveLength(0);
  });
});
