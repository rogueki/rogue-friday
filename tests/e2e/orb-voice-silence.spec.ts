import { GL_ARGS, launchOptions } from "./support/browser";
import { expect, test } from "./support/fixtures";
import { fakeMicArgs, writeMicFixture } from "./support/orb";
import { MIC_BUTTON, openVoicePage, runMicrophoneLevelCheck } from "./support/orbVoice";
import { orbState } from "./support/orb";

/**
 * Owner order 22.3 (Listening with a real microphone level). The REAL browser voice path runs: Chromium's fake capture
 * device plays a WAV loop (`--use-file-for-fake-audio-capture`), `getUserMedia` -> AudioContext -> analyser tap feeds the
 * orb; the Control API's browser-audio gateway is replaced by a Playwright WebSocket route (see support/orb.ts).
 * One spec file per fixture because the fake device is a browser launch flag.
 */
test.use({ launchOptions: launchOptions([...GL_ARGS, ...fakeMicArgs(writeMicFixture("silence"))]), permissions: ["microphone"] });

test("silence microphone: listening starts at once and the level follows the real signal", async ({ page }) => {
  test.setTimeout(120_000);
  await runMicrophoneLevelCheck(page, "silence");
});

test("an armed wake word keeps the open microphone passive: the orb stays idle until something is said", async ({ page }) => {
  test.setTimeout(120_000);
  await openVoicePage(page, { armedWakeWord: true });
  await page.getByRole("button", { name: MIC_BUTTON }).click();
  await page.waitForTimeout(2500);
  expect((await orbState(page)).primaryInteraction).toBe("idle");
});
