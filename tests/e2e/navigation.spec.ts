import { test, expect, open } from "./support/fixtures";

/** PLAN §51.5 Navigation, §26, §43.1 (palette, shortcuts), §44.6 (/dev/scenarios). */
const PAGES = [
  ["Übersicht", "/"],
  ["Aufgaben", "/tasks"],
  ["Live-Aktivität", "/activity"],
  ["Gedächtnis", "/memory"],
  ["Agenten", "/agents"],
  ["Skills", "/skills"],
  ["Freigaben", "/approvals"],
  ["Mail & Kommunikation", "/communication"],
  ["Kalender", "/calendar"],
  ["Automationen", "/automations"],
  ["Recherche", "/research"],
  ["Dateien & Dokumente", "/files"],
  ["Sprache", "/voice"],
  ["Meldungen & Alarme", "/alerts"],
  ["System", "/system"],
  ["Audit & Verlauf", "/audit"],
  ["Einstellungen", "/settings"],
] as const;

test("all menu entries are reachable by click and mark the current page", async ({ page }) => {
  await open(page, "/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("link")).toHaveCount(PAGES.length);
  for (const [label, route] of PAGES) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL((url) => url.pathname.replace(/\/$/, "") === route.replace(/\/$/, ""));
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("main", { name: "Hauptinhalt" }).getByRole("heading").first()).toBeVisible();
  }
});

test("every route also loads directly (static export + SPA fallback)", async ({ page }) => {
  test.setTimeout(180_000); // 17 full document loads on the CI software renderer.
  for (const [label, route] of PAGES) {
    await page.goto(route);
    await expect(page.getByRole("main", { name: "Hauptinhalt" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  }
});

test("the scenario console /dev/scenarios is reachable by URL and from the command palette", async ({ page }) => {
  await open(page, "/dev/scenarios");
  await expect(page.getByRole("heading", { name: "Szenario-Konsole", level: 1 })).toBeVisible();

  await open(page, "/");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Befehlspalette" });
  await palette.getByRole("combobox").fill("Szenario");
  await palette.getByRole("option", { name: /Szenario-Konsole öffnen/ }).click();
  await expect(page).toHaveURL(/\/dev\/scenarios\/?$/);
  await expect(page.getByRole("heading", { name: "Szenario-Konsole", level: 1 })).toBeVisible();
});

test("Ctrl+K opens the command palette, filters, navigates with Enter and closes with Escape", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Befehlspalette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();

  await palette.getByRole("combobox").fill("Gehe zu Kalender");
  await expect(palette.getByRole("option", { name: "Gehe zu Kalender", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/calendar\/?$/);
  await expect(palette).toBeHidden();

  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test('the "/" shortcut opens the palette, but not while typing in a field', async ({ page }) => {
  await open(page, "/tasks");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  const palette = page.getByRole("dialog", { name: "Befehlspalette" });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  const search = page.getByRole("searchbox", { name: "Aufgaben suchen" });
  await search.click();
  await page.keyboard.type("a/b");
  await expect(search).toHaveValue("a/b");
  await expect(palette).toBeHidden();
});

test("an unknown address shows the not-found page with status 404 instead of the overview", async ({ page, request }) => {
  for (const path of ["/gibt-es-nicht", "/tasks/unbekannt", "/a/b/c"]) {
    const response = await request.get(path);
    expect(response.status(), `HTTP status of ${path}`).toBe(404);
    expect(response.headers()["content-type"]).toContain("text/html");
  }
  await page.goto("/gibt-es-nicht");
  await expect(page.getByText("Seite nicht gefunden")).toBeVisible();
  await expect(page.getByText("Diese Adresse gehört zu keinem Modul des Command Centers.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toHaveCount(0); // not the overview shell
  await page.getByRole("button", { name: "Zur Übersicht" }).click();
  await expect(page.getByRole("main", { name: "Hauptinhalt" })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/");
});

test("known routes and query-parameter detail views keep answering 200", async ({ request }) => {
  for (const path of ["/", "/tasks", "/tasks/", "/approvals", "/dev/scenarios", "/tasks?task=task_unbekannt", "/settings?area=theme"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});
