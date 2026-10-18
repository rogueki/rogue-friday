import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, open, orbRoot, expectOrbMode } from "./support/fixtures";

/**
 * Visual evidence for the orb rework (owner order section 23): one screenshot per key state and a video of the complete
 * auto-demo sequence. Not part of the regular run; produce it with
 *
 *   ORB_EVIDENCE=1 pnpm test:e2e tests/e2e/orb-evidence.spec.ts
 *
 * Screenshots land in `test-results/orb-evidence/` (PNG); the auto-demo video is encoded from panel frames with ffmpeg (`orb-auto-demo.webm`).
 * They are converted to WebP and copied to `docs/evidence/orb-rework/after/` by hand after a visual review.
 */
test.skip(process.env.ORB_EVIDENCE !== "1", "set ORB_EVIDENCE=1 to record the orb evidence");

const OUT = process.env.ORB_EVIDENCE_DIR ?? join(process.cwd(), "test-results", "orb-evidence");
type Hook = { controller: { setInputAudioLevel(v: number): void; setOutputAudioLevel(v: number): void }; bridge: Record<string, (...a: unknown[]) => void>; demo: { start(name: string): void; stop(): void; readonly running: boolean } };


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

test("screenshots of the key states and the auto-demo video", async ({ browser, api }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "de-DE", timezoneId: "Europe/Berlin", colorScheme: "dark" });
  await context.addCookies(api.cookieList());
  await context.addInitScript(() => sessionStorage.setItem("friday-onboarding-later", "1"));
  const page = await context.newPage();
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
  await page.waitForFunction(() => Boolean((window as unknown as { __FRIDAY_ORB__?: unknown }).__FRIDAY_ORB__));

  // 1. the full auto-demo sequence is what the video shows (Idle > Listening > Transcribing > Thinking > Working > Speaking > Success > Idle)
  await api.play("clean-idle", 10); // calm world: no working agents, no approvals
  await expectOrbMode(page, "idle");
  await page.waitForTimeout(3000);
  // Video: Playwright's recorder is not available for this Chromium build and a software-rendered page delivers about
  // one live frame per second. So the sequence is rendered on the orb test clock: every frame is the scene at an exactly
  // known time (0.5 s apart) and the frames play back at 2 fps = real time. The phases follow the auto demo
  // (Idle > Listening > Transcribing > Thinking > Working > Speaking > Success > Idle), driven through the bridge/controller.
  const frames = join(OUT, "demo-frames");
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const panel = orbRoot(page).locator("xpath=ancestor::*[contains(@class,'jv-panel')][1]");
  const phases: Array<{ name: string; seconds: number; enter: () => Promise<void>; level?: (t: number) => { input?: number; output?: number } }> = [
    { name: "idle", seconds: 4, enter: async () => undefined },
    { name: "listening", seconds: 5, enter: () => call(page, "onMicrophoneOpened", { source: "browser", passive: false }), level: (t) => ({ input: Math.max(0, 0.15 + 0.5 * Math.abs(Math.sin(t * 2.3)) * Math.abs(Math.sin(t * 0.7))) }) },
    { name: "transcribing", seconds: 3, enter: async () => { await call(page, "onMicrophoneClosed"); await call(page, "onTranscriptionStarted"); } },
    { name: "thinking", seconds: 4, enter: async () => { await call(page, "onTranscriptionCompleted"); await call(page, "onThinkingStarted"); } },
    { name: "working", seconds: 5, enter: async () => { await call(page, "onThinkingCompleted"); await call(page, "onTaskStarted", { taskId: "demo", title: "Recherche", progress: null }); } },
    { name: "speaking", seconds: 5, enter: async () => { await call(page, "onTaskCompleted", { taskId: "demo", success: false }); await call(page, "onTtsStarted", { engine: "demo", hasAudioAnalysis: false }); }, level: (t) => ({ output: Math.max(0, 0.1 + 0.55 * Math.abs(Math.sin(t * 3.1)) * (Math.sin(t * 0.9) > -0.6 ? 1 : 0.1)) }) },
    { name: "success", seconds: 2, enter: async () => { await call(page, "onTtsEnded", { interrupted: false }); await call(page, "onTaskStarted", { taskId: "demo2", title: "Fertig" }); await call(page, "onTaskCompleted", { taskId: "demo2", success: true }); } },
    { name: "idle", seconds: 3, enter: async () => undefined },
  ];
  let frame = 0;
  let clock = 0;
  for (const phase of phases) {
    await phase.enter();
    for (let step = 0; step < phase.seconds * 2; step += 1) {
      clock += 0.5;
      const levels = phase.level?.(clock) ?? {};
      await page.evaluate(([time, input, output]) => {
        const w = window as unknown as { __FRIDAY_ORB_TEST__: unknown; __FRIDAY_ORB__: Hook };
        if (input !== undefined) w.__FRIDAY_ORB__.controller.setInputAudioLevel(input);
        if (output !== undefined) w.__FRIDAY_ORB__.controller.setOutputAudioLevel(output);
        w.__FRIDAY_ORB_TEST__ = { fixedTime: time };
        window.dispatchEvent(new Event("friday-orb-test"));
      }, [clock, levels.input, levels.output] as const);
      await page.waitForTimeout(450);
      await panel.screenshot({ path: join(frames, `f${String(frame).padStart(4, "0")}.png`), animations: "allow", timeout: 90_000 });
      frame += 1;
    }
  }
  expect(frame, "frames of the demo").toBeGreaterThan(50);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "2", "-i", join(frames, "f%04d.png"), "-c:v", "libvpx-vp9", "-b:v", "1M", "-pix_fmt", "yuv420p", join(OUT, "orb-auto-demo.webm")]);
  rmSync(frames, { recursive: true, force: true });
  await page.evaluate(() => {
    delete (window as unknown as { __FRIDAY_ORB_TEST__?: unknown }).__FRIDAY_ORB_TEST__;
    window.dispatchEvent(new Event("friday-orb-test"));
  });
  await call(page, "onTtsEnded", { interrupted: true });
  await page.waitForTimeout(1500);

  // 2. screenshots through the real event paths
  await api.play("clean-idle", 10); // calm world: no working agents, no approvals
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

  await context.close();
});
