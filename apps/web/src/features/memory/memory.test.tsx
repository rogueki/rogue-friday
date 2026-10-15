import type { Memory } from "@jarvis/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { renderWithProviders } from "@/test/render";
import { errorResponse, FRESH, FULL, listOf, modules, NOW, resource, routedFetch, single } from "./kit/testSupport";
import { resetRouter } from "./kit/testRouter";
import { MemoryPage } from "./MemoryPage";

vi.mock("next/navigation", async () => (await import("./kit/testRouter")).navigationMock);

const ID = "mem_01JAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "mem_01JBBBBBBBBBBBBBBBBBBBBBBB";

function makeMemory(partial: Partial<Memory> = {}): Memory {
  return {
    ...resource(ID, 3),
    type: "preference",
    title: "Kaffeesorte",
    content: "Trinkt morgens einen doppelten Espresso ohne Zucker.",
    confidence: 0.9,
    confirmedAt: NOW,
    expiresAt: null,
    tags: ["alltag"],
    entities: [],
    locked: false,
    pinned: false,
    sensitivity: "normal",
    provenance: { kind: "conversation", description: "Gespräch vom Montag" },
    usageCount: 4,
    lastUsedAt: NOW,
    conflicts: [],
    history: [{ version: 1, changedAt: NOW, actor: { type: "user", id: "usr_1", name: "Erik Brandt" }, change: "created", summary: "Angelegt", before: null, after: null }],
    ...partial,
  };
}

const baseRoutes = (memory = makeMemory()) => ({
  "GET /api/v1/memory": listOf([memory]),
  [`GET /api/v1/memory/${memory.id}`]: single(memory),
});

beforeEach(() => resetRouter("/memory"));
afterEach(() => setApiClient(null));

describe("memory page: states", () => {
  it("shows the loading skeleton while the request is pending", () => {
    renderWithProviders(<MemoryPage />, { capabilities: modules(FULL) });
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("lists memories with type, confidence and flags", async () => {
    const fake = routedFetch(baseRoutes(makeMemory({ pinned: true, sensitivity: "sensitive" })));
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const row = (await screen.findByText("Kaffeesorte")).closest("button") as HTMLElement;
    expect(within(row).getByText("Präferenz")).toBeInTheDocument();
    expect(within(row).getByText("Konfidenz 90 %")).toBeInTheDocument();
    expect(within(row).getByText("Sensibel")).toBeInTheDocument();
    expect(within(row).getByLabelText("Angeheftet")).toBeInTheDocument();
  });

  it("shows an empty state with a create action", async () => {
    const fake = routedFetch({ "GET /api/v1/memory": listOf([]) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Noch keine Gedächtniseinträge")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Neuer Eintrag/ }).length).toBeGreaterThan(0);
  });

  it("shows the error state with the correlation id and a retry button", async () => {
    const fake = routedFetch({ "GET /api/v1/memory": errorResponse("INTERNAL", "Datenbankfehler", 500) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Datenbankfehler")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Erneut versuchen/ })).toBeInTheDocument();
  });

  it("shows the outage with a retry when the adapter is unreachable", async () => {
    const fake = routedFetch({ "GET /api/v1/memory": errorResponse("ADAPTER_UNAVAILABLE", "Gedächtnis-Adapter nicht erreichbar", 503) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/Gedächtnis-Adapter nicht erreichbar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Erneut versuchen/ })).toBeInTheDocument();
  });

  it("treats a missing memory module as not connected", async () => {
    const fake = routedFetch(baseRoutes());
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules({ tasks: { read: true } }) });
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Adapter konfigurieren/ })).toBeInTheDocument();
  });

  it("marks stale data and never presents it as live", async () => {
    const fake = routedFetch({ "GET /api/v1/memory": listOf([makeMemory()], { freshness: { state: "stale", asOf: NOW } }) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Kaffeesorte");
    expect(screen.getAllByText(/möglicherweise nicht mehr aktuell/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Veraltet").length).toBeGreaterThan(0);
  });
});

describe("memory page: capability gating", () => {
  it("read-only: shows 'Lesen verfügbar' and disables writing actions", async () => {
    const fake = routedFetch(baseRoutes());
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules({ memory: { read: true, search: true } }) });
    await screen.findByText("Kaffeesorte");
    expect(screen.getByText("Lesen verfügbar")).toBeInTheDocument();
    expect(screen.getByText("Schreiben nicht verfügbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Neuer Eintrag/ })).toBeDisabled();
  });

  it("without search capability the semantic switch is off and disabled", async () => {
    const fake = routedFetch(baseRoutes());
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules({ memory: { read: true } }) });
    await screen.findByText("Kaffeesorte");
    const toggle = screen.getByRole("switch", { name: /Semantische Suche/ });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

describe("memory page: search, detail and forgetting", () => {
  it("runs a semantic search through POST /memory/search and shows the relevance", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({
      ...baseRoutes(),
      "POST /api/v1/memory/search": () => ({ contractVersion: "1.0.0", items: [{ memory: makeMemory(), score: 0.87, highlights: ["doppelten Espresso"] }], freshness: FRESH, sources: [] }),
    });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Kaffeesorte");
    await user.type(screen.getByRole("searchbox", { name: "Gedächtnis durchsuchen" }), "Kaffee");
    expect(await screen.findByText("Relevanz 87 %")).toBeInTheDocument();
    const search = fake.to("POST", "/api/v1/memory/search").at(-1);
    expect(search?.body).toMatchObject({ query: "Kaffee", semantic: true });
  });

  it("falls back to the keyword filter when the semantic switch is off", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(baseRoutes());
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Kaffeesorte");
    await user.click(screen.getByRole("switch", { name: /Semantische Suche/ }));
    await user.type(screen.getByRole("searchbox", { name: "Gedächtnis durchsuchen" }), "Espresso");
    await waitFor(() => expect(fake.calls.some((call) => call.method === "GET" && call.path === "/api/v1/memory" && call.search.includes("q=Espresso"))).toBe(true));
    expect(fake.to("POST", "/api/v1/memory/search")).toHaveLength(0);
  });

  it("opens the detail drawer with provenance, usage, history and conflicts", async () => {
    const user = userEvent.setup();
    const memory = makeMemory({ conflicts: [{ memoryId: OTHER, reason: "Widerspricht dem Eintrag zum Tee", detectedAt: NOW, resolution: "pending" }] });
    const fake = routedFetch(baseRoutes(memory));
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await user.click((await screen.findByText("Kaffeesorte")).closest("button") as HTMLElement);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Trinkt morgens einen doppelten Espresso ohne Zucker.")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("tab", { name: /Herkunft/ }));
    expect(within(drawer).getByText("Gespräch vom Montag")).toBeInTheDocument();
    expect(within(drawer).getByText("4-mal verwendet")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("tab", { name: /Verlauf/ }));
    expect(within(drawer).getByText("Angelegt", { selector: "p" })).toBeInTheDocument();
    await user.click(within(drawer).getByRole("tab", { name: /Konflikte/ }));
    expect(within(drawer).getByText("Widerspricht dem Eintrag zum Tee")).toBeInTheDocument();
  });

  it("forgets only after confirmation, with If-Match, and points to the audit log", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({
      ...baseRoutes(),
      [`DELETE /api/v1/memory/${ID}`]: { contractVersion: "1.0.0", accepted: true, status: "completed", correlationId: "corr_01JTESTTESTTESTTESTTESTTES" },
    });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await user.click((await screen.findByText("Kaffeesorte")).closest("button") as HTMLElement);
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("button", { name: /Vergessen/ }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/im Audit-Protokoll festgehalten/)).toBeInTheDocument();
    expect(fake.to("DELETE", `/api/v1/memory/${ID}`)).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Endgültig vergessen" }));
    await waitFor(() => expect(fake.to("DELETE", `/api/v1/memory/${ID}`)).toHaveLength(1));
    expect(fake.to("DELETE", `/api/v1/memory/${ID}`)[0]?.headers.get("If-Match")).toBe("3");
  });

  it("closes the drawer and confirms the deletion even when the realtime event removes the detail before the response arrives", async () => {
    const user = userEvent.setup();
    let deleted = false;
    const fake = routedFetch({
      "GET /api/v1/memory": () => listOf(deleted ? [] : [makeMemory()]),
      [`GET /api/v1/memory/${ID}`]: () => (deleted ? errorResponse("NOT_FOUND", "Eintrag nicht gefunden", 404) : single(makeMemory())),
      [`DELETE /api/v1/memory/${ID}`]: { contractVersion: "1.0.0", accepted: true, status: "completed", correlationId: "corr_01JTESTTESTTESTTESTTESTTES" },
    });
    // The server publishes `jarvis.memory.deleted` before it answers: applyEvent drops the detail query (unmounting the
    // drawer content) while the DELETE response is still in flight.
    const rendered = renderWithProviders(<MemoryPage />, {
      fetchImpl: ((input: Request | string | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.method !== "DELETE") return fake.fetch(input, init);
        deleted = true;
        // same two steps as `removeResource` in lib/realtime/applyEvent.ts: the list loses the entry, the detail query is dropped
        rendered.queryClient.setQueriesData<{ items: unknown[] }>({ queryKey: queryKeys.memory.lists() }, (old) => (old ? { ...old, items: [] } : old));
        rendered.queryClient.removeQueries({ queryKey: queryKeys.memory.detail(ID) });
        return new Promise<Response>((resolve) => setTimeout(() => resolve(fake.fetch(input, init)), 150));
      }) as typeof fetch,
      capabilities: modules(FULL),
    });
    await user.click((await screen.findByText("Kaffeesorte")).closest("button") as HTMLElement);
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("button", { name: /Vergessen/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Endgültig vergessen" }));
    expect(await screen.findByText("Eintrag vergessen")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Daten konnten nicht geladen werden")).toBeNull();
  });

  it("does not offer forgetting for a locked memory", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(baseRoutes(makeMemory({ locked: true })));
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await user.click((await screen.findByText("Kaffeesorte")).closest("button") as HTMLElement);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("button", { name: /Vergessen/ })).toBeDisabled();
    expect(within(drawer).getByRole("button", { name: /Bearbeiten/ })).toBeDisabled();
    expect(within(drawer).getByText(/Gesperrt: Inhalt und Löschen/)).toBeInTheDocument();
  });

  it("validates the create form and posts the new memory", async () => {
    const user = userEvent.setup();
    const created = makeMemory({ id: "mem_01JCCCCCCCCCCCCCCCCCCCCCCC", title: "Neu" });
    const fake = routedFetch({ ...baseRoutes(), "POST /api/v1/memory": () => single(created) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Kaffeesorte");
    await user.click(screen.getAllByRole("button", { name: /Neuer Eintrag/ })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    expect(within(dialog).getByText("Der Inhalt darf nicht leer sein.")).toBeInTheDocument();
    expect(fake.to("POST", "/api/v1/memory")).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/Inhalt/), "Mag keinen Koriander");
    await user.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/memory")).toHaveLength(1));
    expect(fake.to("POST", "/api/v1/memory")[0]?.body).toMatchObject({ type: "fact", content: "Mag keinen Koriander", confidence: 1 });
    expect(fake.to("POST", "/api/v1/memory")[0]?.headers.get("Idempotency-Key")).toBeTruthy();
  });
});

describe("memory: server export", () => {
  const exportDoc = (count: number, omittedRestricted: number) => ({ contractVersion: "1.0.0", exportedAt: "2026-10-14T08:20:00Z", count, omittedRestricted, items: [] });
  const click = vi.fn();
  let created: string[] = [];

  beforeEach(() => {
    created = [];
    click.mockReset();
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(String((blob as Blob).size));
      return "blob:test";
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
  });
  afterEach(() => vi.restoreAllMocks());

  it("downloads the complete export from GET /memory/export and reports omitted restricted entries", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...baseRoutes(), "GET /api/v1/memory/export": exportDoc(40, 2) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Kaffeesorte");
    await user.click(screen.getByRole("button", { name: "Alles exportieren" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(fake.to("GET", "/api/v1/memory/export")).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(await screen.findByText("40 Einträge exportiert")).toBeInTheDocument();
    expect(screen.getByText("2 eingeschränkte Einträge wurden bewusst ausgelassen.")).toBeInTheDocument();
  });

  it("is disabled with the reason without the capability and never calls the API", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...baseRoutes(), "GET /api/v1/memory/export": exportDoc(0, 0) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules({ memory: { ...FULL.memory, export: false } }) });
    await screen.findByText("Kaffeesorte");
    const button = screen.getByRole("button", { name: "Alles exportieren" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("memory.export"));
    await user.click(button);
    expect(fake.to("GET", "/api/v1/memory/export")).toHaveLength(0);
  });

  it("shows an error toast when the export is refused", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...baseRoutes(), "GET /api/v1/memory/export": errorResponse("FORBIDDEN", "Für diese Aktion ist mindestens die Rolle owner erforderlich.", 403) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Kaffeesorte");
    await user.click(screen.getByRole("button", { name: "Alles exportieren" }));
    await waitFor(() => expect(fake.to("GET", "/api/v1/memory/export")).toHaveLength(1));
    expect(click).not.toHaveBeenCalled();
  });
});

describe("memory: conflict resolution", () => {
  const conflicted = () =>
    makeMemory({ conflicts: [{ memoryId: OTHER, reason: "Widerspricht dem Eintrag zum Tee", detectedAt: NOW, resolution: "pending" }] });
  const resolvePath = `/api/v1/memory/${ID}/conflicts/${OTHER}/resolve`;

  async function openConflicts(user: ReturnType<typeof userEvent.setup>) {
    await user.click((await screen.findByText("Kaffeesorte")).closest("button") as HTMLElement);
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("tab", { name: /Konflikte/ }));
    return drawer;
  }

  it("keeps both entries: POST …/resolve with If-Match, Idempotency-Key and the chosen resolution", async () => {
    const user = userEvent.setup();
    const resolved = makeMemory({ conflicts: [{ memoryId: OTHER, reason: "Widerspricht dem Eintrag zum Tee", detectedAt: NOW, resolution: "keep_both" }], version: 4 });
    const fake = routedFetch({ ...baseRoutes(conflicted()), [`POST ${resolvePath}`]: single(resolved) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openConflicts(user);
    await user.click(within(drawer).getByRole("button", { name: /Beide behalten/ }));
    await waitFor(() => expect(fake.to("POST", resolvePath)).toHaveLength(1));
    const call = fake.to("POST", resolvePath)[0];
    expect(call?.body).toEqual({ resolution: "keep_both" });
    expect(call?.headers.get("If-Match")).toBe("3");
    expect(call?.headers.get("Idempotency-Key")).toBeTruthy();
    expect(await screen.findByText("Beide Einträge bleiben bestehen")).toBeInTheDocument();
  });

  it("dismisses a conflict directly", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...baseRoutes(conflicted()), [`POST ${resolvePath}`]: single(makeMemory()) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openConflicts(user);
    await user.click(within(drawer).getByRole("button", { name: "Verwerfen" }));
    await waitFor(() => expect(fake.to("POST", resolvePath)).toHaveLength(1));
    expect(fake.to("POST", resolvePath)[0]?.body).toEqual({ resolution: "dismiss" });
  });

  it("replaces only after an explicit confirmation that says the other entry is forgotten", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...baseRoutes(conflicted()), [`POST ${resolvePath}`]: single(makeMemory()) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openConflicts(user);
    await user.click(within(drawer).getByRole("button", { name: /Diesen behalten, anderen ersetzen/ }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Der widersprechende Eintrag wird vergessen.")).toBeInTheDocument();
    expect(fake.to("POST", resolvePath)).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Ersetzen" }));
    await waitFor(() => expect(fake.to("POST", resolvePath)).toHaveLength(1));
    expect(fake.to("POST", resolvePath)[0]?.body).toEqual({ resolution: "replace" });
  });

  it("offers no actions for resolved conflicts and disables them without the capability", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(baseRoutes(conflicted()));
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules({ memory: { ...FULL.memory, resolveConflict: false } }) });
    const drawer = await openConflicts(user);
    for (const name of [/Beide behalten/, "Verwerfen", /anderen ersetzen/]) expect(within(drawer).getByRole("button", { name })).toBeDisabled();
    expect(within(drawer).getByText(/memory\.resolveConflict fehlt/)).toBeInTheDocument();
  });

  it("does not show actions for an already resolved conflict", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(baseRoutes(makeMemory({ conflicts: [{ memoryId: OTHER, reason: "Gelöst", detectedAt: NOW, resolution: "dismissed" }] })));
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openConflicts(user);
    expect(within(drawer).queryByRole("group", { name: "Konflikt lösen" })).toBeNull();
    expect(within(drawer).getByText(/Verworfen|Dismissed|Erledigt/)).toBeInTheDocument();
  });
});
