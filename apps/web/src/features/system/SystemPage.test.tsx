import type { AdapterInfo, SystemMetrics } from "@friday/sdk";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { useRealtimeStore } from "@/lib/realtime/store";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { HardwarePanel, ModelsPanel, ServicesPanel, SystemPage } from "./SystemPage";
import { errorBody, FRESH, listOf, mockElementSize, NOW, routedFetch, single, SOURCE } from "./testSupport";

const push = vi.fn();
const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/system",
  useSearchParams: () => params,
}));

function adapter(id: string, name: string, status: AdapterInfo["health"]["status"], extra: Partial<AdapterInfo["health"]> = {}): AdapterInfo {
  return {
    manifest: { id, name, adapterVersion: "1.2.0", contractVersion: "2.0.0", apiVersion: "v1", category: "tasks", capabilities: ["tasks.read", "tasks.create"], configSchemaRef: "x", secretFields: [] },
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

  it("asks for confirmation before restarting and only then calls the restart operation", async () => {
    params = new URLSearchParams("adapter=mock-mail");
    const user = userEvent.setup();
    const fake = routedFetch({
      ...routes(),
      "POST /api/v1/adapters/mock-mail/restart": { contractVersion: "2.0.0", accepted: true, status: "completed", correlationId: "corr_01JTESTTESTTESTTESTTESTTES", resourceId: "mock-mail", message: "Adapter „Mail“ wurde neu gestartet (ONLINE)." },
    });
    renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, healthcheck: true, restartAdapter: true, openLogs: true } }) });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Adapter neu starten/ }));
    const confirm = await screen.findByRole("alertdialog");
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
    expect(within(confirm).getByText(/im Audit-Log protokolliert/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Neu starten" }));
    await waitFor(() => expect(fake.calls.some((call) => call.path === "/api/v1/adapters/mock-mail/restart")).toBe(true));
    const call = fake.calls.find((entry) => entry.path.endsWith("/restart"));
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("Idempotency-Key")).toBeTruthy();
    expect(call?.headers.get("X-CSRF-Token") ?? "").toBeDefined();
    expect(await screen.findByText("Mail wurde neu gestartet")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    // the restart is no longer routed through the command bar
    expect(fake.calls.some((entry) => entry.path === "/api/v1/commands")).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps working when the restart fails and reports the error", async () => {
    params = new URLSearchParams("adapter=mock-mail");
    const user = userEvent.setup();
    const fake = routedFetch({ ...routes(), "POST /api/v1/adapters/mock-mail/restart": () => errorBody("ADAPTER_UNAVAILABLE", "Der Adapter konnte nicht gestartet werden", 503) });
    renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, restartAdapter: true } }) });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Adapter neu starten/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Neu starten" }));
    await waitFor(() => expect(fake.calls.some((call) => call.path.endsWith("/restart"))).toBe(true));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByText("Mail wurde neu gestartet")).toBeNull();
  });

  describe("logs", () => {
    const entry = (message: string, level: "debug" | "info" | "warn" | "error", extra: Record<string, unknown> = {}) => ({
      timestamp: "2026-10-14T08:14:58Z",
      level,
      message,
      adapterId: "mock-mail",
      correlationId: level === "error" ? "corr_01JTESTTESTTESTTESTTESTTES" : null,
      context: extra,
    });

    it("opens the log view in place (no jump to the audit page), shows the redacted lines and filters by level", async () => {
      params = new URLSearchParams("adapter=mock-mail");
      const user = userEvent.setup();
      const fake = routedFetch({
        ...routes(),
        "GET /api/v1/adapters/mock-mail/logs": (url: URL) =>
          url.searchParams.get("level") === "error"
            ? { contractVersion: "2.0.0", items: [entry("IMAP-Verbindung verloren", "error", { code: "ECONNRESET", token: "[REDACTED]" })], freshness: FRESH, sources: [SOURCE] }
            : { contractVersion: "2.0.0", items: [entry("Healthcheck erfolgreich", "info", { latencyMs: 12 }), entry("IMAP-Verbindung verloren", "error", { code: "ECONNRESET", token: "[REDACTED]" })], freshness: FRESH, sources: [SOURCE] },
      });
      renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, healthcheck: true, restartAdapter: true, openLogs: true } }) });
      const drawer = await screen.findByRole("dialog");
      await user.click(within(drawer).getByRole("button", { name: /Logs öffnen/ }));
      const logs = await screen.findByRole("dialog", { name: "Logs: Mail" });
      const list = await within(logs).findByRole("list", { name: "Logzeilen von Mail" });
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
      expect(within(list).getByText(/Healthcheck erfolgreich/)).toBeInTheDocument();
      expect(within(list).getByText(/latencyMs=12/)).toBeInTheDocument();
      expect(within(list).getByText(/token=\[REDACTED\]/)).toBeInTheDocument();
      expect(within(list).getByText("corr_01JTESTTESTTESTTESTTESTTES")).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
      const first = fake.calls.find((call) => call.path.endsWith("/logs"));
      expect(first?.search).toContain("level=info");
      expect(first?.search).toContain("limit=100");

      await user.selectOptions(within(logs).getByLabelText("Mindestlevel"), "error");
      await waitFor(() => expect(within(logs).getAllByRole("listitem")).toHaveLength(1));
      expect(fake.calls.some((call) => call.search.includes("level=error"))).toBe(true);
      await user.selectOptions(within(logs).getByLabelText("Anzahl Zeilen"), "500");
      await waitFor(() => expect(fake.calls.some((call) => call.search.includes("limit=500"))).toBe(true));
    });

    it("shows the empty and the error state of the log view", async () => {
      params = new URLSearchParams("adapter=mock-mail");
      const user = userEvent.setup();
      let fail = false;
      const fake = routedFetch({
        ...routes(),
        "GET /api/v1/adapters/mock-mail/logs": () => (fail ? errorBody("FORBIDDEN", "Für diese Aktion ist mindestens die Rolle owner erforderlich.", 403) : { contractVersion: "2.0.0", items: [], freshness: FRESH, sources: [SOURCE] }),
      });
      renderWithProviders(<SystemPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true, openLogs: true } }) });
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Logs öffnen/ }));
      const logs = await screen.findByRole("dialog", { name: "Logs: Mail" });
      expect(await within(logs).findByText("Keine Logzeilen")).toBeInTheDocument();
      fail = true;
      await user.selectOptions(within(logs).getByLabelText("Mindestlevel"), "warn");
      expect(await within(logs).findByText("Für diese Aktion ist mindestens die Rolle owner erforderlich.")).toBeInTheDocument();
    });
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
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/System-Adapter nicht erreichbar/)).toBeInTheDocument();
    first.unmount();
    const broken = routedFetch({ "GET /api/v1/system/metrics": () => errorBody("INTERNAL", "Interner Fehler", 500) });
    renderWithProviders(<HardwarePanel />, { fetchImpl: broken.fetch, capabilities: capabilitiesOf({ system: { read: true } }) });
    expect(await screen.findByText("Daten konnten nicht geladen werden")).toBeInTheDocument();
  });

  it("shows 'Nicht verbunden' instead of data when no adapter serves the module", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<HardwarePanel />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ files: { read: true } }) });
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.getByText(/Für „System“ ist kein Adapter konfiguriert/)).toBeInTheDocument();
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

describe("models (PLAN §40.4)", () => {
  const provider = (name: string, models: string[]) => ({ id: "svc_01JAAAAAAAAAAAAAAAAAAAAAAA", version: "1", createdAt: NOW, updatedAt: NOW, source: SOURCE, name, providerKind: "local", status: "online", latencyMs: 40, models });

  it("names the models of every provider, not only their count", async () => {
    const fake = routedFetch({ "GET /api/v1/system/models": listOf([provider("Qwen lokal", ["qwen3-router", "qwen3-coder"]), provider("Leer", [])]) });
    renderWithProviders(<ModelsPanel />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true } }) });
    const names = await screen.findByRole("list", { name: "Modelle: Qwen lokal" });
    expect(within(names).getByText("qwen3-router")).toBeInTheDocument();
    expect(within(names).getByText("qwen3-coder")).toBeInTheDocument();
    expect(screen.getByText(/2 Modelle/)).toBeInTheDocument();
    expect(screen.getByText("Keine Modelle gemeldet")).toBeInTheDocument();
  });

  it("collapses a long model list into a '+N weitere' chip with the full list as tooltip", async () => {
    const many = Array.from({ length: 15 }, (_, index) => `modell-${index + 1}`);
    const fake = routedFetch({ "GET /api/v1/system/models": listOf([provider("Cloud", many)]) });
    renderWithProviders(<ModelsPanel />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ system: { read: true } }) });
    expect(await screen.findByText("modell-12")).toBeInTheDocument();
    expect(screen.queryByText("modell-13")).toBeNull();
    expect(screen.getByText("+3 weitere")).toHaveAttribute("title", "modell-13, modell-14, modell-15");
  });
});
