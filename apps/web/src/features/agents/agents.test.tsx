import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataOf, listOf, makeAgentWith, makeEvent, makeTaskWith, routerFetch } from "@/features/tasks/testkit";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { AgentsPage } from "./AgentsPage";
import { displayConfiguration, heartbeatDelayed, successPercent } from "./model";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/agents",
  useSearchParams: () => nav.params,
}));

const FULL = capabilitiesOf({
  agents: { read: true, pause: true, resume: true, stop: true, assignTask: true },
  tasks: { read: true, update: true },
  activity: { read: true },
});
const READ_ONLY = capabilitiesOf({ agents: { read: true, pause: false, resume: false, stop: false, assignTask: false } });

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.push.mockClear();
  nav.replace.mockClear();
});
afterEach(() => setApiClient(null));

describe("agent model", () => {
  it("never invents a success rate and flags a late heartbeat only for live agents", () => {
    expect(successPercent({ successRate: null })).toBeNull();
    expect(successPercent({ successRate: 0.876 })).toBe(88);
    const now = new Date("2026-10-14T12:00:00Z");
    expect(heartbeatDelayed({ status: "working", heartbeatAt: "2026-10-14T11:50:00Z" }, now)).toBe(true);
    expect(heartbeatDelayed({ status: "working", heartbeatAt: "2026-10-14T11:59:30Z" }, now)).toBe(false);
    expect(heartbeatDelayed({ status: "working", heartbeatAt: null }, now)).toBe(true);
    expect(heartbeatDelayed({ status: "offline", heartbeatAt: null }, now)).toBe(false);
    expect(heartbeatDelayed({ status: "idle", heartbeatAt: "2026-10-14T08:00:00Z" }, now)).toBe(false);
  });

  it("masks credential-like configuration values", () => {
    const rows = displayConfiguration({ model: "kimi", apiKey: "sk-123", "refresh_token": "abc", nested: { a: 1 } });
    expect(rows.find((row) => row.key === "model")).toEqual({ key: "model", value: "kimi", masked: false });
    expect(rows.find((row) => row.key === "apiKey")).toEqual({ key: "apiKey", value: "••••••••", masked: true });
    expect(rows.find((row) => row.key === "refresh_token")?.masked).toBe(true);
    expect(rows.find((row) => row.key === "nested")?.value).toBe('{"a":1}');
  });
});

describe("AgentsPage", () => {
  const task = makeTaskWith({ title: "Marktanalyse Hannover", status: "running" });
  const worker = makeAgentWith({
    name: "Recherche-Agent",
    role: "Web- und Quellenrecherche",
    status: "working",
    currentTaskId: task.id,
    model: "Kimi K3",
    reasoningLevel: "high",
    capabilities: ["Websuche", "Quellenbewertung", "Zusammenfassung", "Preisvergleich", "Extraktion"],
    activeTools: ["web.fetch"],
    heartbeatAt: new Date().toISOString(),
    successRate: 0.93,
    performance: { avgTaskDurationMs: 90_000, tasksCompleted: 212, tasksFailed: 9 },
    lastError: { code: "ADAPTER_TIMEOUT", message: "Zeitüberschreitung beim Abruf", severity: "warning", retryable: true, correlationId: "corr_00000000000000000000000031", details: {} },
  });
  const idle = makeAgentWith({ name: "Memory-Agent", status: "idle", successRate: null, currentTaskId: null, model: null, runtimeMs: null, heartbeatAt: null });
  const routes = (extra: Parameters<typeof routerFetch>[0] = {}) =>
    routerFetch({ "GET /agents": listOf([worker, idle]), "GET /tasks": listOf([task]), "GET /agents/:id": dataOf(worker), "GET /tasks/:id": dataOf(task), "GET /activity": listOf([]), ...extra });

  it("shows loading, then all fields of PLAN §31.1 on the cards", async () => {
    renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    expect(screen.getAllByLabelText("Wird geladen …").length).toBeGreaterThan(0);
    const card = (await screen.findByRole("article", { name: "Agent: Recherche-Agent" })) as HTMLElement;
    const within_ = within(card);
    expect(within_.getByText("Web- und Quellenrecherche")).toBeInTheDocument();
    expect(within_.getByText("Aktiv")).toBeInTheDocument();
    expect(within_.getByText("Marktanalyse Hannover")).toBeInTheDocument();
    expect(within_.getByText("Kimi K3")).toBeInTheDocument();
    expect(within_.getByText("Hoch")).toBeInTheDocument();
    expect(within_.getByText("93 %")).toBeInTheDocument();
    expect(within_.getByText("212 erledigt · 9 fehlgeschlagen")).toBeInTheDocument();
    expect(within_.getByText("Websuche")).toBeInTheDocument();
    expect(within_.getByText("+1")).toBeInTheDocument(); // five capabilities, four shown
    expect(within_.getByText("web.fetch")).toBeInTheDocument();
    expect(within_.getByText(/Zeitüberschreitung beim Abruf/)).toBeInTheDocument();
  });

  it("shows missing values as an em dash, never as zero", async () => {
    renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    const card = (await screen.findByRole("article", { name: "Agent: Memory-Agent" })) as HTMLElement;
    expect(within(card).getByText("Kein aktiver Task")).toBeInTheDocument();
    expect(within(card).getAllByText("—").length).toBeGreaterThanOrEqual(3); // model, runtime, heartbeat, success rate
    expect(within(card).queryByText("0 %")).toBeNull();
  });

  it("summarises agents by status and filters by status via the API", async () => {
    const api = routes();
    const user = userEvent.setup();
    renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    await screen.findByRole("article", { name: "Agent: Recherche-Agent" });
    const summary = screen.getByRole("list", { name: "Agenten nach Status" });
    expect(within(summary).getByText("Aktiv")).toBeInTheDocument();
    expect(within(summary).getByText("Bereit")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "idle");
    await waitFor(() => expect(api.callsTo("GET /agents").some((call) => call.query.get("status") === "idle")).toBe(true));
  });

  it("shows empty, offline and error states", async () => {
    const empty = renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: routerFetch({ "GET /agents": listOf([]), "GET /tasks": listOf([]) }).fetch });
    expect(await screen.findByText("Keine Agenten")).toBeInTheDocument();
    empty.unmount();
    const offline = renderWithProviders(<AgentsPage />, {
      capabilities: FULL,
      fetchImpl: routerFetch({ "GET /agents": () => ({ status: 503, body: { error: { code: "ADAPTER_UNAVAILABLE", message: "Agenten-Adapter offline.", severity: "error", retryable: true, correlationId: "corr_00000000000000000000000009", details: {} } } }), "GET /tasks": listOf([]) }).fetch,
    });
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/Agenten-Adapter offline/)).toBeInTheDocument();
    offline.unmount();
    renderWithProviders(<AgentsPage />, {
      capabilities: FULL,
      fetchImpl: routerFetch({ "GET /agents": () => ({ status: 500, body: { error: { code: "INTERNAL", message: "kaputt", severity: "error", retryable: false, correlationId: "corr_00000000000000000000000010", details: {} } } }), "GET /tasks": listOf([]) }).fetch,
    });
    expect(await screen.findByText("Daten konnten nicht geladen werden")).toBeInTheDocument();
  });

  it("states read-only operation", async () => {
    renderWithProviders(<AgentsPage />, { capabilities: READ_ONLY, fetchImpl: routes().fetch });
    await screen.findByRole("article", { name: "Agent: Recherche-Agent" });
    expect(screen.getByText("Lesen verfügbar · Schreiben nicht verfügbar")).toBeInTheDocument();
  });
});

describe("AgentDrawer", () => {
  const task = makeTaskWith({ title: "Marktanalyse Hannover", status: "running" });
  const open = makeTaskWith({ title: "Offene Aufgabe", status: "todo", priority: "P1" });
  const agent = makeAgentWith({
    name: "Recherche-Agent",
    status: "working",
    currentTaskId: task.id,
    configuration: { model: "kimi", apiKey: "sk-secret" },
    successRate: null,
    performance: { avgTaskDurationMs: null, tasksCompleted: 0, tasksFailed: 0 },
  });
  const routes = (extra: Parameters<typeof routerFetch>[0] = {}) =>
    routerFetch({
      "GET /agents": listOf([agent]),
      "GET /agents/:id": dataOf(agent),
      "GET /tasks": listOf([open]),
      "GET /tasks/:id": dataOf(task),
      "GET /activity": listOf([makeEvent({ title: "Seite gelesen", tool: "web.fetch", kind: "tool_call" })]),
      ...extra,
    });

  beforeEach(() => {
    nav.params = new URLSearchParams(`agent=${agent.id}`);
  });

  it("offers the eight tabs and the five actions, gated by status and capability", async () => {
    renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("tab", { name: /Übersicht/ });
    expect(within(dialog).getAllByRole("tab").map((tab) => tab.textContent?.replace(/\d+$/, ""))).toEqual(["Übersicht", "Fähigkeiten", "Aktueller Task", "Verlauf", "Tools", "Leistung", "Fehler", "Konfiguration"]);
    expect(within(dialog).getByRole("button", { name: /Pausieren/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Stoppen/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Aufgabe zuweisen/ })).toBeEnabled();
    const resume = within(dialog).getByRole("button", { name: /Fortsetzen/ });
    expect(resume).toBeDisabled();
    expect(resume).toHaveAttribute("title", "Im aktuellen Status des Agenten nicht möglich.");
    expect(within(dialog).getByRole("button", { name: /Aktivität öffnen/ })).toBeEnabled();
  });

  it("disables every control action without the capability and explains why", async () => {
    renderWithProviders(<AgentsPage />, { capabilities: READ_ONLY, fetchImpl: routes().fetch });
    const dialog = await screen.findByRole("dialog");
    for (const name of [/Pausieren/, /Stoppen/, /Aufgabe zuweisen/]) {
      const button = await within(dialog).findByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", expect.stringContaining("Nur Lesezugriff"));
    }
    // "Open Activity" needs the activity module; this document does not grant it, so it explains instead of hiding
    expect(within(dialog).getByRole("button", { name: /Aktivität öffnen/ })).toBeDisabled();
  });

  it("pauses an agent and stops it only after a confirmation", async () => {
    const api = routes({
      "POST /agents/:id/pause": () => dataOf({ ...agent, status: "paused" }),
      "POST /agents/:id/stop": () => dataOf({ ...agent, status: "offline" }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: /Pausieren/ }));
    await waitFor(() => expect(api.callsTo("POST /agents/:id/pause")).toHaveLength(1));
    expect(api.callsTo("POST /agents/:id/pause")[0]?.headers.get("idempotency-key")).toMatch(/^idem_/);

    await user.click(within(dialog).getByRole("button", { name: /Stoppen/ }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Agent stoppen?")).toBeInTheDocument();
    expect(api.callsTo("POST /agents/:id/stop")).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Agent stoppen" }));
    await waitFor(() => expect(api.callsTo("POST /agents/:id/stop")).toHaveLength(1));
  });

  it("assigns an open task to the agent (POST /tasks/{id}/assign with If-Match)", async () => {
    const api = routes({ "POST /tasks/:id/assign": () => dataOf({ ...open, agentId: agent.id, version: 2 }) });
    const user = userEvent.setup();
    renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: /Aufgabe zuweisen/ }));
    const assign = await screen.findByRole("dialog", { name: "Aufgabe zuweisen" });
    const confirm = within(assign).getByRole("button", { name: "Zuweisen" });
    expect(confirm).toBeDisabled();
    await user.selectOptions(await within(assign).findByRole("combobox", { name: "Aufgabe" }), open.id);
    await user.click(confirm);
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/assign")).toHaveLength(1));
    const call = api.callsTo("POST /tasks/:id/assign")[0]!;
    expect(call.body).toEqual({ agentId: agent.id });
    expect(call.headers.get("if-match")).toBe("1");
    expect(api.callsTo("PATCH /tasks/:id")).toHaveLength(0);
  });

  it("opens the activity filtered to the agent", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: /Aktivität öffnen/ }));
    expect(nav.push).toHaveBeenCalledWith(`/activity?agent=${agent.id}`);
  });

  it("shows the current task, the performance without invented numbers and the masked configuration", async () => {
    nav.params = new URLSearchParams(`agent=${agent.id}&tab=task`);
    const first = renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    let dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Marktanalyse Hannover")).toBeInTheDocument();
    first.unmount();

    nav.params = new URLSearchParams(`agent=${agent.id}&tab=performance`);
    const second = renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Erfolgsquote")).toBeInTheDocument();
    // success rate, average duration, tokens and cost are not reported: dashes with a reason, no invented zeros
    expect(within(dialog).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    second.unmount();

    nav.params = new URLSearchParams(`agent=${agent.id}&tab=configuration`);
    renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("kimi")).toBeInTheDocument();
    expect(within(dialog).queryByText("sk-secret")).toBeNull();
    expect(within(dialog).getByText("••••••••")).toBeInTheDocument();
  });

  it("shows the tool usage of the agent from its activity", async () => {
    nav.params = new URLSearchParams(`agent=${agent.id}&tab=tools`);
    renderWithProviders(<AgentsPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("1 Aufrufe")).toBeInTheDocument();
  });

  it("explains an agent that does not exist", async () => {
    nav.params = new URLSearchParams("agent=agent_00000000000000000000000404");
    renderWithProviders(<AgentsPage />, {
      capabilities: FULL,
      fetchImpl: routes({ "GET /agents/:id": () => ({ status: 404, body: { error: { code: "NOT_FOUND", message: "nicht gefunden", severity: "warning", retryable: false, correlationId: "corr_00000000000000000000000011", details: {} } } }) }).fetch,
    });
    expect(await screen.findByText("Agent nicht gefunden")).toBeInTheDocument();
  });
});
