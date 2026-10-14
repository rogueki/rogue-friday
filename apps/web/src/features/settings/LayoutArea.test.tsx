import { configure, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { SettingsPage } from "./SettingsPage";
import { createFakeApi, type FakeApiOptions } from "./testApi";

// The pages load several resources through the fake API; slow CI machines need more than the 1 s default.
configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 20_000 });

const nav = vi.hoisted(() => ({ search: "area=layout" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

function setup(options: FakeApiOptions = {}) {
  const api = createFakeApi(options);
  const view = renderWithProviders(<SettingsPage />, { fetchImpl: api.fetchImpl, capabilities: capabilitiesOf({ system: { read: true } }) });
  return { api, ...view };
}

const exported: Blob[] = [];
beforeEach(() => {
  nav.search = "area=layout";
  exported.length = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    exported.push(blob);
    return "blob:test";
  });
  URL.revokeObjectURL = vi.fn();
  // jsdom opens no file: swallow the synthetic click on the download anchor
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  setApiClient(null);
});

const widgetButton = (name: RegExp) => screen.getByRole("button", { name });

describe("layout editor", () => {
  it("loads the active layout without reporting unsaved changes", async () => {
    setup();
    expect(await screen.findByRole("button", { name: /Kernübersicht: Spalte 0, Zeile 0, Breite 3, Höhe 7/ })).toBeInTheDocument();
    expect(screen.queryByText("Ungespeicherte Änderungen")).toBeNull();
    expect(screen.getByRole("button", { name: "Layout speichern" })).toBeDisabled();
  });

  it("moves a widget with the arrow keys, resizes with Shift and saves it as the active layout", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const widget = await screen.findByRole("button", { name: /^Kernübersicht:/ });
    widget.focus();
    await user.keyboard("{ArrowDown}");
    fireEvent.keyDown(widget, { key: "ArrowRight", shiftKey: true });
    expect(widgetButton(/^Kernübersicht:/)).toHaveAccessibleName("Kernübersicht: Spalte 0, Zeile 1, Breite 4, Höhe 7");
    expect(await screen.findByText("Ungespeicherte Änderungen in diesem Bereich")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Layout speichern" }));
    await waitFor(() => expect(api.find("POST", "/settings/layouts/import")).toHaveLength(1));
    const request = api.find("POST", "/settings/layouts/import")[0]?.body as { activate: boolean; layout: { layoutId: string; widgets: { id: string; y: number; w: number }[] } };
    expect(request.activate).toBe(true);
    expect(request.layout.layoutId).toBe("default");
    expect(request.layout.widgets.find((w) => w.id === "core-overview")).toMatchObject({ y: 1, w: 4 });
    expect(await screen.findByText(/Layout „Standard“ gespeichert und aktiviert/)).toBeInTheDocument();
  });

  it("hides and re-adds widgets", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Kernübersicht ausblenden" }));
    expect(await screen.findByRole("button", { name: "Kernübersicht einblenden" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Systemmonitor hinzufügen" }));
    expect(await screen.findByRole("button", { name: /^Systemmonitor: Spalte 0/ })).toBeInTheDocument();
  });

  it("exports the layout as JSON", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Layout exportieren" }));
    expect(exported).toHaveLength(1);
    const layout = JSON.parse(await exported[0]!.text()) as { layoutId: string; widgets: unknown[] };
    expect(layout.layoutId).toBe("default");
    expect(layout.widgets).toHaveLength(3);
  });

  it("imports a valid layout as draft and rejects an invalid file with reasons", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const field = await screen.findByLabelText("Layout-JSON");
    await user.click(field);
    await user.paste(JSON.stringify({ layoutId: "mein-layout", name: "Mein Layout", widgets: [{ id: "ai-core-orb", x: 0, y: 0, w: 12, h: 8, visible: true }] }));
    await user.click(screen.getByRole("button", { name: "Prüfen und laden" }));
    expect(await screen.findByText(/Layout „Mein Layout“ als Entwurf geladen/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^AI Core \(Orb\): Spalte 0, Zeile 0, Breite 12, Höhe 8/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Kernübersicht:/ })).toBeNull();
    expect(api.find("POST", "/settings/layouts/import")).toHaveLength(0);

    await user.click(screen.getByLabelText("Layout-JSON"));
    await user.paste('{ "layoutId": "kaputt", "widgets": [ { "id": "ai-core-orb", "x": 10, "y": 0, "w": 6, "h": 2, "visible": true } ] }');
    await user.click(screen.getByRole("button", { name: "Prüfen und laden" }));
    expect(await screen.findByText("Layout nicht übernommen:")).toBeInTheDocument();
    expect(screen.getByText(/ragt über die 12 Spalten hinaus/)).toBeInTheDocument();
  });

  it("resets to the built-in default layout", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Zurücksetzen" }));
    expect(await screen.findByRole("button", { name: /^Missionsverlauf:/ })).toBeInTheDocument();
  });

  it("is read-only for a viewer", async () => {
    setup({ role: "viewer" });
    const widget = await screen.findByRole("button", { name: /^Kernübersicht:/ });
    fireEvent.keyDown(widget, { key: "ArrowDown" });
    expect(widget).toHaveAccessibleName("Kernübersicht: Spalte 0, Zeile 0, Breite 3, Höhe 7");
    expect(screen.getByRole("button", { name: "Layout speichern" })).toBeDisabled();
  });
});
