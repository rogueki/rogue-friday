import type { Page } from "@playwright/test";
import { test, expect, open, orbRoot, expectOrbMode } from "./support/fixtures";
import { orbState } from "./support/orb";

/**
 * Owner order 22.4-22.6, 22.8 and 22.9: the orb follows real event paths. The mock Control API plays scenarios that emit
 * the same events a live backend does (task/agent/approval/notification/orb status); the orb controller consumes them
 * through the realtime router and the event bridge. Local facts that no scenario emits (transcription start, ...) are fed
 * through the bridge via the dev hook, exactly as the browser voice adapter does.
 */
type Hook = { controller: { getState(): any; subscribe(l: (s: any) => void): () => void; setInputAudioLevel(v: number): void }; bridge: Record<string, (...a: unknown[]) => void> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Records every distinct controller state (mode, progress, agents) with its time, from inside the page. */
async function recordTimeline(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hook = (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__;
    const timeline: Array<{ t: number; mode: string; progressMode: string; progress: number | null; agents: number; approval: boolean }> = [];
    const push = (s: any): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
      timeline.push({ t: performance.now(), mode: s.status.mode, progressMode: s.status.progressMode, progress: s.status.progress ?? null, agents: s.status.activeAgentCount ?? 0, approval: s.layers.approval.pending });
    };
    push(hook.controller.getState());
    hook.controller.subscribe(push);
    (window as unknown as { __timeline: typeof timeline }).__timeline = timeline;
  });
}
const timeline = (page: Page) => page.evaluate(() => (window as unknown as { __timeline: Array<{ t: number; mode: string; progressMode: string; progress: number | null; agents: number; approval: boolean }> }).__timeline);

async function freezeScene(page: Page, fixedTime = 3.2): Promise<void> {
  await page.evaluate((time) => {
    (window as unknown as { __FRIDAY_ORB_TEST__: unknown }).__FRIDAY_ORB_TEST__ = { fixedTime: time };
    window.dispatchEvent(new Event("friday-orb-test"));
  }, fixedTime);
  await page.waitForTimeout(1500);
}
const shot = async (page: Page): Promise<Buffer> => orbRoot(page).screenshot({ animations: "allow", timeout: 60_000 });

async function openOverview(page: Page): Promise<void> {
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
  await page.waitForFunction(() => Boolean((window as unknown as { __FRIDAY_ORB__?: unknown }).__FRIDAY_ORB__));
}
const call = (page: Page, method: string, ...args: unknown[]): Promise<void> =>
  page.evaluate(([name, rest]) => { (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.bridge[name as string]!(...(rest as unknown[])); }, [method, args] as const);

test.describe("transcribing and thinking (acceptance 22.4, 22.5)", () => {
  test.setTimeout(180_000);

  test("transcribing ends listening; neither transcribing nor thinking reacts to the microphone level; thinking invents no percentage", async ({ page, api }) => {
    await openOverview(page);
    await api.forceOrb("idle");
    await expectOrbMode(page, "idle");
    // local voice facts, as the browser voice adapter reports them
    await call(page, "onMicrophoneOpened", { source: "browser", passive: false });
    await expect.poll(async () => (await orbState(page)).mode).toBe("listening");
    await call(page, "onTranscriptionStarted");
    await expect.poll(async () => (await orbState(page)).mode, { message: "listening ends when transcribing starts" }).toBe("transcribing");
    expect((await orbState(page)).primaryInteraction).toBe("transcribing");
    await expect(page.getByRole("status").filter({ hasText: /SPRACHE WIRD VERARBEITET|verarbeitet Sprache/ }).first()).toBeAttached();

    // frozen scene: same instant, microphone level 0 vs loud -> identical image while transcribing (no microphone reaction)
    await freezeScene(page);
    await page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.controller.setInputAudioLevel(0));
    await page.waitForTimeout(800);
    const transcribingQuiet = await shot(page);
    await page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.controller.setInputAudioLevel(0.95));
    await page.waitForTimeout(800);
    const transcribingLoud = await shot(page);
    expect(transcribingLoud.equals(transcribingQuiet), "transcribing: microphone level has no visual effect").toBe(true);

    await call(page, "onTranscriptionCompleted");
    await call(page, "onThinkingStarted");
    await expect.poll(async () => (await orbState(page)).mode).toBe("thinking");
    const thinking = await orbState(page);
    expect(thinking.progressMode, "thinking has no progress").toBe("none");
    expect(thinking.progress).toBeNull();
    await page.waitForTimeout(1500);
    const thinkingImage = await shot(page);
    await page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.controller.setInputAudioLevel(0.95));
    await page.waitForTimeout(800);
    expect((await shot(page)).equals(thinkingImage), "thinking: microphone level has no visual effect (no wave ring)").toBe(true);
    expect(thinkingImage.equals(transcribingQuiet), "transcribing and thinking look different").toBe(false);
    await expect(page.locator(".ov-orb__progress"), "no percentage display while thinking").toHaveCount(0);
    await expect(page.locator(".ov-orb__status")).not.toContainText(/\d+\s?%/);
  });

  test("a loud microphone does change the listening orb (control for the checks above)", async ({ page, api }) => {
    await openOverview(page);
    await api.forceOrb("idle");
    await call(page, "onMicrophoneOpened", { source: "browser", passive: false });
    await expect.poll(async () => (await orbState(page)).mode).toBe("listening");
    await freezeScene(page);
    await page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.controller.setInputAudioLevel(0));
    await page.waitForTimeout(1000);
    const quiet = await shot(page);
    await page.evaluate(() => (window as unknown as { __FRIDAY_ORB__: Hook }).__FRIDAY_ORB__.controller.setInputAudioLevel(0.9));
    await page.waitForTimeout(1000);
    expect((await shot(page)).equals(quiet), "listening reacts to the level").toBe(false);
  });
});

test("working: task start activates it, agents are counted, progress is only shown when real, completion flashes success and returns to idle (acceptance 22.6)", async ({ page, api }) => {
  test.setTimeout(180_000);
  await openOverview(page);
  await api.forceOrb(null);
  await recordTimeline(page);
  await api.play("multi-agent-working", 4);
  await expect.poll(async () => (await orbState(page)).mode, { timeout: 30_000 }).toBe("working");
  await expect.poll(async () => (await orbState(page)).activeAgentCount, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText(/\d+ AGENTEN AKTIV|AGENTEN/i).first()).toBeVisible({ timeout: 15_000 }).catch(() => undefined);
  await expect.poll(async () => (await timeline(page)).some((s) => s.progressMode === "determinate" && typeof s.progress === "number" && s.progress > 0), { timeout: 30_000, intervals: [250] }).toBe(true);
  await expect.poll(async () => (await timeline(page)).some((s) => s.mode === "success"), { timeout: 60_000, intervals: [250] }).toBe(true);
  await expectOrbMode(page, "idle", 60_000);

  const states = await timeline(page);
  test.info().annotations.push({ type: "timeline", description: states.map((s) => `${s.mode}${s.progressMode === "determinate" ? `(${Math.round((s.progress ?? 0) * 100)}%)` : s.progressMode === "indeterminate" ? "(~)" : ""}`).join(" > ") });
  for (const s of states) {
    if (s.progressMode === "determinate") expect(typeof s.progress, "determinate progress always carries a real number").toBe("number");
    else expect(s.progress, `progress is null unless determinate (mode ${s.mode}, ${s.progressMode})`).toBeNull();
    if (s.mode === "thinking" || s.mode === "listening" || s.mode === "transcribing") expect(s.progressMode).toBe("none");
  }
  const order = ["working", "success", "idle"].map((mode) => states.findIndex((s, i, all) => s.mode === mode && (mode !== "idle" || i > all.findIndex((x) => x.mode === "success"))));
  expect(order.every((index) => index >= 0), `working > success > idle in ${states.map((s) => s.mode).join(" > ")}`).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test.describe("approval (acceptance 22.8)", () => {
  test("the approval event activates waiting_approval, also while F.R.I.D.A.Y. speaks; the click opens exactly that approval", async ({ page, api }) => {
    test.setTimeout(120_000);
    await openOverview(page);
    await api.forceOrb(null);
    await api.play("approval-waiting", 10);
    await expect.poll(async () => (await orbState(page)).mode, { timeout: 20_000 }).toBe("waiting_approval");
    const pending = (await api.get("/approvals?status=pending&limit=5")).body.items as Array<{ id: string; action: string }>;
    expect((await orbState(page)).approvalId, "controller knows the concrete approval").toBe(pending[0]!.id);

    // parallel state: speaking + approval -> the approval stays the visible mode and keeps its target
    await call(page, "onTtsStarted", { engine: "test", hasAudioAnalysis: false });
    await page.waitForTimeout(500);
    const parallel = await orbState(page);
    expect(parallel.primaryInteraction).toBe("speaking");
    expect(parallel.mode).toBe("waiting_approval");
    await expectOrbMode(page, "waiting_approval");

    await orbRoot(page).getByRole("button", { name: /^Orb: Details öffnen\./ }).click();
    const drawer = page.getByRole("dialog", { name: "Freigabe" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(pending[0]!.action);
    await call(page, "onTtsEnded", { interrupted: false });
  });

  test("resolving the approval returns the orb to calm", async ({ page, api }) => {
    test.setTimeout(120_000);
    await openOverview(page);
    await api.forceOrb(null);
    await api.play("approval-waiting", 10);
    await expect.poll(async () => (await orbState(page)).mode, { timeout: 20_000 }).toBe("waiting_approval");
    const pending = (await api.get("/approvals?status=pending&limit=5")).body.items as Array<{ id: string }>;
    const result = await api.post(`/approvals/${pending[0]!.id}/reject`, { comment: "E2E" });
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
    await expect.poll(async () => (await orbState(page)).mode, { timeout: 20_000 }).not.toBe("waiting_approval");
    expect((await orbState(page)).approvalId).toBeNull();
  });
});

test("error: visible at once, stable for 10 s without flicker, clean recovery (acceptance 22.9)", async ({ page, api }) => {
  test.setTimeout(180_000);
  await openOverview(page);
  await api.forceOrb(null);
  await expect.poll(async () => (await orbState(page)).mode).not.toBe("error");
  await recordTimeline(page);
  const started = Date.now();
  await api.play("critical-alert", 1);
  await expect.poll(async () => (await orbState(page)).mode, { timeout: 5000, intervals: [25] }).toBe("error");
  const visibleMs = Date.now() - started;
  test.info().annotations.push({ type: "latency", description: `critical-alert request -> orb error: ${visibleMs} ms` });
  console.log(`[error] visible after ${visibleMs} ms`);
  expect(visibleMs, "error is visible within 2 s of the event").toBeLessThan(2000);

  await page.waitForTimeout(10_000);
  const errorSpan = (await timeline(page)).filter((s) => s.t >= (await timeline(page)).find((x) => x.mode === "error")!.t);
  expect(new Set(errorSpan.map((s) => s.mode)), "no flip-flopping while the error is active").toEqual(new Set(["error"]));
  expect(errorSpan.length, "no state churn (re-render storm) during the error").toBeLessThan(12);

  // recovery: acknowledging the alert clears the error
  const alerts = (await api.get("/notifications?status=open&limit=20")).body.items as Array<{ id: string; priority: string }>;
  const critical = alerts.find((n) => n.priority === "P0");
  expect(critical, "the scenario raised a P0 alert").toBeTruthy();
  const ack = await api.post(`/notifications/${critical!.id}/acknowledge`, {});
  expect(ack.status, JSON.stringify(ack.body)).toBeLessThan(300);
  await expect.poll(async () => (await orbState(page)).mode, { timeout: 20_000 }).not.toBe("error");
  const after = (await timeline(page)).map((s) => s.mode);
  const lastError = after.lastIndexOf("error");
  expect(after.slice(lastError + 1).includes("error"), "does not return to error").toBe(false);
});
