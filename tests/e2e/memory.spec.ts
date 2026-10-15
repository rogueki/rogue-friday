import { readFile } from "node:fs/promises";
import { test, expect, open } from "./support/fixtures";
import type { ApiClient } from "./support/api";
import type { Locator, Page } from "@playwright/test";

/**
 * PLAN §30 Memory, §51.5: semantic search, type filter, detail, edit with If-Match and version bump, pin/lock,
 * forget with confirmation and audit trail, conflict resolution and an export without restricted entries.
 * Every UI action is verified against the Control API.
 */
interface Memory {
  id: string;
  version: number;
  type: string;
  title?: string | null;
  content: string;
  sensitivity: string;
  pinned: boolean;
  locked: boolean;
  tags: string[];
  confirmedAt: string | null;
  conflicts: Array<{ memoryId: string; resolution: string; reason: string }>;
  history: Array<{ version: number; change: string; summary: string; before: string | null; after: string | null }>;
}

const EDITABLE = "Dateiablage"; // seed: preference, v2, neither pinned nor locked
const CONFLICT_A = "Zahlungsziel Becker & Söhne (Vertrag)"; // seed: pending conflict with "Zahlungsziel Becker & Söhne"
const CONFLICT_B = "Zahlungsziel Becker & Söhne";

async function allMemories(api: ApiClient): Promise<Memory[]> {
  return (await api.get("/memory?limit=200")).body.items as Memory[];
}
async function memoryByTitle(api: ApiClient, title: string): Promise<Memory> {
  const found = (await allMemories(api)).find((memory) => memory.title === title);
  if (!found) throw new Error(`Gedächtniseintrag nicht gefunden: ${title}`);
  return found;
}
const getMemory = async (api: ApiClient, id: string): Promise<Memory> => (await api.get(`/memory/${id}`)).body.data as Memory;

const row = (page: Page, id: string): Locator => page.locator(`[data-memory-id="${id}"]`);
const list = (page: Page): Locator => page.getByRole("list", { name: "Einträge" });

/** Opens the page with the drawer of one memory (deep link `?memory=`, the same URL a row click produces). */
async function openDetail(page: Page, memory: Memory): Promise<Locator> {
  await open(page, "/memory");
  await row(page, memory.id).click();
  const drawer = page.getByRole("dialog", { name: memory.title ?? memory.content });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`memory=${memory.id}`));
  return drawer;
}

test("semantic search ranks the relevant entries first and sends a semantic search request", async ({ page, api }) => {
  await open(page, "/memory");
  await expect(page.getByRole("switch", { name: "Semantische Suche" })).toBeChecked();
  const request = page.waitForRequest((candidate) => candidate.url().endsWith("/memory/search") && candidate.method() === "POST");
  await page.getByRole("searchbox", { name: "Gedächtnis durchsuchen" }).fill("Zahlungsziel Rechnung");
  const sent = (await request).postDataJSON() as { query: string; semantic: boolean };
  expect(sent).toMatchObject({ query: "Zahlungsziel Rechnung", semantic: true });

  const hits = (await api.post("/memory/search", { query: "Zahlungsziel Rechnung", semantic: true, limit: 50 })).body.items as Array<{ score: number; memory: Memory }>;
  expect(hits.length).toBeGreaterThan(2);
  const titles = hits.map((hit) => hit.memory.title);
  expect(titles.slice(0, 3), "the payment-term and invoice entries are the best matches").toEqual(expect.arrayContaining([CONFLICT_A, CONFLICT_B, "Rechnungen vor Zahlung prüfen"]));

  await expect(page.getByRole("heading", { name: "Suchergebnisse" })).toBeVisible();
  const first = list(page).getByRole("listitem").first();
  await expect(first).toContainText(titles[0]!);
  await expect(first).toContainText(/Relevanz \d+ %/);
  await expect(list(page).getByRole("listitem")).toHaveCount(hits.length);

  // keyword mode (switch off): plain text search that the server answers with GET /memory?q=; nothing found -> empty state
  await page.getByRole("switch", { name: "Semantische Suche" }).click();
  await expect(page.getByRole("searchbox", { name: "Gedächtnis durchsuchen" })).toHaveAttribute("placeholder", "Stichwortsuche im Gedächtnis …");
  await expect(page.getByRole("heading", { name: "Einträge" })).toBeVisible();
  const keyword = (await api.get("/memory?q=Zahlungsziel&limit=200")).body.items as Memory[];
  expect(keyword.length).toBeGreaterThan(0);
  await page.getByRole("searchbox", { name: "Gedächtnis durchsuchen" }).fill("Zahlungsziel");
  await expect(list(page).getByRole("listitem")).toHaveCount(keyword.length);
  await page.getByRole("searchbox", { name: "Gedächtnis durchsuchen" }).fill("qqqq-nichts-dergleichen");
  await expect(page.getByText("Keine Treffer").first()).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(0);
});

test("the type filter narrows the list to exactly the server's matches and can be removed again", async ({ page, api }) => {
  const total = (await allMemories(api)).length;
  const persons = (await api.get("/memory?type=person&limit=200")).body.items as Memory[];
  expect(persons.length).toBeGreaterThan(1);
  expect(persons.length).toBeLessThan(total);
  await open(page, "/memory");
  await expect(list(page).getByRole("listitem")).toHaveCount(total);

  await page.getByRole("combobox", { name: "Typ" }).selectOption({ label: "Person" });
  await expect(list(page).getByRole("listitem")).toHaveCount(persons.length);
  for (const person of persons) await expect(row(page, person.id)).toBeVisible();
  await expect(page.getByRole("group", { name: "Kennzahlen der Anzeige" })).toContainText(`${persons.length} angezeigt`);

  await page.getByRole("combobox", { name: "Typ" }).selectOption({ label: "Alle Typen" });
  await expect(list(page).getByRole("listitem")).toHaveCount(total);

  // marking filter: pinned only
  await page.getByRole("combobox", { name: "Markierung" }).selectOption({ label: "Nur angeheftete" });
  const pinned = (await allMemories(api)).filter((memory) => memory.pinned);
  await expect(list(page).getByRole("listitem")).toHaveCount(pinned.length);
});

test("the detail drawer shows content, source, confidence, tags, provenance, history and conflicts", async ({ page, api }) => {
  const memory = await memoryByTitle(api, CONFLICT_A);
  const drawer = await openDetail(page, memory);
  await expect(drawer.getByText(memory.content)).toBeVisible();
  for (const label of ["Typ", "Quelle", "Konfidenz", "Erstellt", "Zuletzt bestätigt", "Ablauf", "Tags", "Verknüpfte Entitäten", "Sensibilität", "Schutz"]) {
    await expect(drawer.getByText(label, { exact: true }).first()).toBeVisible();
  }
  const tabs = drawer.getByRole("tablist", { name: "Bereiche des Eintrags" });
  await tabs.getByRole("tab", { name: /^Herkunft/ }).click();
  await expect(drawer.getByText("Nutzung", { exact: true })).toBeVisible();
  await tabs.getByRole("tab", { name: /^Verlauf/ }).click();
  await expect(drawer.getByRole("list", { name: "Verlauf" })).toContainText(memory.history[0]!.summary);
  await tabs.getByRole("tab", { name: /^Konflikte/ }).click();
  await expect(drawer).toContainText(memory.conflicts[0]!.reason);
});

test("edit sends If-Match with the seen version, the version bumps and the history records before/after", async ({ page, api }) => {
  const memory = await memoryByTitle(api, EDITABLE);
  expect(memory.locked).toBe(false);
  const drawer = await openDetail(page, memory);

  await drawer.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog", { name: "Eintrag bearbeiten" });
  const content = dialog.getByLabel(/^Inhalt/);
  await expect(content).toHaveValue(memory.content);
  const updated = `${memory.content} Ergänzung: Scans zusätzlich in PDF/A.`;
  await content.fill(updated);
  await dialog.getByLabel("Tags").fill([...memory.tags, "e2e-geprüft"].join(", "));
  const patch = page.waitForRequest((request) => request.url().endsWith(`/memory/${memory.id}`) && request.method() === "PATCH");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  const request = await patch;
  expect((await request.allHeaders())["if-match"]).toBe(String(memory.version));
  expect(request.postDataJSON()).toEqual({ content: updated, tags: [...memory.tags, "e2e-geprüft"] }); // only changed fields
  await expect(dialog).toBeHidden();

  await expect(drawer.getByText(updated)).toBeVisible();
  await expect(drawer.getByText("#e2e-geprüft")).toBeVisible();
  const after = await getMemory(api, memory.id);
  expect(after.version).toBe(memory.version + 1);
  expect(after.content).toBe(updated);
  expect(after.tags).toContain("e2e-geprüft");

  await drawer.getByRole("tab", { name: /^Verlauf/ }).click();
  const entry = drawer.getByRole("list", { name: "Verlauf" }).getByRole("listitem").first();
  await expect(entry).toContainText(`v${after.version}`);
  await expect(entry).toContainText(`− ${memory.content}`);
  await expect(entry).toContainText(`+ ${updated}`);
});

test("editing validates the form; a stale version is refused by the API and never overwrites the newer entry", async ({ page, api }) => {
  const memory = await memoryByTitle(api, EDITABLE);
  const drawer = await openDetail(page, memory);
  await drawer.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog", { name: "Eintrag bearbeiten" });

  // validation: empty content never reaches the server
  await dialog.getByLabel(/^Inhalt/).fill("   ");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog.getByText("Der Inhalt darf nicht leer sein.")).toBeVisible();
  await dialog.getByLabel(/^Inhalt/).fill(memory.content);
  await dialog.getByLabel(/^Konfidenz/).fill("140");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog.getByText("Bitte einen Wert zwischen 0 und 100 eingeben.")).toBeVisible();
  expect((await getMemory(api, memory.id)).version, "nothing was sent").toBe(memory.version);
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();

  // optimistic concurrency on the wire: the right version wins, the same (now stale) version is refused
  const first = await api.patch(`/memory/${memory.id}`, { content: "Erster Stand." }, { "If-Match": String(memory.version) });
  expect(first.status).toBe(200);
  const stale = await api.patch(`/memory/${memory.id}`, { content: "Überschreibt blind." }, { "If-Match": String(memory.version) });
  expect([409, 412], "stale If-Match is a conflict").toContain(stale.status);
  const after = await getMemory(api, memory.id);
  expect(after.content).toBe("Erster Stand.");
  expect(after.version).toBe(memory.version + 1);
});

test("pin and lock: both flags are stored, a locked entry cannot be edited or forgotten until it is unlocked", async ({ page, api }) => {
  const memory = await memoryByTitle(api, EDITABLE);
  const drawer = await openDetail(page, memory);
  const actions = drawer.getByRole("group", { name: "Aktionen für diesen Eintrag" });

  await actions.getByRole("button", { name: "Anheften" }).click();
  await expect(actions.getByRole("button", { name: "Lösen" })).toBeVisible();
  await expect.poll(async () => (await getMemory(api, memory.id)).pinned).toBe(true);
  await expect(row(page, memory.id).getByLabel("Angeheftet")).toBeVisible();

  const patch = page.waitForRequest((request) => request.url().endsWith(`/memory/${memory.id}`) && request.method() === "PATCH");
  await actions.getByRole("button", { name: "Sperren" }).click();
  expect((await (await patch).allHeaders())["if-match"], "pin bumped the version once").toBe(String(memory.version + 1));
  await expect(actions.getByRole("button", { name: "Entsperren" })).toBeVisible();
  await expect.poll(async () => (await getMemory(api, memory.id)).locked).toBe(true);
  await expect(drawer.getByText(/^Gesperrt: Inhalt und Löschen sind gegen/)).toBeVisible();
  await expect(actions.getByRole("button", { name: "Bearbeiten" })).toBeDisabled();
  await expect(actions.getByRole("button", { name: "Vergessen" })).toBeDisabled();
  await expect(row(page, memory.id).getByLabel("Gesperrt")).toBeVisible();

  // the server enforces the lock as well
  const refused = await api.patch(`/memory/${memory.id}`, { content: "heimlich geändert" }, { "If-Match": String((await getMemory(api, memory.id)).version) });
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(refused.status).toBeLessThan(500);
  expect((await getMemory(api, memory.id)).content).toBe(memory.content);

  await actions.getByRole("button", { name: "Entsperren" }).click();
  await expect(actions.getByRole("button", { name: "Bearbeiten" })).toBeEnabled();
  await expect.poll(async () => (await getMemory(api, memory.id)).locked).toBe(false);
  await actions.getByRole("button", { name: "Lösen" }).click();
  await expect.poll(async () => (await getMemory(api, memory.id)).pinned).toBe(false);
  expect((await getMemory(api, memory.id)).version).toBe(memory.version + 4);
});

test("forget needs a confirmation, removes the entry from list and API and leaves an audit entry", async ({ page, api }) => {
  const memory = await memoryByTitle(api, EDITABLE);
  const total = (await allMemories(api)).length;
  const drawer = await openDetail(page, memory);
  await drawer.getByRole("button", { name: "Vergessen" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Eintrag vergessen?" });
  await expect(confirm).toContainText(`„${memory.title}“`);
  await expect(confirm).toContainText("Die Löschung wird nachvollziehbar im Audit-Protokoll festgehalten.");

  await confirm.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirm).toBeHidden();
  expect((await api.get(`/memory/${memory.id}`)).status, "still there after cancel").toBe(200);

  await drawer.getByRole("button", { name: "Vergessen" }).click();
  const request = page.waitForRequest((candidate) => candidate.url().endsWith(`/memory/${memory.id}`) && candidate.method() === "DELETE");
  await page.getByRole("alertdialog", { name: "Eintrag vergessen?" }).getByRole("button", { name: "Endgültig vergessen" }).click();
  expect((await (await request).allHeaders())["if-match"]).toBe(String(memory.version));
  await expect(page.getByText("Eintrag vergessen", { exact: true })).toBeVisible();
  await expect(drawer).toBeHidden();
  await expect(row(page, memory.id)).toHaveCount(0);
  await expect(list(page).getByRole("listitem")).toHaveCount(total - 1);

  expect((await api.get(`/memory/${memory.id}`)).status).toBe(404);
  expect((await allMemories(api)).map((entry) => entry.id)).not.toContain(memory.id);
  const audit = ((await api.get("/audit/events?limit=200")).body.items as Array<{ action: string; before: { title?: string } | null; after: unknown }>).filter((event) => event.action === "memory.deleted");
  expect(audit, "exactly one deletion audited").toHaveLength(1);
  expect(audit[0]!.before, "audit keeps what was forgotten (type/title, not the content)").toMatchObject({ title: memory.title });
  expect(audit[0]!.after).toBeNull();
  expect(JSON.stringify(audit)).not.toContain(memory.content);

  // the toast leads to the audit page, where the entry is listed
  await page.getByRole("button", { name: "Audit öffnen" }).click();
  await expect(page).toHaveURL(/\/audit\/?$/);
  await expect(page.getByText("memory.deleted").first()).toBeVisible();
});

test("conflict: the pending conflict is flagged, 'replace' asks first and then forgets the contradicting entry", async ({ page, api }) => {
  const keep = await memoryByTitle(api, CONFLICT_A);
  const other = await memoryByTitle(api, CONFLICT_B);
  expect(keep.conflicts[0]).toMatchObject({ memoryId: other.id, resolution: "pending" });

  await open(page, "/memory");
  await expect(row(page, keep.id).getByText("Konflikt", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Markierung" }).selectOption({ label: "Mit Konflikt" });
  await expect(list(page).getByRole("listitem")).toHaveCount((await allMemories(api)).filter((memory) => memory.conflicts.some((conflict) => conflict.resolution === "pending")).length);

  await row(page, keep.id).click();
  const drawer = page.getByRole("dialog", { name: keep.title! });
  await drawer.getByRole("tab", { name: /^Konflikte/ }).click();
  await expect(drawer).toContainText(keep.conflicts[0]!.reason);
  await drawer.getByRole("button", { name: "Diesen behalten, anderen ersetzen …" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Widersprechenden Eintrag ersetzen?" });
  await expect(confirm).toContainText("Der widersprechende Eintrag wird vergessen.");
  await confirm.getByRole("button", { name: "Abbrechen" }).click();
  expect((await getMemory(api, keep.id)).conflicts[0]!.resolution, "cancel changes nothing").toBe("pending");

  await drawer.getByRole("button", { name: "Diesen behalten, anderen ersetzen …" }).click();
  await page.getByRole("alertdialog", { name: "Widersprechenden Eintrag ersetzen?" }).getByRole("button", { name: "Ersetzen" }).click();
  await expect(page.getByText("Der widersprechende Eintrag wurde ersetzt").first()).toBeVisible();

  await expect.poll(async () => (await getMemory(api, keep.id)).conflicts[0]?.resolution).toBe("replaced");
  expect((await api.get(`/memory/${other.id}`)).status, "the contradicting entry is gone").toBe(404);
  const audit = ((await api.get("/audit/events?limit=200")).body.items as Array<{ action: string }>).map((event) => event.action);
  expect(audit).toContain("memory.conflict_resolved");
  await expect(drawer.getByText("Ersetzt").first()).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Diesen behalten, anderen ersetzen …" })).toHaveCount(0);
});

test("conflict: dismissing keeps both entries and closes the conflict", async ({ page, api }) => {
  const keep = await memoryByTitle(api, CONFLICT_A);
  const other = await memoryByTitle(api, CONFLICT_B);
  const drawer = await openDetail(page, keep);
  await drawer.getByRole("tab", { name: /^Konflikte/ }).click();
  await drawer.getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByText("Konflikt verworfen").first()).toBeVisible();
  await expect.poll(async () => (await getMemory(api, keep.id)).conflicts[0]?.resolution).toBe("dismissed");
  expect((await api.get(`/memory/${other.id}`)).status, "dismiss never deletes").toBe(200);
  await expect(row(page, keep.id).getByText("Konflikt", { exact: true })).toHaveCount(0);
});

test("export downloads the shared inventory as JSON without restricted entries", async ({ page, api }) => {
  const everything = await allMemories(api);
  const restricted = everything.filter((memory) => memory.sensitivity === "restricted");
  expect(restricted.length, "seed has restricted entries").toBeGreaterThan(0);

  await open(page, "/memory");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Alles exportieren" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^gedaechtnis-\d{8}-\d{4}\.json$/);
  const text = await readFile((await file.path())!, "utf8");
  const document = JSON.parse(text) as { count: number; omittedRestricted: number; items: Memory[] };

  expect(document.items.length).toBe(document.count);
  expect(document.omittedRestricted).toBe(restricted.length);
  expect(document.count).toBe(everything.length - restricted.length);
  expect(document.items.every((memory) => memory.sensitivity !== "restricted")).toBe(true);
  for (const memory of restricted) {
    expect(text, `restricted id ${memory.id} not exported`).not.toContain(memory.id);
    expect(text, `restricted content of "${memory.title}" not exported`).not.toContain(memory.content);
  }
  // no credentials or session material travels in the file
  expect(text).not.toMatch(/"(password|passwort|token|secret|apiKey|api_key|authorization)"\s*:/i);
  expect(text).not.toMatch(/\bDE\d{2}(?:\s?\d{4}){4}\s?\d{2}\b/); // IBAN-like

  await expect(page.getByText(`${document.count} Einträge exportiert`)).toBeVisible();
  await expect(page.getByText(`${restricted.length} eingeschränkte Einträge wurden bewusst ausgelassen.`)).toBeVisible();
  // the server's own export agrees with the downloaded file
  const server = (await api.get("/memory/export")).body as { count: number; omittedRestricted: number };
  expect(server).toMatchObject({ count: document.count, omittedRestricted: document.omittedRestricted });
});

test("without the memory.export capability the export button is disabled and says why", async ({ page, api }) => {
  expect((await api.control({ action: "capability_toggle", module: "memory", capability: "export", enabled: false })).status).toBe(200);
  await open(page, "/memory");
  const button = page.getByRole("button", { name: "Alles exportieren" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", /Capability memory\.export fehlt/);
});
