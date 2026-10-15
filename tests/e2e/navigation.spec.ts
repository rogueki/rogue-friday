import { test, expect, open } from "./support/fixtures";

/** PLAN §51.5 Navigation, §26 (16 pages), §43.1 (palette, shortcuts), §44.6 (/dev/scenarios). */
const PAGES = [
  ["Übersicht", "/"],
  ["Aufgaben", "/tasks"],
  ["Live-Aktivität", "/activity"],
  ["Gedächtnis", "/memory"],
  ["Agenten", "/agents"],
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

test("all 16 menu entries are reachable by click and mark the current page", async ({ page }) => {
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
  for (const [label, route] of PAGES) {
    await open(page, route);
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
