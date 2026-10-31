import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, open } from "./support/fixtures";

/**
 * LG-5.06: switching the voice mode and the conversation mode in Settings → Sprache. The mock world has no voice service,
 * so the voice status gains `voiceMode` and the mode-switch call (Windows only, opens the installer) is answered here.
 */
type VoiceMode = "local" | "elevenlabs";

async function serveVoiceMode(page: Page, current: { mode: VoiceMode; keyConfigured?: boolean }): Promise<string[]> {
  const targets: string[] = [];
  await page.route("**/api/v1/voice/status", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: Record<string, unknown> & { conversation?: Record<string, unknown> } };
    const conversation = current.keyConfigured === undefined ? body.data.conversation
      : { ...body.data.conversation, keyConfigured: current.keyConfigured };
    await route.fulfill({ response, json: { ...body, data: { ...body.data, voiceMode: current.mode, conversation } } });
  });
  await page.route("**/api/v1/voice/mode-switch", async (route) => {
    targets.push((route.request().postDataJSON() as { target: string }).target);
    await route.fulfill({ status: 200, json: { data: { status: "queued", message: "Das Installationsfenster öffnet sich am PC." } } });
  });
  return targets;
}

async function openVoiceArea(page: Page): Promise<void> {
  await open(page, "/settings");
  await page.getByRole("navigation", { name: "Einstellungsbereiche" }).getByRole("button", { name: "Sprache", exact: true }).click();
}

async function expectNoAxeViolations(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`), `axe violations on ${surface}`).toEqual([]);
}

test("the voice mode switch asks first, opens the installer and reports the finished change", async ({ page }) => {
  const current: { mode: VoiceMode } = { mode: "local" };
  const targets = await serveVoiceMode(page, current);
  await openVoiceArea(page);
  await expect(page.getByText(/^Aktuell: Lokal/)).toBeVisible();

  await page.getByRole("button", { name: "Zu ElevenLabs wechseln" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Administratorrechten");
  await expectNoAxeViolations(page, "voice mode confirmation");
  expect(targets).toEqual([]);
  await dialog.getByRole("button", { name: "Installer öffnen" }).click();
  await expect(dialog).toBeHidden();
  expect(targets).toEqual(["elevenlabs"]);
  await expect(page.getByText(/Windows-Abfrage bestätigen/)).toBeVisible();

  // The installer finished: the voice service reports the new mode on the next status poll (every 10 s).
  current.mode = "elevenlabs";
  await expect(page.getByText("Wechsel abgeschlossen.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Aktuell: ElevenLabs/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Zu lokaler Stimme wechseln" })).toBeEnabled();
});

test("cancelling the confirmation opens no installer", async ({ page }) => {
  const targets = await serveVoiceMode(page, { mode: "elevenlabs" });
  await openVoiceArea(page);
  await page.getByRole("button", { name: "Zu lokaler Stimme wechseln" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("mindestens 6 GB");
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
  expect(targets).toEqual([]);
});

test("Qwen Audio without a key asks for the key and keeps the local conversation", async ({ page }) => {
  await serveVoiceMode(page, { mode: "local", keyConfigured: false });
  await openVoiceArea(page);
  const conversation = page.getByRole("combobox", { name: "Gespräch" });
  await conversation.selectOption("qwen");
  await expect(page.getByText(/fehlt der Alibaba-Token-Plan-Schlüssel/)).toBeVisible();
  await expect(conversation).toHaveValue("local");
  await expect(page.getByRole("textbox", { name: "Alibaba-Token-Plan-Schlüssel" })).toBeVisible();
});

test("the conversation mode needs consent before Qwen Audio is saved", async ({ page }) => {
  await serveVoiceMode(page, { mode: "local", keyConfigured: true });
  await openVoiceArea(page);
  const conversation = page.getByRole("combobox", { name: "Gespräch" });
  await expect(conversation).toHaveValue("local");
  await conversation.selectOption("qwen");
  await expect(page.getByText(/Zustimmung zur Datenübertragung an Alibaba Cloud nötig/)).toBeVisible();
  await expect(conversation).toHaveValue("local");
  await page.getByRole("checkbox", { name: /Ich stimme zu: Für das Live-Gespräch/ }).check();
  await conversation.selectOption("qwen");
  await expect(conversation).toHaveValue("qwen");
  // A voice service that reports no lastError must not produce "Qwen Audio: undefined".
  await expect(page.getByRole("status").filter({ hasText: /Qwen Audio/ }).first()).toBeVisible();
  await expect(page.getByText(/undefined/)).toHaveCount(0);
  await expectNoAxeViolations(page, "voice settings after choosing Qwen Audio");
  // Voice settings are applied by the running voice service; the e2e stack has none, so only the request is checked.
  const saved = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/api/v1/settings"));
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({ voice: { conversationBackend: "qwen", conversationConsent: true } });
});
