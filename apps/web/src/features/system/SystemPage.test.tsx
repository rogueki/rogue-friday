import type { AdapterInfo, SystemMetrics } from "@jarvis/sdk";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { useRealtimeStore } from "@/lib/realtime/store";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { HardwarePanel, ServicesPanel, SystemPage } from "./SystemPage";
import { errorBody, FRESH, listOf, mockElementSize, NOW, routedFetch, single, SOURCE } from "./testSupport";

const push = vi.fn();
const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/system",
  useSearchParams: () => params,
}));

const runCommand = vi.fn();
vi.mock("@/features/palette/commandRunner", () => ({ useRunCommand: () => runCommand }));

function adapter(id: string, name: string, status: AdapterInfo["health"]["status"], extra: Partial<AdapterInfo["health"]> = {}): AdapterInfo {
  return {
    manifest: { id, name, adapterVersion: "1.2.0", contractVersion: "1.0.0", apiVersion: "v1", category: "tasks", capabilities: ["tasks.read", "tasks.create"], configSchemaRef: "x", secretFields: [] },
    health: { adapterId: id, status, lifecycle: status === "offline" ? "OFFLINE" : "ONLINE", latencyMs: status === "offline" ? null : 12, lastSuccessAt: status === "offline" ? null : NOW, lastError: status === "offline" ? { code: "ADAPTER_UNAVAILABLE", message: "IMAP nicht erreichbar" } : null, checkedAt: NOW, consecutiveFailures: status === "offline" ? 4 : 0, circuit: status === "offline" ? "open" : "closed", ...extra },
    enabled: true,
    provider: "mock",
    mode: "mock",
  };
}

const ADAPTERS = [adapter("mock-tasks", "Aufgaben", "online"), adapter("mock-mail", "Mail", "offline")];

function metrics(overrides: Partial<SystemMetrics> = {}): SystemMetrics {
  return {
    sampledAt: NOW,
    source: SOURCE,
    cpu: { usagePercent: 40, cores: 8, temperatureC: null },
    ram: { usedBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, usagePercent: 50 },
    gpu: null,
    vram: null,
    storage: [],
    network: { rxBytesPerSec: 2048, txBytesPerSec: 1024, latencyMs: null },
    ...overrides,
  };
}

let restoreSize: () => void;
beforeEach(() => {
  restoreSize = mockElementSize(1200, 600);
  params = new URLSearchParams();
  push.mockReset();
  replace.mockReset();
  runCommand.mockReset();
});
afterEach(() => {
  restoreSize();
  setApiClient(null);
  useRealtimeStore.setState({ state: "connecting", roundtripMs: null, lastEventAt: null, sequence: null });
});

const routes = () => ({
  "GET /api/v1/adapters": listOf(ADAPTERS),
  "GET /api/v1/system/metrics": single(metrics()),
  "GET /api/v1/system/services": listOf([]),
  "GET /api/v1/system/storage": listOf([]),
  "GET /api/v1/system/models": listOf([]),
});

describe("adapter matrix (PLAN §40.3)", () => {
  it("shows adapter, status, latency, capabilities, version and last success, with an offline adapter flagged", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, healthcheck: true } }) });
    const grid = await screen.findByRole("grid", { name: "Adapter-Matrix" });
    for (const header of ["Adapter", "Status", "Latenz", "Capabilities", "Version", "Letzter Erfolg"]) {
      expect(within(grid).getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument();
    }
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const mail = rows.find((row) => within(row).queryByText("Mail"));
    expect(mail).toBeDefined();
    expect(within(mail as HTMLElement).getByText("Offline")).toBeInTheDocument();
    expect(within(mail as HTMLElement).getByText("—", { selector: ".jv-table__cell-value" })).toBeInTheDocument();
    expect(screen.getByText("1 offline")).toBeInTheDocument();
    expect(screen.getByText("1 online")).toBeInTheDocument();
  });

  it("opens the adapter drawer on row activation via the adapter query parameter", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, healthcheck: true } }) });
    const grid = await screen.findByRole("grid", { name: "Adapter-Matrix" });
    const row = within(grid).getAllByRole("row").find((r) => within(r).queryByText("Mail"));
    fireEvent.click(row as HTMLElement);
    expect(replace).toHaveBeenCalledWith("/system?adapter=mock-mail", { scroll: false });
  });

  it("gates the actions: restart and logs are disabled with a reason when the capability is missing", async () => {
    params = new URLSearchParams("adapter=mock-mail");
    const fake = routedFetch(routes());
    renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, healthcheck: true, restartAdapter: false, openLogs: false } }) });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Healthcheck/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Reconnect/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Adapter neu starten/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /Logs öffnen/ })).toBeDisabled();
    expect(within(dialog).getByText(/system\.restartAdapter fehlt/)).toBeInTheDocument();
    expect(within(dialog).getByText("IMAP nicht erreichbar", { exact: false })).toBeInTheDocument();
  });

  it("asks for confirmation before restarting and only then sends the command", async () => {
    params = new URLSearchParams("adapter=mock-mail");
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, healthcheck: true, restartAdapter: true, openLogs: true } }) });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Adapter neu starten/ }));
    const confirm = await screen.findByRole("alertdialog");
    expect(runCommand).not.toHaveBeenCalled();
    expect(within(confirm).getByText(/im Audit-Log protokolliert/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Neu starten" }));
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith({ text: "Adapter Mail neu starten", source: "text" }));
    await user.click(within(dialog).getByRole("button", { name: /Logs öffnen/ }));
    expect(push).toHaveBeenCalledWith("/audit?adapter=mock-mail");
  });

  it("runs the healthcheck for the selected adapter", async () => {
    params = new URLSearchParams("adapter=mock-tasks");
    const user = userEvent.setup();
    const fake = routedFetch({
      ...routes(),
      "GET /api/v1/adapters/mock-tasks/health": single(ADAPTERS[0]?.health),
    });
    renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, healthcheck: true } }) });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Healthcheck/ }));
    await waitFor(() => expect(fake.calls.some((call) => call.path === "/api/v1/adapters/mock-tasks/health")).toBe(true));
  });
});

describe("hardware (PLAN §40.1)", () => {
  it("never invents numbers: missing GPU, VRAM, temperatures and latency are stated as missing", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<HardwarePanel />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true } }) });
    expect(await screen.findByText("CPU")).toBeInTheDocument();
    const gpu = screen.getByText("GPU").closest("[data-missing]") ?? screen.getByText("GPU").closest(".jv-circular");
    expect(gpu).not.toBeNull();
    expect(screen.getAllByText("keine Datenquelle").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Keine Temperatursensoren verfügbar.")).toBeInTheDocument();
    expect(screen.queryByText("0 %")).toBeNull();
  });

  it("renders the offline state when the adapter is unreachable and the error state otherwise", async () => {
    const offline = routedFetch({ "GET /api/v1/system/metrics": () => errorBody("ADAPTER_UNAVAILABLE", "System-Adapter nicht erreichbar", 503) });
    const first = renderWithProviders(<HardwarePanel />, { fetchImpl: offline.fetch, capabilities: capabilitiesOf({ system: { read: true } }) });
    expect(await screen.findByText("System-Adapter nicht erreichbar")).toBeInTheDocument();
    first.unmount();
    const broken = routedFetch({ "GET /api/v1/system/metrics": () => errorBody("INTERNAL", "Interner Fehler", 500) });
    renderWithProviders(<HardwarePanel />, { fetchImpl: broken.fetch, capabilities: capabilitiesOf({ system: { read: true } }) });
    expect(await screen.findByText("Daten konnten nicht geladen werden")).toBeInTheDocument();
  });

  it("shows the unavailable state instead of data when the read capability is missing", () => {
    const fake = routedFetch(routes());
    renderWithProviders(<HardwarePanel />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ files: { read: true } }) });
    expect(screen.getByText(/nicht verfügbar/)).toBeInTheDocument();
  });
});

describe("services (PLAN §40.2)", () => {
  it("lists services with status and gates the healthcheck by capability", async () => {
    const service = { id: "svc_01JAAAAAAAAAAAAAAAAAAAAAAA", version: "1", createdAt: NOW, updatedAt: NOW, source: SOURCE, name: "Hermes", kind: "hermes", status: "degraded", latencyMs: 80, lastCheckAt: NOW, lastSuccessAt: NOW };
    const fake = routedFetch({ "GET /api/v1/system/services": listOf([service]) });
    renderWithProviders(<ServicesPanel />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, healthcheck: false } }) });
    expect(await screen.findByText("Hermes")).toBeInTheDocument();
    expect(screen.getByText("Eingeschränkt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Healthcheck für Hermes/ })).toBeDisabled();
  });

  it("renders the empty state without services", async () => {
    const fake = routedFetch({ "GET /api/v1/system/services": listOf([]) });
    renderWithProviders(<ServicesPanel />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true } }) });
    expect(await screen.findByText("Keine Dienste gemeldet")).toBeInTheDocument();
  });
});

describe("event stream (PLAN §12.6)", () => {
  it("shows state, roundtrip and the age of the last event from the realtime store", async () => {
    useRealtimeStore.setState({ state: "online", roundtripMs: 28, lastEventAt: Date.now() - 20_000, sequence: 1204 });
    const fake = routedFetch(routes());
    renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true } }) });
    expect(await screen.findByText("Event Stream: online")).toBeInTheDocument();
    expect(screen.getByText("28 ms")).toBeInTheDocument();
    expect(screen.getByText(/vor 20 Sek/)).toBeInTheDocument();
    expect(screen.getByText("1.204")).toBeInTheDocument();
  });

  it("states missing measurements as missing while connecting", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true } }) });
    expect(await screen.findByText("Event Stream: verbindet …")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});

void FRESH;
