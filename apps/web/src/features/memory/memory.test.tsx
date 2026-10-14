import type { Memory } from "@jarvis/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
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

  it("shows 'Nicht verbunden' with an adapter shortcut when the adapter is down", async () => {
    const fake = routedFetch({ "GET /api/v1/memory": errorResponse("ADAPTER_UNAVAILABLE", "Gedächtnis-Adapter nicht erreichbar", 503) });
    renderWithProviders(<MemoryPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.getByText("Gedächtnis-Adapter nicht erreichbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Adapter konfigurieren/ })).toBeInTheDocument();
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
