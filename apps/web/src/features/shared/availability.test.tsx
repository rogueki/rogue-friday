import { FridayApiError } from "@friday/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeOverview, overviewResponse } from "@/test/fixtures";
import { CoreOverviewPanel } from "@/features/overview/CorePanels";
import { ActiveAgentsPanel } from "@/features/overview/WidgetPanels";
import { VoiceNavPanel } from "@/features/shell/VoiceNavPanel";
import { TasksPage } from "@/features/tasks/TasksPage";
import { dataOf, listOf, makeTaskWith, routerFetch } from "@/features/tasks/testkit";
import { VoicePage } from "@/features/voice-page/VoicePage";
import { setApiClient } from "@/lib/api/client";
import { adapterInfoOf, capabilitiesOf, renderWithProviders } from "@/test/render";
import { classifyAvailability } from "./availability";
import { resetOutageClock } from "./useAvailability";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  nav.push.mockClear();
  resetOutageClock();
});
afterEach(() => setApiClient(null));

const OFFLINE_HEALTH = {
  status: "offline",
  lifecycle: "OFFLINE",
  latencyMs: null,
  lastSuccessAt: "2026-10-14T08:10:00Z",
  lastError: { code: "ADAPTER_UNAVAILABLE", message: "Hermes-API antwortet nicht" },
  consecutiveFailures: 3,
  circuit: "open",
} as const;

const tasksOffline = adapterInfoOf({ id: "hermes-tasks", category: "tasks", name: "Hermes Aufgaben", health: OFFLINE_HEALTH });
const tasksOnline = adapterInfoOf({ id: "hermes-tasks", category: "tasks", name: "Hermes Aufgaben" });
const NO_TASKS_CAPS = capabilitiesOf({ agents: { read: true } });
const FULL_TASKS = capabilitiesOf({ tasks: { read: true, create: true, update: true, cancel: true, retry: true, pause: true, resume: true }, agents: { read: true } });

const error = (status: number, code: string, message: string) => ({
  status,
  body: { error: { code, message, severity: "error", retryable: status >= 500, correlationId: "corr_00000000000000000000000042", details: {} } },
});

describe("classifyAvailability: not configured vs. outage vs. missing capability (PLAN §9.3)", () => {
  const base = { module: "voice", adaptersPending: false, capabilitiesPending: false } as const;
  const voiceCaps = capabilitiesOf({ voice: { read: true, stop: false } });
  const noVoiceCaps = capabilitiesOf({ tasks: { read: true } });

  it("no adapter registered for the module: not configured", () => {
    expect(classifyAvailability({ ...base, adapters: [], capabilities: noVoiceCaps }).kind).toBe("not-configured");
  });

  it("a placeholder adapter that reports NOT_CONFIGURED (or a disabled one) is not configured, not offline", () => {
    const placeholder = adapterInfoOf({ id: "gmx-mail", category: "communication", health: { status: "offline", lifecycle: "ONLINE", lastError: { code: "NOT_CONFIGURED", message: "Nicht konfiguriert" } } });
    expect(classifyAvailability({ ...base, module: "mail", adapters: [placeholder], capabilities: noVoiceCaps }).kind).toBe("not-configured");
    const disabled = adapterInfoOf({ id: "voice-http", category: "voice", enabled: false });
    expect(classifyAvailability({ ...base, adapters: [disabled], capabilities: voiceCaps }).kind).toBe("not-configured");
  });

  it("a registered adapter that is offline is an outage even though its capabilities vanished from /capabilities", () => {
    const voice = adapterInfoOf({ id: "voice-http", category: "voice", name: "Voice HTTP", health: OFFLINE_HEALTH });
    const result = classifyAvailability({ ...base, adapters: [voice], capabilities: noVoiceCaps });
    expect(result).toMatchObject({ kind: "outage", outage: { adapterId: "voice-http", adapterName: "Voice HTTP", lastSuccessAt: "2026-10-14T08:10:00Z" } });
  });

  it("RECOVERING counts as an outage that is already reconnecting", () => {
    const voice = adapterInfoOf({ id: "voice-http", category: "voice", health: { status: "degraded", lifecycle: "RECOVERING" } });
    expect(classifyAvailability({ ...base, adapters: [voice], capabilities: noVoiceCaps })).toMatchObject({ kind: "outage", outage: { recovering: true } });
  });

  it("an online adapter without the read capability is 'unsupported', not an outage", () => {
    const voice = adapterInfoOf({ id: "voice-http", category: "voice", name: "Voice HTTP" });
    expect(classifyAvailability({ ...base, adapters: [voice], capabilities: noVoiceCaps })).toMatchObject({ kind: "unsupported", capability: "voice.read", adapterName: "Voice HTTP" });
  });

  it("a failing call with ADAPTER_UNAVAILABLE is an outage even when the adapter list says online or is unreadable", () => {
    const failure = new FridayApiError({ code: "ADAPTER_UNAVAILABLE", message: "weg", severity: "error", retryable: true, correlationId: "corr_1", details: {} }, 503);
    const online = adapterInfoOf({ id: "voice-http", category: "voice" });
    expect(classifyAvailability({ ...base, adapters: [online], capabilities: voiceCaps, error: failure }).kind).toBe("outage");
    expect(classifyAvailability({ ...base, adapters: undefined, capabilities: voiceCaps, error: failure }).kind).toBe("outage");
  });

  it("waits for the adapter list instead of guessing when the capability is missing", () => {
    expect(classifyAvailability({ ...base, adapters: undefined, adaptersPending: true, capabilities: noVoiceCaps }).kind).toBe("pending");
  });

  it("is ok when everything is served", () => {
    expect(classifyAvailability({ ...base, adapters: [adapterInfoOf({ id: "voice-http", category: "voice" })], capabilities: voiceCaps }).kind).toBe("ok");
  });
});

describe("Tasks page: the three situations look different", () => {
  it("(a) no adapter: 'Nicht verbunden' with [Adapter konfigurieren]", async () => {
    const api = routerFetch({ "GET /tasks": () => error(403, "CAPABILITY_MISSING", "fehlt"), "GET /agents": listOf([]) });
    renderWithProviders(<TasksPage />, { capabilities: NO_TASKS_CAPS, adapters: [], fetchImpl: api.fetch });
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.getByText(/Für „Aufgaben“ ist kein Adapter konfiguriert/)).toBeInTheDocument();
    const configure = screen.getByRole("button", { name: /Adapter konfigurieren/ });
    await userEvent.click(configure);
    expect(nav.push).toHaveBeenCalledWith("/settings");
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("(b) adapter registered but offline: 'Offline', adapter name, since/last success and a retry (never 'Capability fehlt')", async () => {
    const user = userEvent.setup();
    const api = routerFetch({ "GET /tasks": () => error(503, "ADAPTER_UNAVAILABLE", "Hermes-API antwortet nicht"), "GET /agents": listOf([]), "GET /adapters": listOf([tasksOffline]) });
    renderWithProviders(<TasksPage />, { capabilities: NO_TASKS_CAPS, adapters: [tasksOffline], fetchImpl: api.fetch });
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    const description = screen.getByText(/Hermes Aufgaben nicht erreichbar seit/);
    expect(description).toHaveTextContent("letzter Erfolg 14.10.2026");
    expect(description).toHaveTextContent("Letzte Meldung: Hermes-API antwortet nicht");
    expect(screen.queryByText("Nicht verbunden")).toBeNull();
    expect(screen.queryByText(/Capability/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Adapter konfigurieren/ })).toBeNull();
    const before = api.callsTo("GET /tasks").length;
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(api.callsTo("GET /tasks").length).toBeGreaterThan(before));
  });

  it("(b) offline with cached data: the data stays, marked as offline cache with the outage notice", async () => {
    const task = makeTaskWith({ title: "Wettbewerbsanalyse" });
    const api = routerFetch({ "GET /tasks": listOf([task], { freshness: "offline-cache" }), "GET /agents": listOf([]) });
    renderWithProviders(<TasksPage />, { capabilities: FULL_TASKS, adapters: [tasksOffline], fetchImpl: api.fetch });
    expect(await screen.findByText("Wettbewerbsanalyse")).toBeInTheDocument();
    expect(screen.getAllByText(/Hermes Aufgaben nicht erreichbar/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/zwischengespeicherte Daten/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Offline-Cache").length).toBeGreaterThan(0);
  });

  it("(c) adapter up but read capability missing: 'Lesen nicht verfügbar' naming the capability", async () => {
    const api = routerFetch({ "GET /tasks": () => error(403, "CAPABILITY_MISSING", "fehlt"), "GET /agents": listOf([]) });
    renderWithProviders(<TasksPage />, { capabilities: NO_TASKS_CAPS, adapters: [tasksOnline], fetchImpl: api.fetch });
    expect(await screen.findByText("Lesen nicht verfügbar")).toBeInTheDocument();
    expect(screen.getByText(/Hermes Aufgaben.* tasks\.read nicht an/)).toBeInTheDocument();
    expect(screen.queryByText("Offline")).toBeNull();
    expect(screen.queryByText("Nicht verbunden")).toBeNull();
  });

  it("(c) read-only adapter: data stays, writing says 'Lesen verfügbar · Schreiben nicht verfügbar'", async () => {
    const api = routerFetch({ "GET /tasks": listOf([makeTaskWith({ title: "Wettbewerbsanalyse" })]), "GET /agents": listOf([]), "GET /tasks/:id": dataOf(makeTaskWith()) });
    renderWithProviders(<TasksPage />, {
      capabilities: capabilitiesOf({ tasks: { read: true, create: false, update: false, cancel: false, retry: false, pause: false, resume: false }, agents: { read: true } }),
      adapters: [tasksOnline],
      fetchImpl: api.fetch,
    });
    expect(await screen.findByText("Wettbewerbsanalyse")).toBeInTheDocument();
    expect(screen.getByText("Lesen verfügbar · Schreiben nicht verfügbar")).toBeInTheDocument();
  });
});

describe("Voice: outage is not 'Capability fehlt' and is shown in the sidebar widget", () => {
  const voiceOffline = adapterInfoOf({ id: "friday-voice-http", category: "voice", name: "Friday Voice HTTP", health: OFFLINE_HEALTH });

  it("the page shows the outage, the mic banner names the service and the test panel does not claim a missing capability", async () => {
    const api = routerFetch({
      "GET /voice/status": () => error(503, "ADAPTER_UNAVAILABLE", "Voice-Dienst antwortet nicht"),
      "GET /voice/metrics": () => error(503, "ADAPTER_UNAVAILABLE", "Voice-Dienst antwortet nicht"),
      "GET /voice/profiles": () => error(503, "ADAPTER_UNAVAILABLE", "Voice-Dienst antwortet nicht"),
      "GET /voice/devices": () => error(503, "ADAPTER_UNAVAILABLE", "Voice-Dienst antwortet nicht"),
    });
    renderWithProviders(<VoicePage />, { capabilities: capabilitiesOf({ tasks: { read: true } }), adapters: [voiceOffline], fetchImpl: api.fetch });
    expect((await screen.findAllByText("Offline")).length).toBeGreaterThan(2);
    expect(screen.getAllByText(/Friday Voice HTTP nicht erreichbar/).length).toBeGreaterThan(2);
    expect(screen.getByTestId("mic-activity")).toHaveTextContent("Sprachdienst offline");
    expect(screen.queryByText(/Capability fehlt/)).toBeNull();
    expect(screen.queryByTestId("test-unavailable")).toBeNull();
  });

  it("the sidebar voice widget says 'Sprachdienst offline' instead of the orb's last mode", async () => {
    const api = routerFetch({ "GET /voice/status": () => error(503, "ADAPTER_UNAVAILABLE", "Voice-Dienst antwortet nicht") });
    renderWithProviders(<VoiceNavPanel />, { capabilities: capabilitiesOf({ tasks: { read: true } }), adapters: [voiceOffline], fetchImpl: api.fetch });
    expect(await screen.findByText("Sprachdienst offline")).toBeInTheDocument();
    expect(screen.queryByText("Wartet auf Freigabe")).toBeNull();
  });

  it("the sidebar flags are StatusFlag markers (text alternative, no aria-label on a role-less span)", async () => {
    const online = adapterInfoOf({ id: "friday-voice-http", category: "voice" });
    const status = {
      updatedAt: "2026-10-14T08:15:00Z",
      source: { adapterId: "friday-voice-http", system: "voice", lastSyncedAt: "2026-10-14T08:15:00Z" },
      mode: "idle",
      microphone: { state: "idle", active: false, deviceId: null, inputLevel: 0 },
      wakeWord: { enabled: true, state: "armed", phrase: "Hey Friday" },
      speakerVerification: { enabled: false, state: "disabled", recognizedSpeaker: null, confidence: null },
      trustedSession: { active: false, expiresAt: null },
      stt: { engine: "x", state: "ready", latencyMs: null },
      tts: { engine: "x", state: "ready", latencyMs: null },
      localModel: { name: null, state: "offline", latencyMs: null },
      audioInputDeviceId: null,
      audioOutputDeviceId: null,
      pushToTalk: { enabled: true, active: false },
      focusMode: false,
      rawRecordingEnabled: false,
      voiceHistoryEnabled: true,
    };
    const api = routerFetch({ "GET /voice/status": dataOf(status) });
    const { container } = renderWithProviders(<VoiceNavPanel />, { capabilities: capabilitiesOf({ voice: { read: true } }), adapters: [online], fetchImpl: api.fetch });
    const flags = await screen.findByRole("list", { name: "Sprachstatus im Detail" });
    expect(within(flags).getAllByText(/Wake Word/).length).toBeGreaterThan(0);
    expect(container.querySelector(".web-flag")).toBeNull();
    expect(container.querySelector(".jv-flag")).not.toBeNull();
    expect(container.querySelector("span.jv-flag[aria-label]")).toBeNull();
    expect(within(flags).queryByText(/Gespräch/)).toBeNull();
  });

  it("the sidebar names the conversation mode and a Qwen fault (LG-5.05)", async () => {
    const online = adapterInfoOf({ id: "friday-voice-http", category: "voice" });
    const status = {
      updatedAt: "2026-10-14T08:15:00Z",
      source: { adapterId: "friday-voice-http", system: "voice", lastSyncedAt: "2026-10-14T08:15:00Z" },
      mode: "idle",
      microphone: { state: "idle", active: false, deviceId: null, inputLevel: 0 },
      wakeWord: { enabled: true, state: "armed", phrase: "Hey Friday" },
      speakerVerification: { enabled: false, state: "disabled", recognizedSpeaker: null, confidence: null },
      trustedSession: { active: false, expiresAt: null },
      stt: { engine: "x", state: "ready", latencyMs: null },
      tts: { engine: "x", state: "ready", latencyMs: null },
      localModel: { name: null, state: "offline", latencyMs: null },
      audioInputDeviceId: null,
      audioOutputDeviceId: null,
      pushToTalk: { enabled: true, active: false },
      focusMode: false,
      rawRecordingEnabled: false,
      voiceHistoryEnabled: true,
      conversation: { backend: "qwen", keyConfigured: true, consent: true, lastError: "network" },
    };
    const api = routerFetch({ "GET /voice/status": dataOf(status) });
    renderWithProviders(<VoiceNavPanel />, { capabilities: capabilitiesOf({ voice: { read: true } }), adapters: [online], fetchImpl: api.fetch });
    const flags = await screen.findByRole("list", { name: "Sprachstatus im Detail" });
    expect(within(flags).getAllByText(/Qwen gestört, lokal/).length).toBeGreaterThan(0);
  });
});

describe("Overview: tiles and panels", () => {
  const withSections = (degradedSections: ReturnType<typeof makeOverview>["degradedSections"], extra: Partial<ReturnType<typeof makeOverview>> = {}) =>
    overviewResponse(makeOverview({ degradedSections, ...extra }));
  const voiceOffline = adapterInfoOf({ id: "friday-voice-http", category: "voice", name: "Friday Voice HTTP", health: OFFLINE_HEALTH });

  it("the 'System' tile stays 'Optimal' when only the voice adapter is down; the voice tile reads 'Offline'", () => {
    const overview = makeOverview({
      voice: null,
      degradedSections: [{ section: "Sprache", adapterId: "friday-voice-http", status: "offline", reason: "Voice-Dienst antwortet nicht" }],
      systemSummary: { cpuPercent: 20, ramPercent: 40, gpuPercent: null, vramPercent: null, storageUsedPercent: 30, services: [{ id: "svc_01JAAAAAAAAAAAAAAAAAAAAAAA", name: "Voice-Dienst", status: "offline" }] },
    });
    overview.friday.adapterSummary = { online: 14, degraded: 0, offline: 1 };
    renderWithProviders(<CoreOverviewPanel />, { overview: overviewResponse(overview), adapters: [voiceOffline] });
    const row = (title: string) => screen.getByText(title).closest(".jv-row") as HTMLElement;
    expect(row("Sprache")).toHaveTextContent("Offline");
    expect(row("System")).toHaveTextContent("Optimal");
    expect(row("System")).not.toHaveTextContent("Offline");
    expect(row("Modelle")).not.toHaveTextContent("Offline");
  });

  it("the 'System' tile follows the system health: offline system adapter, resource pressure", () => {
    const down = makeOverview({ degradedSections: [{ section: "System", adapterId: "system-local", status: "offline", reason: "WMI antwortet nicht" }] });
    const view = renderWithProviders(<CoreOverviewPanel />, { overview: overviewResponse(down) });
    expect((screen.getByText("System").closest(".jv-row") as HTMLElement)).toHaveTextContent("Offline");
    view.unmount();
    const hot = makeOverview();
    hot.systemSummary = { ...hot.systemSummary, cpuPercent: 96 };
    renderWithProviders(<CoreOverviewPanel />, { overview: overviewResponse(hot) });
    expect((screen.getByText("System").closest(".jv-row") as HTMLElement)).toHaveTextContent("Eingeschränkt");
  });

  it("a disabled adapter reads 'Nicht verbunden' (not 'Offline') on its tile as well", () => {
    const disabled = adapterInfoOf({ id: "mock-agents", category: "agents", enabled: false });
    renderWithProviders(<CoreOverviewPanel />, {
      overview: withSections([{ section: "Agenten", adapterId: "mock-agents", status: "offline", reason: "Adapter ist deaktiviert." }]),
      adapters: [disabled],
    });
    expect((screen.getByText("Agenten").closest(".jv-row") as HTMLElement)).toHaveTextContent("Nicht verbunden");
  });

  it("(a) an unconfigured adapter: 'Nicht verbunden' with [Adapter konfigurieren]; section labels from the API match the panels", () => {
    renderWithProviders(<ActiveAgentsPanel />, { overview: withSections([{ section: "Agenten", adapterId: "unconfigured-agents", status: "offline", reason: "Kein Adapter konfiguriert." }]) });
    expect(screen.getByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Adapter konfigurieren/ })).toBeInTheDocument();
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("(b) a registered adapter that is offline: 'Offline – <Adapter> nicht erreichbar …, letzter Erfolg …' with retry", () => {
    const hermes = adapterInfoOf({ id: "hermes-agents", category: "agents", name: "Hermes Agenten", health: OFFLINE_HEALTH });
    renderWithProviders(<ActiveAgentsPanel />, {
      overview: withSections([{ section: "Agenten", adapterId: "hermes-agents", status: "offline", reason: "Hermes-API antwortet nicht" }]),
      adapters: [hermes],
    });
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/Hermes Agenten nicht erreichbar seit .*letzter Erfolg/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Erneut versuchen/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Adapter konfigurieren/ })).toBeNull();
  });

  it("a failed section elsewhere does not mark healthy panels as stale", () => {
    const stale = { ...withSections([{ section: "Sprache", adapterId: "x", status: "offline", reason: "weg" }]), freshness: { state: "stale", asOf: "2026-10-14T08:00:00Z" } } as never;
    renderWithProviders(<ActiveAgentsPanel />, { overview: stale });
    expect(screen.queryByText("Diese Daten sind möglicherweise nicht mehr aktuell.")).toBeNull();
  });
});
