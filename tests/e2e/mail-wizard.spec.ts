import { test, expect, open } from "./support/fixtures";
import type { Page } from "@playwright/test";

/** DASH-05.03 acceptance: guided mailbox setup with real steps, recognized but editable servers, no guessing,
 *  separate connection tests and an honest state when the environment has no mail bridge. */

const wizard = (page: Page) => page.locator("section.st-wizard").first();

async function openWizard(page: Page): Promise<void> {
  await open(page, "/settings?area=skillAccounts");
  const section = page.getByRole("region", { name: "Mail Postfach Konten" });
  await section.scrollIntoViewIfNeeded();
  await expect(wizard(page).getByRole("heading", { name: "Neues Postfach einrichten" })).toBeVisible();
}

async function fillNames(page: Page): Promise<void> {
  await wizard(page).getByLabel("Kontoname").fill("Geschaeftliches Postfach");
  await wizard(page).getByLabel("Absendername").fill("Erik Brandt");
}

test("wizard starts at the address step, keeps unknown domains empty and never guesses a server", async ({ page }) => {
  await openWizard(page);
  const steps = wizard(page).locator(".st-wizard__steps li");
  await expect(steps).toHaveCount(7);
  await expect(steps.nth(0)).toHaveAttribute("aria-current", "step");
  await expect(wizard(page).getByText("Schritt 1 von 7: Adresse")).toBeVisible();

  await wizard(page).getByLabel("E-Mail-Adresse").fill("erik@beispiel.example");
  await expect(wizard(page).getByText(/Kein Vorschlag für diese Domain/)).toBeVisible();
  await wizard(page).getByRole("button", { name: "Weiter" }).click();

  await fillNames(page);
  await wizard(page).getByRole("button", { name: "Weiter" }).click();

  await expect(wizard(page).getByText("Schritt 3 von 7: Server")).toBeVisible();
  await expect(wizard(page).getByLabel("IMAP-Server")).toHaveValue("");
  await expect(wizard(page).getByLabel("SMTP-Server")).toHaveValue("");
  await expect(wizard(page).getByText(/Host und Port müssen gültig sein/)).toBeVisible();
  await expect(wizard(page).getByRole("button", { name: "Weiter" })).toBeDisabled();

  await wizard(page).getByRole("button", { name: "Zurück" }).click();
  await wizard(page).getByRole("button", { name: "Zurück" }).click();
  await wizard(page).getByLabel("E-Mail-Adresse").fill("erik@gmx.de");
  await expect(wizard(page).getByText(/Erkannt: GMX/)).toBeVisible();
  await wizard(page).getByRole("button", { name: "Weiter" }).click();
  await wizard(page).getByRole("button", { name: "Weiter" }).click();
  await expect(wizard(page).getByLabel("IMAP-Server")).toHaveValue("imap.gmx.net");
  await expect(wizard(page).getByLabel("SMTP-Port")).toHaveValue("587");
  await wizard(page).getByLabel("IMAP-Server").fill("imap.mein-anbieter.example");
  await expect(wizard(page).getByLabel("IMAP-Server")).toHaveValue("imap.mein-anbieter.example");
});

test("connection tests stay separate and the missing mail bridge is reported instead of faked", async ({ page }) => {
  await openWizard(page);
  await wizard(page).getByLabel("E-Mail-Adresse").fill("erik@gmx.de");
  await wizard(page).getByRole("button", { name: "Weiter" }).click();
  await fillNames(page);
  await wizard(page).getByRole("button", { name: "Weiter" }).click();
  await wizard(page).getByRole("button", { name: "Weiter" }).click();
  await wizard(page).getByLabel("Passwort / App-Passwort").fill("synthetisches-testpasswort");
  await wizard(page).getByRole("button", { name: "Weiter" }).click();
  await expect(wizard(page).getByText("Schritt 5 von 7: Verbindungen prüfen")).toBeVisible();
  await expect(wizard(page).getByRole("button", { name: "Weiter" })).toBeDisabled();

  const imapCheck = wizard(page).getByRole("button", { name: "IMAP-Verbindung prüfen" });
  const imapResponse = page.waitForResponse((response) => response.url().includes("/settings/mail-connection-test"));
  await imapCheck.click();
  const imap = await imapResponse;
  expect(imap.request().method()).toBe("POST");
  expect([200, 503]).toContain(imap.status());
  const payload = imap.request().postDataJSON() as { protocol: string; host: string; port: number; security: string };
  expect(payload).toMatchObject({ protocol: "imap", host: "imap.gmx.net", port: 993, security: "tls" });
  await expect(wizard(page).getByText(/nur in der installierten F\.R\.I\.D\.A\.Y\.-Umgebung verfügbar/)).toBeVisible();

  await wizard(page).getByRole("button", { name: "SMTP-Verbindung prüfen" }).click();
  await expect(wizard(page).getByText(/nur in der installierten F\.R\.I\.D\.A\.Y\.-Umgebung verfügbar/)).toHaveCount(2);
  await expect(wizard(page).getByRole("button", { name: "Weiter" })).toBeDisabled();

  await wizard(page).getByLabel(/Ohne Prüfung fortfahren/).check();
  await expect(wizard(page).getByRole("button", { name: "Weiter" })).toBeEnabled();
  await wizard(page).getByRole("button", { name: "Weiter" }).click();
  await expect(wizard(page).getByText("Schritt 6 von 7: Ordner")).toBeVisible();
  await expect(wizard(page).getByLabel("Gesendet-Ordner")).toHaveValue("Sent");

  for (const width of [390, 1024, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `Breite ${width}`).toBeLessThanOrEqual(1);
  }
});