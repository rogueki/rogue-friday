import type { AuditEvent } from "@friday/sdk";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { errorBody, listOf, mockElementSize, NOW, routedFetch, single, SOURCE } from "@/features/system/testSupport";
import { AuditPage } from "./AuditPage";
import { checkChain, diffSnapshots, shortHash } from "./logic";

const push = vi.fn();
const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/audit", useSearchParams: () => params }));

const saveText = vi.fn();
vi.mock("@/features/system/download", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/system/download")>()), saveText: (...args: unknown[]) => saveText(...args) }));

function event(sequence: number, partial: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `aud_${String(sequence).padStart(26, "0")}`,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    source: SOURCE,
    sequence,
    occurredAt: NOW,
    actor: { type: "agent", id: "agent_1", name: "Recherche-Agent" },
    category: "tool_call",
    action: "tool.web.fetch",
    severity: "info",
    result: "success",
    errorCode: null,
    agentId: "agent_1",
    taskId: null,
    tool: "web.fetch",
    adapterId: "mock-research",
    model: null,
    reasoningLevel: null,
    approvalId: null,
    durationMs: 120,
    correlationId: "corr_01JAAAAAAAAAAAAAAAAAAAAAAA",
    context: { url: "https://example.org" },
    before: null,
    after: null,
    artifactIds: [],
    childEventIds: [],
    hash: `hash-${sequence}`,
    prevHash: sequence > 1 ? `hash-${sequence - 1}` : null,
    ...partial,
  };
}

describe("diff and chain logic", () => {
  it("diffs nested snapshots key by key with added, removed and changed entries", () => {
    const entries = diffSnapshots({ status: "pending", nested: { a: 1, gone: true }, same: 1 }, { status: "approved", nested: { a: 1, fresh: [1, 2] }, same: 1 });
    const byPath = Object.fromEntries(entries.map((entry) => [entry.path, entry.kind]));
    expect(byPath).toEqual({ status: "changed", "nested.a": "unchanged", "nested.gone": "removed", "nested.fresh": "added", same: "unchanged" });
    expect(diffSnapshots(null, null)).toEqual([]);
    expect(diffSnapshots(null, { x: 1 })).toEqual([{ path: "x", kind: "added", before: undefined, after: 1 }]);
  });

  it("verifies the visible hash chain, reports breaks and counts gaps", () => {
    expect(checkChain([event(3), event(1), event(2)])).toEqual({ linked: 2, broken: [], gaps: 0, total: 3 });
    expect(checkChain([event(1), event(2, { prevHash: "tampered" }), event(3)])).toMatchObject({ linked: 1, broken: [2] });
    expect(checkChain([event(1), event(5)])).toMatchObject({ gaps: 1, linked: 0 });
    expect(shortHash("0123456789abcdef0123")).toBe("01234567…0123");
    expect(shortHash(null)).toBe("—");
  });
});

const caps = (audit: Record<string, boolean>) => capabilitiesOf({ audit: { read: true, ...audit } });
const ITEMS = [event(3, { action: "approval.approved", category: "approval", approvalId: "appr_01JAAAAAAAAAAAAAAAAAAAAAAA", before: { status: "pending" }, after: { status: "approved" }, childEventIds: [event(2).id], artifactIds: ["file_01JAAAAAAAAAAAAAAAAAAAAAAA"], taskId: "task_01JAAAAAAAAAAAAAAAAAAAAAAA" }), event(2, { result: "failure", severity: "error", action: "tool.mail.draft" }), event(1)];

const routes = (overrides: Record<string, unknown> = {}) => ({
  "GET /api/v1/audit/events": listOf(ITEMS),
  [`GET /api/v1/audit/events/${event(2).id}`]: single(event(2, { result: "failure", severity: "error", action: "tool.mail.draft" })),
  "GET /api/v1/agents": listOf([{ id: "agent_1", name: "Recherche-Agent" }]),
  "GET /api/v1/adapters": listOf([]),
  ...overrides,
});

let restore: () => void;
beforeEach(() => {
  restore = mockElementSize(1200, 700);
  params = new URLSearchParams();
  push.mockReset();
  replace.mockReset();
  saveText.mockReset();
});
afterEach(() => {
  restore();
  setApiClient(null);
});

describe("audit list and filters (PLAN §41.1/41.2)", () => {
  it("lists the audited fields and sends every filter to the API", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AuditPage />, { fetchImpl: fake.fetch, capabilities: caps({ export: true, hashChain: true }) });
    const grid = await screen.findByRole("grid", { name: "Audit-Verlauf" });
    for (const header of ["Zeit", "Akteur", "Aktion", "Kategorie", "Schweregrad", "Ergebnis", "Dauer"]) {
      expect(within(grid).getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument();
    }
    expect(within(grid).getAllByRole("row")).toHaveLength(4);
    await user.selectOptions(screen.getByLabelText("Kategorie"), "approval");
    await user.selectOptions(screen.getByLabelText("Ergebnis"), "failure");
    await user.selectOptions(screen.getByLabelText("Schweregrad"), "error");
    await user.type(screen.getByLabelText("Aktion"), "approval.");
    await user.type(screen.getByLabelText("Tool"), "web.fetch");
    await waitFor(
      () => {
        const last = [...fake.calls].reverse().find((call) => call.path === "/api/v1/audit/events");
        expect(last?.search).toContain("category=approval");
        expect(last?.search).toContain("result=failure");
        expect(last?.search).toContain("severity=error");
        expect(last?.search).toContain("action=approval.");
        expect(last?.search).toContain("tool=web.fetch");
      },
      { timeout: 3000 },
    );
    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(screen.getByLabelText("Aktion")).toHaveValue("");
  }, 20_000);

  it("starts with the adapter filter from a deep link", async () => {
    params = new URLSearchParams("adapter=mock-mail");
    const fake = routedFetch(routes());
    renderWithProviders(<AuditPage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    await waitFor(() => expect(fake.calls.some((call) => call.path === "/api/v1/audit/events" && call.search.includes("adapterId=mock-mail"))).toBe(true));
  });

  it("shows the hash chain indicator only with the capability and reports a break", async () => {
    const tampered = [event(3), event(2, { prevHash: "tampered" }), event(1)];
    const fake = routedFetch(routes({ "GET /api/v1/audit/events": listOf(tampered) }));
    const view = renderWithProviders(<AuditPage />, { fetchImpl: fake.fetch, capabilities: caps({ hashChain: true }) });
    expect(await screen.findByTestId("audit-integrity")).toHaveTextContent("Hash-Kette unterbrochen bei Sequenz 2");
    view.unmount();
    renderWithProviders(<AuditPage />, { fetchImpl: routedFetch(routes()).fetch, capabilities: caps({ hashChain: false }) });
    await screen.findByRole("grid", { name: "Audit-Verlauf" });
    expect(screen.queryByTestId("audit-integrity")).toBeNull();
  });

  it("confirms an intact chain", async () => {
    renderWithProviders(<AuditPage />, { fetchImpl: routedFetch(routes()).fetch, capabilities: caps({ hashChain: true }) });
    expect(await screen.findByTestId("audit-integrity")).toHaveTextContent("lückenlos verknüpft (2 Verknüpfungen geprüft)");
  });
});

describe("audit export (PLAN §41)", () => {
  it("downloads the server export in the chosen format", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes({ "GET /api/v1/audit/export": () => new Response("id,action\naud_1,x\n", { status: 200, headers: { "content-type": "text/csv" } }) }));
    renderWithProviders(<AuditPage />, { fetchImpl: fake.fetch, capabilities: caps({ export: true }) });
    await screen.findByRole("grid", { name: "Audit-Verlauf" });
    await user.click(screen.getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(saveText).toHaveBeenCalled());
    expect(saveText.mock.calls[0]?.[0]).toBe("id,action\naud_1,x\n");
    expect(String(saveText.mock.calls[0]?.[1])).toMatch(/^audit-export-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(saveText.mock.calls[0]?.[2]).toBe("text/csv");
    expect(fake.calls.find((call) => call.path === "/api/v1/audit/export")?.search).toContain("format=csv");
  });

  it("disables the export without the capability", async () => {
    renderWithProviders(<AuditPage />, { fetchImpl: routedFetch(routes()).fetch, capabilities: caps({ export: false }) });
    await screen.findByRole("grid", { name: "Audit-Verlauf" });
    for (const name of ["JSON", "NDJSON", "CSV"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByText(/Capability audit\.export fehlt/)).toBeInTheDocument();
  });

  it("does not swallow an export failure", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes({ "GET /api/v1/audit/export": () => errorBody("FORBIDDEN", "Export nicht erlaubt", 403) }));
    renderWithProviders(<AuditPage />, { fetchImpl: fake.fetch, capabilities: caps({ export: true }) });
    await screen.findByRole("grid", { name: "Audit-Verlauf" });
    await user.click(screen.getByRole("button", { name: "JSON" }));
    await waitFor(() => expect(fake.calls.some((call) => call.path === "/api/v1/audit/export")).toBe(true));
    expect(saveText).not.toHaveBeenCalled();
  });
});

describe("audit detail (PLAN §41.3)", () => {
  it("selects an event through the query parameter", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<AuditPage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    const grid = await screen.findByRole("grid", { name: "Audit-Verlauf" });
    fireEvent.click(within(grid).getByText("approval.approved"));
    expect(replace).toHaveBeenCalledWith(`/audit?event=${ITEMS[0]?.id}`, { scroll: false });
  });

  it("shows event, source, approval link, before/after diff, context, child events, artifacts and hashes", async () => {
    params = new URLSearchParams(`event=${ITEMS[0]?.id}`);
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AuditPage />, { fetchImpl: fake.fetch, capabilities: caps({ hashChain: true }) });
    const detail = await screen.findByTestId("audit-detail");
    expect(within(detail).getByText("approval.approved")).toBeInTheDocument();
    expect(within(detail).getByText("mock-research")).toBeInTheDocument();
    const diff = within(detail).getByRole("table", { name: "Vorher / Nachher" });
    expect(within(diff).getByText("pending")).toBeInTheDocument();
    expect(within(diff).getByText("approved")).toBeInTheDocument();
    expect(within(diff).getByText("geändert")).toBeInTheDocument();
    expect(within(detail).getByText(/"url": "https:\/\/example\.org"/)).toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Freigabe öffnen" }));
    expect(push).toHaveBeenCalledWith("/approvals?approval=appr_01JAAAAAAAAAAAAAAAAAAAAAAA");
    await user.click(within(detail).getByRole("button", { name: "In Dateien öffnen" }));
    expect(push).toHaveBeenCalledWith("/files?file=file_01JAAAAAAAAAAAAAAAAAAAAAAA");
    expect(within(detail).getByText("hash-3")).toBeInTheDocument();
    expect(within(detail).getByText("hash-2")).toBeInTheDocument();
    // child event resolves its action through GET /audit/events/{id} and can be opened
    const child = await within(detail).findByRole("button", { name: new RegExp(`Ereignis ${event(2).id} öffnen`) });
    expect(child).toHaveTextContent("tool.mail.draft");
    await user.click(child);
    expect(replace).toHaveBeenCalledWith(`/audit?event=${event(2).id}`, { scroll: false });
  });

  it("hides integrity details without the hashChain capability", async () => {
    params = new URLSearchParams(`event=${ITEMS[0]?.id}`);
    renderWithProviders(<AuditPage />, { fetchImpl: routedFetch(routes()).fetch, capabilities: caps({ hashChain: false }) });
    const detail = await screen.findByTestId("audit-detail");
    expect(within(detail).queryByText("Integrität")).toBeNull();
  });
});

describe("audit states", () => {
  it("renders empty, filtered-empty, error and offline states", async () => {
    const empty = routedFetch(routes({ "GET /api/v1/audit/events": listOf([]) }));
    const first = renderWithProviders(<AuditPage />, { fetchImpl: empty.fetch, capabilities: caps({}) });
    expect(await screen.findByText("Noch keine Audit-Ereignisse")).toBeInTheDocument();
    first.unmount();
    const broken = routedFetch(routes({ "GET /api/v1/audit/events": () => errorBody("INTERNAL", "kaputt", 500) }));
    const second = renderWithProviders(<AuditPage />, { fetchImpl: broken.fetch, capabilities: caps({}) });
    expect(await screen.findByText("Daten konnten nicht geladen werden")).toBeInTheDocument();
    second.unmount();
    const offline = routedFetch(routes({ "GET /api/v1/audit/events": () => errorBody("ADAPTER_UNAVAILABLE", "Audit-Adapter offline", 503) }));
    renderWithProviders(<AuditPage />, { fetchImpl: offline.fetch, capabilities: caps({}) });
    expect(await screen.findByText(/Audit-Adapter offline/)).toBeInTheDocument();
  });
});
