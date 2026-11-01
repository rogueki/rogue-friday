import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataOf, listOf, makeEvent, mockElementSize, routerFetch } from "@/features/tasks/testkit";
import { setApiClient } from "@/lib/api/client";
import type { ActivityEvent, FridayEvent } from "@friday/sdk";
import type { QueryClient } from "@tanstack/react-query";
import { applyEvent } from "@/lib/realtime/applyEvent";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { ActivityPage } from "./ActivityPage";
import { VirtualList } from "./VirtualList";
import { EMPTY_FILTERS, addToBuffer, buildActivityTree, compareNewestFirst, matchesFilters, toServerFilters } from "./model";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/activity",
  useSearchParams: () => nav.params,
}));

const CAPS = capabilitiesOf({ activity: { read: true, stream: true, backfill: true }, agents: { read: true }, tasks: { read: true } });
const NOW = Date.parse("2026-10-14T08:15:00Z");

/** Delivers an event the way the realtime provider does: through the reducer that patches the query cache. */
function pushLive(queryClient: QueryClient, event: ActivityEvent): void {
  act(() => {
    applyEvent(queryClient, {
      specversion: "1.0",
      id: `evt_${event.sequence}`,
      type: "friday.activity.appended",
      source: "adapter://mock",
      subject: `activity/${event.id}`,
      time: event.occurredAt,
      sequence: event.sequence,
      correlationId: event.correlationId,
      contractVersion: "2.0.0",
      data: event,
    } as unknown as FridayEvent);
  });
}

let restoreSize: () => void = () => undefined;
beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.push.mockClear();
  nav.replace.mockClear();
  restoreSize = mockElementSize(1200, 800);
});
afterEach(() => {
  restoreSize();
  setApiClient(null);
});

describe("activity filters", () => {
  const event = makeEvent({ agentId: "agent_a", taskId: "task_a", tool: "web.fetch", adapterId: "mock-research", model: "Kimi K3", severity: "warning", status: "failed", title: "Preisliste geladen" });

  it("matches on each of the eight filters", () => {
    expect(matchesFilters(event, EMPTY_FILTERS, NOW)).toBe(true);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, agentId: "agent_a" }, NOW)).toBe(true);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, agentId: "agent_b" }, NOW)).toBe(false);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, taskId: "task_b" }, NOW)).toBe(false);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, tool: "web.fetch" }, NOW)).toBe(true);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, tool: "fs.read" }, NOW)).toBe(false);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, adapterId: "mock-research" }, NOW)).toBe(true);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, severity: "error" }, NOW)).toBe(false);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, model: "Qwen Local" }, NOW)).toBe(false);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, status: "failed" }, NOW)).toBe(true);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, q: "preisliste" }, NOW)).toBe(true);
    expect(matchesFilters(event, { ...EMPTY_FILTERS, q: event.correlationId }, NOW)).toBe(true);
  });

  it("applies the time range against the given clock", () => {
    const old = makeEvent({ occurredAt: new Date(NOW - 2 * 3_600_000).toISOString() });
    expect(matchesFilters(old, { ...EMPTY_FILTERS, range: "15m" }, NOW)).toBe(false);
    expect(matchesFilters(old, { ...EMPTY_FILTERS, range: "1h" }, NOW)).toBe(false);
    expect(matchesFilters(old, { ...EMPTY_FILTERS, range: "24h" }, NOW)).toBe(true);
    expect(matchesFilters(old, { ...EMPTY_FILTERS, range: "all" }, NOW)).toBe(true);
  });

  it("passes the filters the server can apply to older pages", () => {
    expect(toServerFilters({ ...EMPTY_FILTERS, agentId: "agent_a", severity: "error", tool: "x", q: "ignored" }, "2026-10-14T07:00:00.000Z")).toEqual({
      agentId: "agent_a",
      severity: ["error"],
      tool: "x",
      from: "2026-10-14T07:00:00.000Z",
    });
  });

  it("keeps the newest copy per id and drops the oldest events beyond the cap", () => {
    const buffer = new Map();
    const first = makeEvent({ title: "alt" });
    addToBuffer(buffer, [first, makeEvent({ id: first.id, version: 2, title: "neu" })], 10);
    expect(buffer.get(first.id).title).toBe("neu");
    addToBuffer(buffer, Array.from({ length: 20 }, () => makeEvent()), 10);
    expect(buffer.size).toBe(10);
    expect([...buffer.values()].sort(compareNewestFirst)[0]).toEqual(expect.objectContaining({ sequence: expect.any(Number) }));
  });
});

describe("activity tree", () => {
  it("nests User Request -> Task -> Agent -> Tool Call / Result and counts descendants", () => {
    const request = makeEvent({ kind: "user_request", title: "Anfrage" });
    const task = makeEvent({ kind: "task", parentId: request.id, title: "Aufgabe" });
    const agent = makeEvent({ kind: "agent", parentId: task.id, title: "Agent" });
    const tool = makeEvent({ kind: "tool_call", parentId: agent.id, title: "Tool" });
    const result = makeEvent({ kind: "result", parentId: agent.id, title: "Ergebnis" });
    const artifact = makeEvent({ kind: "artifact", parentId: task.id, title: "Artefakt" });
    const rows = buildActivityTree([request, task, agent, tool, result, artifact], new Set());
    expect(rows.map((row) => [row.event.title, row.depth])).toEqual([["Anfrage", 0], ["Aufgabe", 1], ["Agent", 2], ["Tool", 3], ["Ergebnis", 3], ["Artefakt", 2]]);
    expect(rows[0]?.childCount).toBe(5);
    expect(rows[2]?.childCount).toBe(2);
  });

  it("hides the children of a collapsed node", () => {
    const parent = makeEvent({ kind: "task" });
    const child = makeEvent({ kind: "agent", parentId: parent.id });
    const rows = buildActivityTree([parent, child], new Set([parent.id]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ collapsed: true, childCount: 1 }));
  });

  it("shows events whose parent is not loaded as roots and survives parent cycles", () => {
    const orphan = makeEvent({ parentId: "act_00000000000000000000000000" });
    const a = makeEvent();
    const b = makeEvent({ parentId: a.id });
    const cyclic = { ...a, parentId: b.id };
    const rows = buildActivityTree([orphan, cyclic, b], new Set());
    expect(rows.map((row) => row.event.id).sort()).toEqual([orphan.id, cyclic.id, b.id].sort());
  });

  it("builds the tree of 10 000 events quickly", () => {
    const events = Array.from({ length: 10_000 }, () => makeEvent());
    const linked = events.map((event, index) => (index % 5 === 0 ? event : { ...event, parentId: events[index - (index % 5)]!.id }));
    const started = performance.now();
    const rows = buildActivityTree(linked, new Set());
    expect(rows).toHaveLength(10_000);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("VirtualList: 10 000 events", () => {
  it("renders only a window of the rows", () => {
    const items = Array.from({ length: 10_000 }, (_, index) => ({ id: `row_${index}`, title: `Zeile ${index}` }));
    const started = performance.now();
    renderWithProviders(<VirtualList items={items} getKey={(item) => item.id} rowHeight={58} label="Ereignisse" renderRow={(item) => <span>{item.title}</span>} />);
    const list = screen.getByRole("list", { name: "Ereignisse" });
    const rows = within(list).getAllByRole("listitem");
    const rendered = rows.length;
    // the window is a small part of the set, but every row announces its position within all 10 000
    expect(rows[0]).toHaveAttribute("aria-setsize", "10000");
    expect(rows[0]).toHaveAttribute("aria-posinset", "1");
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(60);
    expect(screen.getByText("Zeile 0")).toBeInTheDocument();
    expect(screen.queryByText("Zeile 9999")).toBeNull();
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("asks for older events when the end is in view", () => {
    const onEnd = vi.fn();
    const items = Array.from({ length: 12 }, (_, index) => ({ id: `row_${index}` }));
    renderWithProviders(<VirtualList items={items} getKey={(item) => item.id} rowHeight={58} label="Ereignisse" onEndReached={onEnd} renderRow={(item) => <span>{item.id}</span>} />);
    expect(onEnd).toHaveBeenCalled();
  });
});

describe("ActivityPage", () => {
  const agentEvent = makeEvent({ kind: "agent", agentId: "agent_a", title: "Recherche läuft", severity: "info" });
  const failing = makeEvent({ kind: "tool_call", agentId: "agent_a", taskId: "task_00000000000000000000000001", tool: "web.fetch", title: "Abruf fehlgeschlagen", severity: "error", status: "failed", correlationId: "corr_00000000000000000000000044", parentId: agentEvent.id, error: { code: "ADAPTER_TIMEOUT", message: "Zeitüberschreitung", severity: "error", retryable: true, correlationId: "corr_00000000000000000000000045", details: {} } });
  const quiet = makeEvent({ kind: "system", title: "Heartbeat ok", severity: "info" });

  const routes = (extra: Parameters<typeof routerFetch>[0] = {}) =>
    routerFetch({ "GET /activity": listOf([quiet, failing, agentEvent]), "GET /agents": listOf([]), ...extra });

  it("shows loading, then the events with all fields of the row", async () => {
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routes().fetch });
    expect(screen.getAllByLabelText("Wird geladen …").length).toBeGreaterThan(0);
    expect(await screen.findByText("Abruf fehlgeschlagen")).toBeInTheDocument();
    expect(screen.getByText("3 Ereignisse angezeigt, 3 geladen")).toBeInTheDocument();
    // severity and status are words, not only colours
    const feed = screen.getByRole("list", { name: "Ereignisse" });
    expect(within(feed).getByText("Fehler")).toBeInTheDocument();
    expect(within(feed).getByText("Fehlgeschlagen")).toBeInTheDocument();
  });

  it("shows the empty state of a fresh installation", async () => {
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routerFetch({ "GET /activity": listOf([]), "GET /agents": listOf([]) }).fetch });
    expect(await screen.findByText("Noch keine Aktivität")).toBeInTheDocument();
  });

  it("explains an unreachable adapter and an unavailable module", async () => {
    const down = routerFetch({
      "GET /activity": () => ({ status: 503, body: { error: { code: "ADAPTER_UNAVAILABLE", message: "Adapter nicht erreichbar.", severity: "error", retryable: true, correlationId: "corr_00000000000000000000000009", details: {} } } }),
      "GET /agents": listOf([]),
    });
    const { unmount } = renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: down.fetch });
    // The call failed with ADAPTER_UNAVAILABLE: an outage, not "no adapter configured" (PLAN §9.3).
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/Adapter für Live-Aktivität nicht erreichbar/)).toBeInTheDocument();
    expect(screen.queryByText("Nicht verbunden")).toBeNull();
    unmount();
    renderWithProviders(<ActivityPage />, { capabilities: capabilitiesOf({ tasks: { read: true } }), fetchImpl: routes({ "GET /adapters": listOf([]),
      "GET /activity": () => ({ status: 403, body: { error: { code: "CAPABILITY_MISSING", message: "Für 'activity' ist kein Adapter konfiguriert.", severity: "info", retryable: false, correlationId: "corr_00000000000000000000000010", details: {} } } }) }).fetch });
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.getByText(/Für „Live-Aktivität“ ist kein Adapter konfiguriert/)).toBeInTheDocument();
  });

  it("filters by severity and by free text and can reset", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routes().fetch });
    await screen.findByText("Abruf fehlgeschlagen");
    await user.selectOptions(screen.getByRole("combobox", { name: "Schweregrad" }), "error");
    expect(screen.getByText("Abruf fehlgeschlagen")).toBeInTheDocument();
    expect(screen.queryByText("Heartbeat ok")).toBeNull();
    expect(screen.getByText("1 Ereignisse angezeigt, 3 geladen")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(screen.getByText("Heartbeat ok")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "heartbeat");
    expect(screen.queryByText("Abruf fehlgeschlagen")).toBeNull();
    expect(screen.getByText("Heartbeat ok")).toBeInTheDocument();
  });

  it("filters by tool, agent and status options derived from the loaded events", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routes().fetch });
    await screen.findByText("Abruf fehlgeschlagen");
    const tool = screen.getByRole("combobox", { name: "Tool" });
    expect(within(tool).getByRole("option", { name: "web.fetch" })).toBeInTheDocument();
    await user.selectOptions(tool, "web.fetch");
    expect(screen.getByText("1 Ereignisse angezeigt, 3 geladen")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "running");
    expect(screen.getByText("Keine Ereignisse für diese Filter.")).toBeInTheDocument();
  });

  it("pauses live: new events wait until resume and the count is shown", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routes().fetch });
    await screen.findByText("Abruf fehlgeschlagen");
    await user.click(screen.getByRole("button", { name: "Live pausieren" }));
    expect(screen.getByRole("button", { name: /Fortsetzen/ })).toHaveAttribute("aria-pressed", "true");

    pushLive(queryClient, makeEvent({ title: "Neues Ereignis", kind: "result" }));
    expect(screen.queryByText("Neues Ereignis")).toBeNull();
    expect(await screen.findByRole("button", { name: "Fortsetzen (1 neu)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fortsetzen (1 neu)" }));
    expect(await screen.findByText("Neues Ereignis")).toBeInTheDocument();
  });

  it("shows live events immediately while not paused", async () => {
    const { queryClient } = renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routes().fetch });
    await screen.findByText("Abruf fehlgeschlagen");
    pushLive(queryClient, makeEvent({ title: "Live-Ereignis", kind: "result" }));
    expect(await screen.findByText("Live-Ereignis")).toBeInTheDocument();
  });

  it("turns autoscroll off and on with a switch", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routes().fetch });
    await screen.findByText("Abruf fehlgeschlagen");
    const toggle = screen.getByRole("switch", { name: /Automatisch scrollen/ });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("switches to the activity tree, nests children and collapses a branch", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routes().fetch });
    await screen.findByText("Abruf fehlgeschlagen");
    await user.click(screen.getByRole("button", { name: "Baum" }));
    const tree = screen.getByRole("tree", { name: "Aktivitätsbaum" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((item) => item.getAttribute("aria-level"))).toContain("2");
    await user.click(within(tree).getByRole("button", { name: /Zweig zuklappen/ }));
    expect(within(tree).queryByText("Abruf fehlgeschlagen")).toBeNull();
    await user.click(within(tree).getByRole("button", { name: /Zweig aufklappen/ }));
    expect(within(tree).getByText("Abruf fehlgeschlagen")).toBeInTheDocument();
  });

  it("presets the agent filter from a deep link", async () => {
    nav.params = new URLSearchParams("agent=agent_a");
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routes().fetch });
    await screen.findByText("Abruf fehlgeschlagen");
    await waitFor(() => expect(screen.queryByText("Heartbeat ok")).toBeNull());
    expect(nav.replace).toHaveBeenCalled();
  });
});

describe("ActivityDrawer", () => {
  const failing = makeEvent({
    kind: "tool_call",
    agentId: "agent_a",
    taskId: "task_00000000000000000000000001",
    title: "Abruf fehlgeschlagen",
    severity: "error",
    status: "failed",
    correlationId: "corr_00000000000000000000000044",
    result: "Keine Antwort",
    error: { code: "ADAPTER_TIMEOUT", message: "Zeitüberschreitung", severity: "error", retryable: true, correlationId: "corr_00000000000000000000000045", details: {} },
  });
  const base = { "GET /activity": listOf([failing]), "GET /agents": listOf([]) };
  const session = (role: string) => ({ "GET /auth/session": dataOf({ authenticated: true, user: { id: "usr_00000000000000000000000001", displayName: "Erik", role }, role, csrfToken: "x", expiresAt: null, reauthUntil: null }) });
  const meta = (rawJsonView: boolean) => ({ "GET /meta": { contractVersion: "2.0.0", apiVersion: "v1", dataMode: "mock", eventsPath: "/api/v1/events", buildVersion: "1", features: { rawJsonView } } });

  beforeEach(() => {
    nav.params = new URLSearchParams(`event=${failing.id}`);
  });

  it("shows the details, copies the correlation id and jumps to task and agent", async () => {
    const user = userEvent.setup(); // installs its own clipboard stub, so spy afterwards
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routerFetch({ ...base, ...session("viewer"), ...meta(false) }).fetch });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Keine Antwort")).toBeInTheDocument();
    expect(within(dialog).getByText(/Zeitüberschreitung/)).toBeInTheDocument();
    await user.click(within(dialog).getAllByRole("button", { name: "Korrelations-ID kopieren" })[0]!);
    expect(writeText).toHaveBeenCalledWith("corr_00000000000000000000000044");
    await user.click(within(dialog).getByRole("button", { name: /Zur Aufgabe/ }));
    expect(nav.push).toHaveBeenCalledWith("/tasks?task=task_00000000000000000000000001");
    await user.click(within(dialog).getByRole("button", { name: /Zum Agenten/ }));
    expect(nav.push).toHaveBeenCalledWith("/agents?agent=agent_a");
  });

  it("hides the raw JSON from normal users", async () => {
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routerFetch({ ...base, ...session("viewer"), ...meta(false) }).fetch });
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Keine Antwort");
    await waitFor(() => expect(screen.queryByText("Rohdaten (JSON)")).toBeNull());
  });

  it("offers the raw JSON in debug mode or to the owner", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routerFetch({ ...base, ...session("viewer"), ...meta(true) }).fetch });
    let dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Anzeigen" }));
    expect(within(dialog).getByLabelText("Rohdaten (JSON)")).toHaveTextContent(failing.correlationId);
    unmount();

    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routerFetch({ ...base, ...session("owner"), ...meta(false) }).fetch });
    dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: "Anzeigen" })).toBeInTheDocument();
  });

  it("narrows the feed to one flow by correlation id", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ActivityPage />, { capabilities: CAPS, fetchImpl: routerFetch({ ...base, ...session("viewer"), ...meta(false) }).fetch });
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: /Nur diesen Ablauf zeigen/ }));
    expect(nav.replace).toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
  });
});
