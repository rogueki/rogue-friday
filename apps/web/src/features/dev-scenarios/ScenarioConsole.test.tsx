import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeApi, type FakeApiOptions } from "@/features/settings/testApi";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { ScenarioConsolePage } from "./ScenarioConsole";
import { EVENT_SEQUENCES, forceOrbRequest, stepsOf, toMs } from "./scenarioLogic";

// The pages load several resources through the fake API; slow CI machines need more than the 1 s default.
configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 20_000 });

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: router.push, replace: vi.fn() }),
  usePathname: () => "/dev/scenarios",
  useSearchParams: () => new URLSearchParams(),
}));

function setup(options: FakeApiOptions = {}) {
  const api = createFakeApi(options);
  const view = renderWithProviders(<ScenarioConsolePage />, {
    fetchImpl: api.fetchImpl,
    capabilities: capabilitiesOf({ tasks: { read: true, create: true }, mail: { read: true, send: true } }),
  });
  return { api, ...view };
}

afterEach(() => {
  setApiClient(null);
  vi.useRealTimers();
});

const control = (api: ReturnType<typeof createFakeApi>) => api.find("POST", "/dev/scenarios/control").map((call) => call.body);

describe("scenario console", () => {
  it("is not found when the server does not report features.devScenarios, and never calls the dev endpoints", async () => {
    const { api } = setup({ devScenarios: false });
    expect(await screen.findByText("Seite nicht gefunden")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Szenario-Konsole/ })).toBeNull();
    expect(api.calls.filter((call) => call.path.startsWith("/dev/"))).toHaveLength(0);
  });

  it("needs the owner role even when the console exists", async () => {
    const { api } = setup({ role: "viewer" });
    expect(await screen.findByText("Nur für Eigentümer")).toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.startsWith("/dev/"))).toHaveLength(0);
  });

  it("plays the selected scenario at the chosen speed", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await screen.findByRole("heading", { name: /Szenario-Konsole/ });
    await user.click(await screen.findByRole("button", { name: "2×" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Abspielen" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Abspielen" }));
    await waitFor(() => expect(api.find("POST", "/dev/scenarios/clean-idle/play")).toHaveLength(1));
    expect(api.find("POST", "/dev/scenarios/clean-idle/play")[0]?.query).toEqual({ speed: "2" });
    expect(await screen.findByText(/Szenario „Clean Idle“ gestartet/)).toBeInTheDocument();
  });

  it("advances the clock, switches an adapter offline and sets latency and error rate", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.click(await screen.findByRole("button", { name: "+5 min" }));
    await user.click(screen.getByRole("button", { name: "+1 h" }));
    await waitFor(() => expect(control(api)).toHaveLength(2));
    expect(control(api)).toEqual([
      { action: "clock_advance", ms: 300_000 },
      { action: "clock_advance", ms: 3_600_000 },
    ]);

    // offline/online need a concrete adapter
    expect(screen.getByRole("button", { name: "Offline schalten" })).toBeDisabled();
    const target = screen.getByLabelText("Ziel");
    await waitFor(() => expect(within(target).getAllByRole("option").length).toBeGreaterThan(1));
    await user.selectOptions(target, "mock-communication");
    await user.click(screen.getByRole("button", { name: "Offline schalten" }));
    await user.click(screen.getByRole("button", { name: "Online schalten" }));
    await user.clear(screen.getByLabelText("Latenz (ms)"));
    await user.type(screen.getByLabelText("Latenz (ms)"), "1500");
    const setButtons = screen.getAllByRole("button", { name: "Setzen" });
    await user.click(setButtons[0] as HTMLElement);
    await user.click(setButtons[1] as HTMLElement);
    await waitFor(() => expect(control(api)).toHaveLength(6));
    expect(control(api).slice(2)).toEqual([
      { action: "adapter_offline", adapterId: "mock-communication", offline: true },
      { action: "adapter_offline", adapterId: "mock-communication", offline: false },
      { action: "latency", ms: 1500, adapterId: "mock-communication" },
      { action: "error_rate", rate: 0.2, adapterId: "mock-communication" },
    ]);
  }, 20_000);

  it("toggles a capability, forces the orb state and resets the snapshot", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.click(await screen.findByRole("button", { name: "Ausschalten" }));
    await waitFor(() => expect(control(api)).toHaveLength(1));
    expect(control(api)[0]).toMatchObject({ action: "capability_toggle", module: "tasks", capability: "read", enabled: false });

    await user.selectOptions(screen.getByLabelText("Zustand erzwingen"), "speaking");
    await user.click(screen.getByRole("button", { name: "Erzwingen" }));
    await waitFor(() => expect(control(api)).toHaveLength(2));
    expect(control(api)[1]).toEqual({ action: "force_orb_state", mode: "speaking", audioLevel: 0.4 });
    expect(await screen.findByText(/Erzwungen: Spricht/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Snapshot zurücksetzen" }));
    await waitFor(() => expect(control(api)).toHaveLength(3));
    expect(control(api)[2]).toEqual({ action: "reset" });
    await waitFor(() => expect(screen.queryByText(/Erzwungen: Spricht/)).toBeNull());
  });

  it("releases a forced orb state with release_orb_state, not with the snapshot reset", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const release = await screen.findByRole("button", { name: "Freigeben" });
    expect(release).toBeDisabled();
    expect(release).toHaveAttribute("title", "Es ist kein Orb-Zustand erzwungen.");

    await user.selectOptions(screen.getByLabelText("Zustand erzwingen"), "speaking");
    await user.click(screen.getByRole("button", { name: "Erzwingen" }));
    expect(await screen.findByText(/Erzwungen: Spricht/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Freigeben" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Freigeben" }));
    await waitFor(() => expect(control(api)).toHaveLength(2));
    expect(control(api)[1]).toEqual({ action: "release_orb_state" });
    expect(await screen.findByText(/Orb-Zustand freigegeben/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Erzwungen: Spricht/)).toBeNull());
    // the release never goes through the snapshot reset
    expect(control(api).some((body) => (body as { action: string }).action === "reset")).toBe(false);
  });

  it("plays a single event and a multi-step sequence through the orb override", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.click(await screen.findByRole("button", { name: "Fehler" }));
    await waitFor(() => expect(control(api)).toHaveLength(1));
    expect(control(api)[0]).toEqual({ action: "force_orb_state", mode: "error" });
    expect(await screen.findByText(/Ereignis „error“ abgespielt/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fehler und Erholung" }));
    await waitFor(() => expect(control(api).length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
    await waitFor(() => expect(control(api)).toHaveLength(3), { timeout: 4000 });
    expect(control(api).slice(1)).toEqual([
      { action: "force_orb_state", mode: "error" },
      { action: "force_orb_state", mode: "success" },
    ]);
  }, 20_000);
});

describe("scenario logic", () => {
  it("maps events to orb modes like the CLI and builds control requests", () => {
    expect(stepsOf("approval")).toEqual(["waiting_approval"]);
    expect(stepsOf("voice-pipeline")).toEqual(["listening", "transcribing", "thinking", "speaking"]);
    expect(Object.keys(EVENT_SEQUENCES)).toEqual(["voice-pipeline", "error-recovery"]);
    expect(forceOrbRequest("working", { text: "Recherche", level: 0.5 })).toEqual({ action: "force_orb_state", mode: "working", activityText: "Recherche", audioLevel: 0.5 });
    expect(toMs(2, "h")).toBe(7_200_000);
    expect(toMs(0, "s")).toBe(1);
  });
});
