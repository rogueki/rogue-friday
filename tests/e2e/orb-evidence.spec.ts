import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, open, orbRoot, expectOrbMode } from "./support/fixtures";
import { orbState } from "./support/orb";

/**
 * Visual evidence for the orb rework (owner order section 23): one screenshot per key state and a video of the complete
 * auto-demo sequence. Not part of the regular run; produce it with
 *
 *   ORB_EVIDENCE=1 pnpm test:e2e tests/e2e/orb-evidence.spec.ts
 *
 * Files land in `test-results/orb-evidence/` (PNG + WebM); they are converted to WebP and copied to
 * `docs/evidence/orb-rework/after/` by hand after a visual review.
 */
test.skip(process.env.ORB_EVIDENCE !== "1", "set ORB_EVIDENCE=1 to record the orb evidence");

const OUT = process.env.ORB_EVIDENCE_DIR ?? join(process.cwd(), "test-results", "orb-evidence");
type Hook = { controller: { setInputAudioLevel(v: number): void; setOutputAudioLevel(v: number): void }; bridge: Record<string, (...a: unknown[]) => void>; demo: { start(name: string): void; stop(): void; readonly running: boolean } };

test.use({ viewport: { width: 1920, height: 1080 }, video: { mode: "on", size: { width: 1280, height: 720 } } });

const call = (page: Page, method: string, ...args: unknown[]): Promise<void> =>
  page.evaluate(([name, rest]) => { (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.bridge[name as string]!(...(rest as unknown[])); }, [method, args] as const);

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, `${name}-1920x1080-full.png`), animations: "allow", timeout: 90_000 });
  await orbRoot(page).locator("xpath=ancestor::*[contains(@class,'jv-panel')][1]").screenshot({ path: join(OUT, `${name}-1920x1080-ai-core-panel.png`), animations: "allow", timeout: 90_000 }).catch(async () => {
    await orbRoot(page).screenshot({ path: join(OUT, `${name}-1920x1080-ai-core-panel.png`), animations: "allow", timeout: 90_000 });
  });
}

test("screenshots of the key states and the auto-demo video", async ({ page, api }) => {
  test.setTimeout(600_000);
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
  await page.waitForFunction(() => Boolean((window as unknown as { __FRIDAY_ORB__?: unknown }).__FRIDAY_ORB__));

  // 1. the full auto-demo sequence is what the video shows (Idle > Listening > Transcribing > Thinking > Working > Speaking > Success > Idle)
  await api.forceOrb("idle");
  await expectOrbMode(page, "idle");
  await page.waitForTimeout(3000);
  await page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.demo.start("auto"));
  const modes = new Set<string>();
  await expect
    .poll(async () => {
      modes.add((await orbState(page)).mode);
      return page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.demo.running);
    }, { timeout: 240_000, intervals: [400] })
    .toBe(false);
  test.info().annotations.push({ type: "demo", description: `modes seen: ${[...modes].join(", ")}` });
  for (const mode of ["listening", "transcribing", "thinking", "working", "speaking", "success", "idle"]) expect(modes, `auto demo shows ${mode}`).toContain(mode);
  await page.waitForTimeout(2000);

  // 2. screenshots through the real event paths
  await api.forceOrb("idle");
  await expectOrbMode(page, "idle");
  await shoot(page, "idle");

  await call(page, "onMicrophoneOpened", { source: "browser", passive: false });
  await page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.controller.setInputAudioLevel(0.55));
  await shoot(page, "listening");
  await page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.controller.setInputAudioLevel(0));
  await call(page, "onMicrophoneClosed");

  await call(page, "onThinkingStarted");
  await shoot(page, "thinking");
  await call(page, "onThinkingCompleted");

  await call(page, "onTtsStarted", { engine: "evidence", hasAudioAnalysis: false });
  await page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.controller.setOutputAudioLevel(0.5));
  await shoot(page, "speaking");
  await call(page, "onTtsEnded", { interrupted: true });

  await api.forceOrb(null);
  await api.play("multi-agent-working", 1);
  await expectOrbMode(page, "working", 30_000);
  await shoot(page, "working");

  await api.reset();
  await api.play("approval-waiting", 10);
  await expectOrbMode(page, "waiting_approval", 30_000);
  await shoot(page, "waiting_approval");

  await api.reset();
  await api.play("critical-alert", 1);
  await expectOrbMode(page, "error", 30_000);
  await shoot(page, "error");

  const video = page.video();
  await page.close();
  if (video) await video.saveAs(join(OUT, "orb-auto-demo.webm"));
});
