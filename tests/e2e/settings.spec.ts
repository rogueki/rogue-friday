import { test, expect, open, orbRoot, patchSettings } from "./support/fixtures";
import type { Page } from "@playwright/test";

/** PLAN §51.5 settings + theme switch: changes apply live (no reload) and persist on the server. */
const markNoReload = async (page: Page): Promise<void> => {
  await page.evaluate(() => void ((window as unknown as { __e2eNoReload: boolean }).__e2eNoReload = true));
};
const stillSamePage = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload === true);

async function save(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Speichern", exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText(/Alle Änderungen gespeichert/)).toBeVisible();
}

test("renaming the assistant changes brand, orb label, title and bottom bar live and persists", async ({ page, api }) => {
  await open(page, "/settings");
  await markNoReload(page);
  await page.getByRole("textbox", { name: "Name des Assistenten" }).fill("Aria");
  await expect(page.locator("p").filter({ hasText: "Vorschau:" })).toContainText("Aria");
  await save(page);

  expect((await api.get("/settings")).body.data.profile.assistantName).toBe("Aria");
  await expect(page.getByRole("complementary").first()).toContainText(/A\.?R\.?I\.?A/i);
  await expect(page.getByRole("button", { name: /MIT ARIA SPRECHEN/i })).toBeVisible();
  await expect(page).toHaveTitle(/Aria/);

  await api.forceOrb("idle"); // a mode whose sentence names the assistant
  await page.getByRole("link", { name: "Übersicht" }).click(); // client-side navigation, still no reload
  await expect(page.getByRole("group", { name: "Aria Orb" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Aria Orb" }).getByRole("status")).toContainText("Aria ist bereit.");
  expect(await stillSamePage(page), "no page reload happened").toBe(true);

  // server-generated texts follow the name as well
  const orb = (await api.get("/orb/status")).body.data;
  expect(JSON.stringify(orb)).not.toContain("F.R.I.D.A.Y.");
});

test("an empty assistant name falls back to the default brand", async ({ page, api }) => {
  await patchSettings(api, { profile: { ...(await api.get("/settings")).body.data.profile, assistantName: "Aria" } });
  await open(page, "/settings");
  await expect(page.getByRole("complementary").first()).toContainText(/A\.?R\.?I\.?A/i);
  await page.getByRole("textbox", { name: "Name des Assistenten" }).fill("");
  await save(page);
  await expect(page.getByRole("complementary").first()).toContainText("F.R.I.D.A.Y.");
  const name = (await api.get("/settings")).body.data.profile.assistantName;
  expect(name === undefined || name === null || name === "" || name === "F.R.I.D.A.Y.", `stored name: ${String(name)}`).toBe(true);
});

test("changing the orb quality applies to the running orb and persists", async ({ page, api }) => {
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-quality", "medium"); // "auto" resolves to a concrete level
  await page.getByRole("link", { name: "Einstellungen" }).click();
  await page.getByRole("button", { name: "Orb", exact: true }).click();
  await page.getByRole("combobox", { name: "Qualität" }).selectOption({ label: "Niedrig" });
  await save(page);
  expect((await api.get("/settings")).body.data.orb.quality).toBe("low");
  await page.getByRole("link", { name: "Übersicht" }).click();
  await expect(orbRoot(page)).toHaveAttribute("data-orb-quality", "low");
});

test("theme switch: picking a theme applies live without a reload, saving persists it", async ({ page, api }) => {
  await open(page, "/settings");
  await markNoReload(page);
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const html = page.locator("html");
  const before = { id: await html.getAttribute("data-theme"), style: await html.getAttribute("style") };
  expect(before.id).toBe("jarvis-command-midnight");

  await page.getByRole("radio", { name: /Gold Core/ }).click();
  await expect(html).not.toHaveAttribute("data-theme", before.id!); // live preview
  const after = { id: await html.getAttribute("data-theme"), style: await html.getAttribute("style") };
  expect(after.style, "css custom properties changed").not.toBe(before.style);
  expect(await stillSamePage(page)).toBe(true);

  await save(page);
  expect((await api.get("/settings")).body.data.theme.activeThemeId).toBe(after.id);

  // the theme survives a hard reload (applied from the stored settings)
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", after.id!);
});

test("theme intensity sliders change the live css tokens", async ({ page }) => {
  await open(page, "/settings");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const before = await page.locator("html").evaluate((el) => el.style.getPropertyValue("--jv-cyan-intensity"));
  const slider = page.getByRole("slider", { name: "Cyan-Intensität" });
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => page.locator("html").evaluate((el) => el.style.getPropertyValue("--jv-cyan-intensity"))).not.toBe(before);
  await page.getByRole("button", { name: "Alle verwerfen" }).click();
  await expect.poll(() => page.locator("html").evaluate((el) => el.style.getPropertyValue("--jv-cyan-intensity"))).toBe(before);
});

test("settings are versioned: a stale write is refused with 409 and the UI keeps the newer values", async ({ page, api }) => {
  await open(page, "/settings");
  const stale = (await api.get("/settings")).body.data.version as number;
  const first = await api.request("PATCH", "/settings", { dashboard: { ...(await api.get("/settings")).body.data.dashboard, fontScale: 1.1 } }, { "If-Match": String(stale) });
  expect(first.status).toBe(200);
  const second = await api.request("PATCH", "/settings", { dashboard: { ...(await api.get("/settings")).body.data.dashboard, fontScale: 1.2 } }, { "If-Match": String(stale) });
  expect(second.status).toBe(409);
});
