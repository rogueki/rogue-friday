import { test, expect, open } from "./support/fixtures";
import { API_BASE, DEV_PASSWORD, devUser } from "./support/constants";
import type { Page } from "@playwright/test";

/** DASH-04.04/04.05 acceptance: two adapters one after another, draft kept and discarded, restart read-back,
 *  owner writes vs. read-only role, three widths and keyboard-only operation. */

/** Adapter drafts are component-local, so the form's own save button applies them (the global bar stays disabled). */
const adapterPanel = (page: Page) => page.locator("[data-adapter-form]").first();
async function saveAdapter(page: Page): Promise<void> {
  const button = adapterPanel(page).getByRole("button", { name: "Konfiguration speichern" });
  await expect(button).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().includes("/settings/adapters/") && candidate.request().method() === "PATCH"),
    button.click(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
}

const adapterButton = (page: Page, id: string) => page.locator(".st-master__item").filter({ hasText: id }).first();
const latency = (page: Page) => page.getByRole("spinbutton", { name: /Simulierte Latenz/ });

test("two adapters in a row: keeping and discarding the draft, saving and reading back after a reload", async ({ page, api }) => {
  await open(page, "/settings?area=adapters");

  await adapterButton(page, "mock-tasks").click();
  await latency(page).fill("111");
  await expect(page.getByText(/Ungespeicherte Änderungen/).first()).toBeVisible();

  // Leaving for another adapter asks first; "Hier bleiben" keeps the typed value.
  await adapterButton(page, "mock-memory").click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("mock-memory");
  await dialog.getByRole("button", { name: "Hier bleiben" }).click();
  await expect(dialog).toBeHidden();
  await expect(latency(page)).toHaveValue("111");

  // The second attempt discards explicitly and switches.
  await adapterButton(page, "mock-memory").click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Verwerfen und wechseln" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".st-master__item[aria-current='true']")).toContainText("mock-memory");

  await latency(page).fill("333");
  await saveAdapter(page);
  await expect
    .poll(async () => {
      const items = (await api.get("/settings/adapters")).body.items as Array<{ adapterId: string; config: { latencyMs?: number } }>;
      return items.find((item) => item.adapterId === "mock-memory")?.config.latencyMs;
    })
    .toBe(333);

  // The server kept the second adapter only; the discarded draft never arrived.
  const adapters = (await api.get("/settings/adapters")).body.items as Array<{ adapterId: string; config: { latencyMs?: number } }>;
  const byId = Object.fromEntries(adapters.map((item) => [item.adapterId, item.config.latencyMs]));
  expect(byId["mock-memory"]).toBe(333);
  expect(byId["mock-tasks"]).not.toBe(111);

  // A full page load reads the stored value back (the "restart" of the browser session).
  await page.reload();
  await adapterButton(page, "mock-memory").click();
  await expect(latency(page)).toHaveValue("333");
});

test("two skills one after another: only the selected skill's accounts, shared keys named once, keyboard driven", async ({ page }) => {
  await open(page, "/settings?area=skillAccounts");
  const list = page.getByRole("list", { name: "Skills mit Kontenbedarf" });
  await expect(list).toBeVisible();
  const entries = list.getByRole("button");
  expect(await entries.count()).toBeGreaterThanOrEqual(2);

  // Der erste Skill: rechts steht genau sein Name, und die Detailansicht fragt keinen Schluessel erneut ab.
  const firstName = (await entries.nth(0).locator(".sk-workbench__name").innerText()).trim();
  await entries.nth(0).click();
  await expect(page.getByRole("heading", { name: firstName, exact: true })).toBeVisible();
  await expect(list.getByRole("button").nth(0)).toHaveAttribute("aria-pressed", "true");
  const detail = page.locator(".sk-workbench__detail");
  await expect(detail).toBeVisible();
  expect(await detail.locator("input, textarea").count()).toBe(0);

  // Der zweite Skill: die Auswahl wechselt, die Detailansicht nennt den neuen Namen.
  const secondName = (await entries.nth(1).locator(".sk-workbench__name").innerText()).trim();
  await entries.nth(1).click();
  await expect(page.getByRole("heading", { name: secondName, exact: true })).toBeVisible();
  await expect(list.getByRole("button").nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(list.getByRole("button").nth(1)).toHaveAttribute("aria-pressed", "true");

  // Suche und Zustandsfilter schraenken die Liste ein und lassen sich zuruecknehmen.
  const search = page.getByLabel(/Skill suchen/);
  await search.fill("zzz-kein-skill");
  await expect(page.getByText(/Kein Skill passt zur Suche/)).toBeVisible();
  await search.fill("");
  await expect(entries.first()).toBeVisible();

  // Tastatur: Fokus in der Liste, Enter waehlt, Pfeil ab wechselt die Auswahl.
  await entries.nth(0).focus();
  await page.keyboard.press("Enter");
  const pressedAfterEnter = await list.locator('button[aria-pressed="true"]').first().innerText();
  await page.keyboard.press("ArrowDown");
  const pressedAfterArrow = await list.locator('button[aria-pressed="true"]').first().innerText();
  expect(pressedAfterArrow).not.toBe(pressedAfterEnter);

  // Drei Breiten ohne waagerechten Ueberlauf, auch mit der neuen Master-Detail-Ansicht.
  for (const width of [390, 1024, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, "/settings?area=skillAccounts");
    await expect(page.getByRole("list", { name: "Skills mit Kontenbedarf" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow at ${String(width)} px`).toBeLessThanOrEqual(1);
  }
});

test("a read-only role sees the configuration but cannot change or save it", async ({ page }) => {
  const login = await page.request.post(`${API_BASE}/auth/login`, { data: { username: devUser("viewer"), password: DEV_PASSWORD } });
  expect(login.status()).toBe(200);

  await open(page, "/settings?area=profile");
  await expect(page.getByText(/Nur lesend/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Speichern", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Adapter", exact: true }).click();
  await expect(page.getByText("Nur für Eigentümer")).toBeVisible();
});

test("390, 1024 and 1920 px stay inside the viewport and the keyboard drives nav and the draft dialog", async ({ page }) => {
  for (const width of [390, 1024, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, "/settings?area=profile");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow at ${String(width)} px`).toBeLessThanOrEqual(1);
    await expect(page.getByRole("navigation", { name: "Einstellungsbereiche" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Theme", exact: true })).toBeVisible();
  }

  // Keyboard only: type, open the dialog with Enter on a nav button, cancel with Escape.
  await page.setViewportSize({ width: 1024, height: 1000 });
  await open(page, "/settings?area=profile");
  const name = page.getByRole("textbox", { name: "Anzeigename" });
  await name.fill("Tastatur");
  await page.getByRole("button", { name: "Theme", exact: true }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Hier bleiben" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(name).toHaveValue("Tastatur");
});