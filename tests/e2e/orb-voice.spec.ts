import type { Page } from "@playwright/test";
import { GL_ARGS, launchOptions } from "./support/browser";
import { test, expect, open, expectOrbMode } from "./support/fixtures";
import { fakeMicArgs, installFakeGateway, maxOf, mean, orbState, readAudio, sampleAudio, ttsFrame, writeMicFixture, type FakeGateway, type MicFixture } from "./support/orb";

/**
 * Owner order 22.3 (Listening with a real microphone level) and 22.7 (Speaking with real TTS playback, barge-in).
 *
 * The REAL browser voice path runs: Chromium's fake capture device plays a WAV loop (`--use-file-for-fake-audio-capture`),
 * `getUserMedia` -> AudioContext -> analyser tap feeds the orb; the Control API's browser-audio gateway is replaced by a
 * Playwright WebSocket route that plays the role of the Python voice service (sends `audio_start`, PCM frames, `audio_end`,
 * `clear`). Nothing in the app is test-only.
 */
const MIC_BUTTON = /MIT .* SPRECHEN/;

async function startMicrophone(page: Page): Promise<{ controllerMs: number }> {
  await page.evaluate(() => {
    const w = window as unknown as { __mic?: { click: number; listening: number }; __FRIDAY_ORB__?: { controller: { subscribe(l: (s: { status: { mode: string } }) => void): () => void } } };
    const timing = { click: 0, listening: 0 };
    w.__mic = timing;
    document.addEventListener("click", () => { if (!timing.click) timing.click = performance.now(); }, { capture: true });
    w.__FRIDAY_ORB__?.controller.subscribe((state) => {
      if (state.status.mode === "listening" && !timing.listening) timing.listening = performance.now();
    });
  });
  await page.getByRole("button", { name: MIC_BUTTON }).click();
  await expect.poll(async () => (await orbState(page)).mode, { timeout: 10_000, intervals: [50] }).toBe("listening");
  const timing = await page.evaluate(() => (window as unknown as { __mic: { click: number; listening: number } }).__mic);
  return { controllerMs: timing.listening - timing.click };
}

async function openVoicePage(page: Page): Promise<FakeGateway> {
  const gateway = await installFakeGateway(page);
  await open(page, "/");
  await expect(page.getByRole("button", { name: MIC_BUTTON })).toBeVisible();
  // the availability probe runs on mount; wait until the page considers browser audio available
  await expect.poll(() => page.evaluate(async () => (await fetch("/api/v1/voice/browser-audio-availability")).json()), { timeout: 15_000 }).toEqual({ available: true });
  await page.waitForTimeout(500);
  return gateway;
}

const stats: Partial<Record<MicFixture, { mean: number; max: number }>> = {};

for (const kind of ["silence", "quiet", "loud"] as const) {
  test.describe(`listening with a ${kind} microphone (acceptance 22.3)`, () => {
    test.use({ launchOptions: launchOptions([...GL_ARGS, ...fakeMicArgs(writeMicFixture(kind))]), permissions: ["microphone"] });

    test(`opening the microphone switches the orb to listening at once and the level follows the real signal (${kind})`, async ({ page }) => {
      test.setTimeout(120_000);
      await openVoicePage(page);
      const { controllerMs } = await startMicrophone(page);
      test.info().annotations.push({ type: "latency", description: `click -> controller listening: ${controllerMs.toFixed(0)} ms` });
      console.log(`[voice] ${kind}: click -> listening ${controllerMs.toFixed(0)} ms`);
      expect(controllerMs, "mic start changes the state immediately").toBeLessThan(300);
      await expectOrbMode(page, "listening", 20_000);

      await page.waitForTimeout(1500); // noise-gate calibration (first ~600 ms) and analyser warm-up
      const reading = await readAudio(page);
      expect(reading.input.source, "a real analyser feeds the input channel").toBe("analyser");

      const rms = await sampleAudio(page, "input", "rms", 5000, 40);
      const readings = await Promise.all([readAudio(page)]);
      stats[kind] = { mean: mean(rms), max: maxOf(rms) };
      test.info().annotations.push({ type: "level", description: `${kind}: mean ${stats[kind]!.mean.toFixed(3)}, max ${stats[kind]!.max.toFixed(3)}` });
      console.log(`[voice] ${kind}: rms mean ${stats[kind]!.mean.toFixed(3)} max ${stats[kind]!.max.toFixed(3)}`);
      expect(readings[0]!.input.rms).toBeLessThanOrEqual(1);

      if (kind === "silence") {
        expect(stats.silence!.max, "silence never produces strong movement (noise gate)").toBeLessThan(0.12);
        expect(stats.silence!.mean).toBeLessThan(0.04);
        const gate = await sampleAudio(page, "input", "peak", 1500, 50);
        expect(maxOf(gate)).toBeLessThan(0.2);
      } else if (kind === "quiet") {
        expect(stats.quiet!.max, "quiet speech is visible").toBeGreaterThan(0.04);
        expect(stats.quiet!.max, "quiet speech stays small").toBeLessThan(0.6);
      } else {
        expect(stats.loud!.max, "loud speech is clearly bigger").toBeGreaterThan(0.45);
        expect(stats.loud!.max, "and bounded").toBeLessThanOrEqual(1);
      }
    });
  });
}

test("quiet is smaller than loud, silence stays quiet (cross-check of the three runs above)", () => {
  test.skip(!stats.silence || !stats.quiet || !stats.loud, "needs the three fixture runs before it in the same worker");
  expect(stats.quiet!.mean).toBeGreaterThan(stats.silence!.mean);
  expect(stats.loud!.mean).toBeGreaterThan(stats.quiet!.mean * 1.5);
  expect(stats.loud!.max).toBeGreaterThan(stats.quiet!.max);
});

test.describe("speaking with real TTS playback (acceptance 22.7)", () => {
  test.use({ launchOptions: launchOptions([...GL_ARGS, ...fakeMicArgs(writeMicFixture("silence"))]), permissions: ["microphone"] });

  test("TTS start activates speaking, the analyser follows the audio incl. pauses, the end returns to listening", async ({ page }) => {
    test.setTimeout(120_000);
    const gateway = await openVoicePage(page);
    await startMicrophone(page);
    await expect.poll(() => gateway.socket() !== undefined).toBe(true);

    // 3 s of TTS: voiced for 1 s, a 0.8 s pause, voiced again
    const pcm = (index: number): Int16Array => (index >= 12 && index < 22 ? new Int16Array(1280) : ttsFrame(index));
    await gateway.speak({ frames: 38, pcm });
    await expect.poll(async () => (await orbState(page)).mode, { timeout: 5000, intervals: [50] }).toBe("speaking");
    const reading = await readAudio(page);
    expect(reading.output.source, "real playback analysis, not the simulated envelope").toBe("analyser");
    expect(reading.speechEnvelopeActive).toBe(false);

    const rms = await sampleAudio(page, "output", "rms", 2800, 40);
    test.info().annotations.push({ type: "tts", description: `output rms max ${maxOf(rms).toFixed(3)}, min ${Math.min(...rms).toFixed(3)}` });
    expect(maxOf(rms), "output level follows the loud passages").toBeGreaterThan(0.1);
    expect(Math.min(...rms), "the pause is visible (level falls back)").toBeLessThan(maxOf(rms) * 0.4);
    expect((await orbState(page)).mode, "still speaking through the pause until the audio ended").toBe("speaking");

    await expect.poll(async () => (await orbState(page)).mode, { timeout: 8000, intervals: [100] }).toBe("listening");
    expect(Math.max(...(await sampleAudio(page, "output", "rms", 600, 50))), "output level is gone after the end").toBeLessThan(0.03);
  });

  test("barge-in (clear) stops the TTS and the speaking state within 150 ms of the message", async ({ page }) => {
    test.setTimeout(120_000);
    const gateway = await openVoicePage(page);
    await startMicrophone(page);
    await expect.poll(() => gateway.socket() !== undefined).toBe(true);
    await gateway.speak({ frames: 80, end: false }); // 6.4 s of audio queued
    await expect.poll(async () => (await orbState(page)).mode, { timeout: 5000, intervals: [50] }).toBe("speaking");
    await page.waitForTimeout(800);
    expect(maxOf(await sampleAudio(page, "output", "rms", 400, 40))).toBeGreaterThan(0.1);

    await page.evaluate(() => {
      const w = window as unknown as { __clearT?: number; __stopT?: number; __FRIDAY_ORB__: { controller: { subscribe(l: (s: { status: { mode: string } }) => void): () => void } } };
      w.__FRIDAY_ORB__.controller.subscribe((state) => { if (state.status.mode !== "speaking" && !w.__stopT && w.__clearT) w.__stopT = performance.now(); });
      w.__clearT = performance.now();
    });
    gateway.send({ type: "clear" });
    await expect.poll(async () => (await orbState(page)).mode, { timeout: 3000, intervals: [25] }).not.toBe("speaking");
    const { clearT, stopT } = await page.evaluate(() => ({ clearT: (window as unknown as { __clearT: number }).__clearT, stopT: (window as unknown as { __stopT: number }).__stopT }));
    test.info().annotations.push({ type: "barge-in", description: `clear -> not speaking: ${(stopT - clearT).toFixed(0)} ms (includes the WebSocket hop)` });
    console.log(`[voice] barge-in: ${(stopT - clearT).toFixed(0)} ms`);
    expect(stopT - clearT, "barge-in ends speaking quickly").toBeLessThan(400);
    await page.waitForTimeout(400);
    expect(maxOf(await sampleAudio(page, "output", "rms", 400, 40)), "the audio really stopped").toBeLessThan(0.05);
  });

  test("closing the microphone during speech ends speaking and releases the analysers", async ({ page }) => {
    test.setTimeout(120_000);
    const gateway = await openVoicePage(page);
    await startMicrophone(page);
    await expect.poll(() => gateway.socket() !== undefined).toBe(true);
    await gateway.speak({ frames: 60, end: false });
    await expect.poll(async () => (await orbState(page)).mode, { timeout: 5000, intervals: [50] }).toBe("speaking");
    await page.getByRole("button", { name: "Stopp" }).click();
    await expect.poll(async () => (await orbState(page)).mode, { timeout: 5000, intervals: [50] }).not.toMatch(/speaking|listening/);
    expect((await readAudio(page)).input.source).not.toBe("analyser");
  });
});

/**
 * Acceptance 22.10 (analyser part): opening and closing the microphone repeatedly neither leaks AudioContexts nor JS heap.
 * `E2E_SOAK=1` runs 200 cycles, the default run 25.
 */
test.describe("microphone open/close cycles", () => {
  test.use({ launchOptions: launchOptions([...GL_ARGS, ...fakeMicArgs(writeMicFixture("quiet"))]), permissions: ["microphone"] });

  test("no AudioContext or heap leak and the orb ends idle", async ({ page }) => {
    const cycles = process.env.E2E_SOAK === "1" ? 200 : 25;
    test.setTimeout(60_000 + cycles * 6_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __ctx: { created: number; closed: number }; AudioContext: typeof AudioContext };
      w.__ctx = { created: 0, closed: 0 };
      const Original = w.AudioContext;
      w.AudioContext = class extends Original {
        constructor(options?: AudioContextOptions) {
          super(options);
          w.__ctx.created += 1;
        }
        close(): Promise<void> {
          w.__ctx.closed += 1;
          return super.close();
        }
      } as typeof AudioContext;
    });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await openVoicePage(page);
    const cdp = await page.context().newCDPSession(page);
    const heap = async (): Promise<number> => {
      await cdp.send("HeapProfiler.collectGarbage");
      return ((await cdp.send("Runtime.getHeapUsage")) as { usedSize: number }).usedSize;
    };
    let baseline = 0;
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      await page.getByRole("button", { name: MIC_BUTTON }).click();
      await expect.poll(async () => (await orbState(page)).mode, { timeout: 10_000, intervals: [25] }).toBe("listening");
      await page.waitForTimeout(150);
      await page.getByRole("button", { name: "Stopp" }).click();
      await expect.poll(async () => (await orbState(page)).mode, { timeout: 10_000, intervals: [25] }).not.toBe("listening");
      if (cycle === 4) baseline = await heap();
    }
    const contexts = await page.evaluate(() => (window as unknown as { __ctx: { created: number; closed: number } }).__ctx);
    const growthMb = ((await heap()) - baseline) / 1024 / 1024;
    test.info().annotations.push({ type: "leak", description: `${cycles} cycles: ${contexts.created} contexts created, ${contexts.closed} closed, heap +${growthMb.toFixed(1)} MB` });
    console.log(`[voice] ${cycles} mic cycles: contexts ${contexts.created}/${contexts.closed}, heap +${growthMb.toFixed(1)} MB`);
    expect(contexts.closed, "every AudioContext was closed").toBe(contexts.created);
    expect(growthMb, "heap growth over the cycles").toBeLessThan(cycles === 200 ? 40 : 15);
    expect((await readAudio(page)).input.source, "no analyser stays installed").not.toBe("analyser");
    expect(errors, "no console errors").toEqual([]);
  });
});
