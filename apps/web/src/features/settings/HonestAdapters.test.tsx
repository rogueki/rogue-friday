import { configure, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterConfigSettings } from "@friday/sdk";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { SettingsPage } from "./SettingsPage";
import { createFakeApi, type FakeApiOptions } from "./testApi";

configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 20_000 });

const nav = vi.hoisted(() => ({ search: "area=adapters", replaced: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: (url: string) => nav.replaced.push(url) }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const tasksAdapter: AdapterConfigSettings = {
  adapterId: "hermes-tasks",
  category: "tasks",
  provider: "hermes-tasks",
  enabled: true,
  config: { dashboardBaseUrl: "http://127.0.0.1:43791" },
  configSchema: { type: "object", properties: { dashboardBaseUrl: { type: "string", title: "Hermes-Dashboard" } } },
  secretFields: {},
};

const calendarAdapter: AdapterConfigSettings = {
  adapterId: "caldav-calendar",
  category: "calendar",
  provider: "caldav-calendar",
  enabled: true,
  config: { mode: "ics" },
  configSchema: { type: "object", properties: { mode: { type: "string" } } },
  secretFields: { feedUrl: { configured: false } },
};

function setup(options: FakeApiOptions = {}) {
  const api = createFakeApi(options);
  const view = renderWithProviders(<SettingsPage />, { fetchImpl: api.fetchImpl, capabilities: capabilitiesOf({ system: { read: true } }) });
  return { api, ...view };
}

beforeEach(() => {
  nav.search = "area=adapters";
  nav.replaced.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  setApiClient(null);
});

describe("honest adapter display in a live installation", () => {
  it("lists every category without an adapter as not configured instead of offering simulation", async () => {
    setup({ dataMode: "live", adapters: [tasksAdapter] });
    expect(await screen.findByText("Nicht eingerichtete Bereiche")).toBeTruthy();
    expect(screen.getByText("Gedächtnis · nicht eingerichtet")).toBeTruthy();
    expect(screen.getByText("Kommunikation · nicht eingerichtet")).toBeTruthy();
    expect(screen.queryByText("Aufgaben · nicht eingerichtet")).toBeNull();
  });

  it("does not promise a simulated calendar when the live calendar has no credentials", async () => {
    setup({ dataMode: "live", adapters: [calendarAdapter] });
    expect(await screen.findByText(/bleibt die Kalenderansicht leer/)).toBeTruthy();
    expect(screen.queryByText(/Simulation/)).toBeNull();
  });

  it("keeps the simulation wording while a mock world runs", async () => {
    setup({ dataMode: "mock", adapters: [calendarAdapter] });
    expect(await screen.findByText(/verwendet Simulation/)).toBeTruthy();
    expect(screen.queryByText("Nicht eingerichtete Bereiche")).toBeNull();
  });
});

describe("leaving a dirty settings area", () => {
  it("asks before discarding a draft and stays when the owner keeps editing", async () => {
    const user = userEvent.setup();
    nav.search = "area=profile";
    setup({ dataMode: "live", adapters: [tasksAdapter] });

    const name = await screen.findByLabelText("Anzeigename");
    await user.clear(name);
    await user.type(name, "Neuer Name");
    await waitFor(() => expect(screen.getAllByRole("status").map(n => n.textContent ?? "").join(" ")).toContain("Ungespeicherte"));

    await user.click(screen.getByRole("button", { name: "Theme" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Ungespeicherte Änderungen wechseln?");
    await user.click(screen.getByRole("button", { name: "Hier bleiben" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(nav.replaced).toEqual([]);
    expect((screen.getByLabelText("Anzeigename") as HTMLInputElement).value).toBe("Neuer Name");
  });

  it("switches and drops the draft when the owner confirms", async () => {
    const user = userEvent.setup();
    nav.search = "area=profile";
    setup({ dataMode: "live", adapters: [tasksAdapter] });

    const name = await screen.findByLabelText("Anzeigename");
    await user.clear(name);
    await user.type(name, "Verworfen");
    await waitFor(() => expect(screen.getAllByRole("status").map(n => n.textContent ?? "").join(" ")).toContain("Ungespeicherte"));

    await user.click(screen.getByRole("button", { name: "Theme" }));
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(screen.getByRole("alertdialog").parentElement as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Theme" }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Verwerfen und wechseln" }));
    await waitFor(() => expect(nav.replaced.at(-1)).toBe("/settings?area=theme"));
  });
});