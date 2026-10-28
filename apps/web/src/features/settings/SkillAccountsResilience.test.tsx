import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { SettingsPage } from "./SettingsPage";
import { createFakeApi } from "./testApi";

const nav = vi.hoisted(() => ({ search: "area=skillAccounts" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

/** DASH-04.05: a broken skill catalog must not take the rest of the settings page down. */
describe("settings recovery around a broken skill catalog", () => {
  afterEach(() => { setApiClient(null); vi.restoreAllMocks(); });

  function setup(area: string) {
    const api = createFakeApi({
      extra: (call) => call.path === "/skills"
        ? new Response(JSON.stringify({ error: { code: "INTERNAL", message: "Katalog nicht lesbar" } }), {
          status: 500, headers: { "content-type": "application/json" },
        })
        : undefined,
    });
    nav.search = `area=${area}`;
    const view = renderWithProviders(<SettingsPage />, {
      fetchImpl: api.fetchImpl,
      capabilities: capabilitiesOf({ system: { read: true } }),
    });
    return { api, ...view };
  }

  it("reports the catalog failure inside the skill area instead of inventing accounts", async () => {
    const { api } = setup("skillAccounts");
    await waitFor(() => expect(api.calls.some((call) => call.path === "/skills")).toBe(true));
    expect(await screen.findByText(/Skill-Konten konnten nicht geladen werden/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Skills mit Kontenbedarf" })).toBeNull();
  });

  it("keeps every other area editable and savable while the catalog is broken", async () => {
    const { api } = setup("profile");
    const name = await screen.findByLabelText("Anzeigename");
    fireEvent.change(name, { target: { value: "Wieder erreichbar" } });
    const save = await screen.findByRole("button", { name: "Speichern" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH" && call.path === "/settings")).toBe(true));
    // Der kaputte Katalog wird von diesem Bereich gar nicht erst angefragt.
    expect(api.calls.some((call) => call.path === "/skills")).toBe(false);
  });
});