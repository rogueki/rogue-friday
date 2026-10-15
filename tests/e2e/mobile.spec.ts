import type { Page } from "@playwright/test";
import { test, expect, freezeDate, patchSettings, eventStreamChip } from "./support/fixtures";

/**
 * PLAN §27.15 / §53 Mobile (390x844): compact orb, command bar prominent, approvals/alerts first, complex tables as
 * cards, navigation as a drawer, no horizontal scrolling. Visual baselines are `mobile-*-linux.png`.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

const MASK = (page: Page) => [eventStreamChip(page), page.getByText(/^Aktualisiert \d/), page.getByRole("region", { name: "Systemmonitor" }), page.getByText("Netzwerk", { exact: true }).locator("..")];

// The orb runs in its static 2D mode (product setting animations: "off") so the baselines are deterministic (see visual.spec.ts).
test.beforeEach(async ({ api }) => {
  const settings = (await api.get("/settings")).body.data;
  await patchSettings(api, { orb: { ...settings.orb, animations: "off", renderMode: "auto" } });
});

async function load(page: Page, path: string): Promise<void> {
  await freezeDate(page);
  await page.goto(path);
  await expect(page.getByRole("main", { name: "Hauptinhalt" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1200);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => {
    const main = document.querySelector("main");
    return { doc: document.documentElement.scrollWidth, view: document.documentElement.clientWidth, main: main ? main.scrollWidth - main.clientWidth : 0 };
  });
  expect(widths.doc, "page is not wider than the viewport").toBeLessThanOrEqual(widths.view);
  expect(widths.main, "main area does not scroll horizontally").toBeLessThanOrEqual(1);
}

/** The command bar is entirely inside the viewport and every control of it is reachable. */
async function expectCommandBar(page: Page): Promise<void> {
  const bar = page.locator(".jv-bottombar");
  const box = await bar.boundingBox();
  expect(box, "command bar rendered").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844.5);
  for (const control of [bar.getByRole("textbox"), bar.getByRole("button", { name: /MIT .* SPRECHEN/ }), bar.getByRole("button", { name: "Stopp" }), bar.getByRole("button", { name: /Pause|Fortsetzen/ })]) {
    await expect(control).toBeVisible();
    const b = await control.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width, "control is not clipped at the right edge").toBeLessThanOrEqual(390.5);
  }
}

const PAGES = [
  ["overview", "/"],
  ["approvals", "/approvals"],
  ["tasks", "/tasks"],
  ["alerts", "/alerts"],
] as const;

for (const [name, path] of PAGES) {
  test.describe(`mobile ${name}`, () => {
    test("fits the phone: no horizontal scroll, command bar prominent and complete", async ({ page }) => {
      await load(page, path);
      await expectNoHorizontalScroll(page);
      await expectCommandBar(page);
    });

    test("complex data is shown as cards, not as tables", async ({ page }) => {
      await load(page, path);
      await expect(page.getByRole("main").locator("table")).toHaveCount(0);
      await expect(page.getByRole("main").locator("[role=table], [role=grid]")).toHaveCount(0);
    });

    test("visual baseline", async ({ page }) => {
      await load(page, path);
      await expect(page).toHaveScreenshot(`mobile-${name}.png`, { mask: MASK(page), timeout: 60_000 });
    });
  });
}

test("overview: compact orb, attention (approvals/alerts) before the detail modules", async ({ page }) => {
  await load(page, "/");
  const cells = await page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top + document.querySelector("main")!.scrollTop, height: b.height };
    };
    return {
      orb: rect(".ov-cell--ai-core-orb"),
      attention: rect(".ov-cell--attention-feed"),
      quick: rect(".ov-cell--quick-commands"),
      agents: rect(".ov-cell--active-agents"),
      core: rect(".ov-cell--core-overview"),
      system: rect(".ov-cell--system-monitor"),
    };
  });
  expect(cells.orb!.height, "orb is compact on a phone").toBeLessThanOrEqual(320);
  expect(cells.attention!.top, "attention directly after the orb").toBeLessThan(cells.quick!.top);
  for (const later of [cells.quick, cells.agents, cells.core, cells.system]) expect(cells.attention!.top).toBeLessThan(later!.top);
  // The attention feed starts inside the first screen (above the command bar), so approvals/alerts are visible without scrolling.
  expect(cells.attention!.top).toBeLessThan(844 - 140);
});

test("overview: an open approval is visible in the attention feed on the first screen", async ({ page }) => {
  await load(page, "/");
  const feed = page.locator(".ov-cell--attention-feed");
  await expect(feed).toBeVisible();
  const box = await feed.boundingBox();
  expect(box!.y).toBeLessThan(844 - 140);
  await expect(feed.getByText(/Freigabe|Überfällige Aufgabe|Warnung/i).first()).toBeVisible();
});

test("navigation is a drawer: hidden by default, opens from the top bar, navigates and closes", async ({ page }) => {
  await load(page, "/");
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeHidden();
  await page.getByRole("button", { name: "Navigation öffnen" }).click();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: /Freigaben/ }).click();
  await expect(page).toHaveURL(/\/approvals\/?$/);
  await expect(nav).toBeHidden();
  await expect(page.getByRole("heading", { name: "Freigaben" }).first()).toBeVisible();
});

test("approvals: cards stay usable, a card opens the decision drawer inside the viewport", async ({ page }) => {
  await load(page, "/approvals");
  const card = page.getByRole("main").getByRole("article").first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "PRÜFEN" }).first().click().catch(async () => card.click());
  const drawer = page.getByRole("dialog").first();
  await expect(drawer).toBeVisible();
  // the drawer slides in; measure once it has settled
  await expect
    .poll(async () => {
      const box = await drawer.boundingBox();
      return box ? Math.round(box.x + box.width) : -1;
    }, { timeout: 10_000 })
    .toBeLessThanOrEqual(391);
  const box = (await drawer.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
});

test("a typed command can be sent from the phone command bar", async ({ page }) => {
  await load(page, "/");
  const input = page.locator(".jv-bottombar").getByRole("textbox");
  await input.fill("Zeige offene Freigaben");
  await expect(input).toHaveValue("Zeige offene Freigaben");
  await expect(page.locator(".jv-bottombar").getByRole("button", { name: "Befehl senden" })).toBeEnabled();
});
