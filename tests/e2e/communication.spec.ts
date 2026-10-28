import { test, expect, open } from "./support/fixtures";

/** DASH-05.02 acceptance: exactly the six standard navigation entries in order, no SMS, no top-level mail or
 *  messenger form before a channel is chosen, mailbox inside the e-mail channel, messenger step inside a
 *  messenger channel, and no horizontal overflow at the three acceptance widths. */

const rail = (page: import("@playwright/test").Page) => page.locator("ul.com-channels");
const channelButtons = (page: import("@playwright/test").Page) => rail(page).locator("button.com-channel");

test("six standard channel entries, no SMS, and no top forms before choosing a channel", async ({ page }) => {
  await open(page, "/communication");
  await expect(rail(page)).toBeVisible();
  await expect(channelButtons(page).first()).toContainText("Alle Kanäle");

  await expect(channelButtons(page)).toHaveCount(6);
  const titles = await channelButtons(page).locator(".mk-row__title").allInnerTexts();
  expect(titles).toEqual(["Alle Kanäle", "E-Mail Postfach", "Telegram", "WhatsApp", "Telefon", "Discord"]);

  // SMS ist kein Navigationskanal mehr, bleibt aber als konfigurierbarer Kanal erwähnt.
  await expect(rail(page).getByText("SMS", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Weitere Kanäle wie SMS/)).toBeVisible();

  // Vor der Kanalauswahl gibt es weder Postfach noch Messenger-Formular.
  await expect(page.locator("section[aria-label='E-Mail Postfach']")).toHaveCount(0);
  await expect(page.locator("section[aria-label='Nachricht über den gewählten Kanal']")).toHaveCount(0);

  // E-Mail-Kanal: Postfach erscheint an genau dieser Stelle, das Messenger-Formular nicht.
  await channelButtons(page).filter({ hasText: "E-Mail Postfach" }).click();
  const mailbox = page.locator("section[aria-label='E-Mail Postfach']");
  await expect(mailbox).toBeVisible();
  await expect(mailbox.getByRole("heading", { name: "E-Mail Postfach" })).toBeVisible();
  await expect(page.locator("section[aria-label='Nachricht über den gewählten Kanal']")).toHaveCount(0);

  // Messenger-Kanal: geführter Schritt beim Kanal statt globalem Formular.
  await channelButtons(page).filter({ hasText: "Telegram" }).click();
  await expect(page.locator("section[aria-label='Nachricht über den gewählten Kanal']")).toBeVisible();
  await expect(page.locator("section[aria-label='E-Mail Postfach']")).toHaveCount(0);
});

test("the channel rail stays usable at 390, 1024 and 1920 px without horizontal overflow", async ({ page }) => {
  await open(page, "/communication");
  await expect(rail(page)).toBeVisible();
  for (const width of [390, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(rail(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});