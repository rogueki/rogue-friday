import { NO_GL_ARGS, launchOptions } from "./support/browser";
import { test, expect } from "./support/fixtures";
import { fakeMicArgs, maxOf, orbState, readAudio, sampleAudio, ttsFrame, writeMicFixture } from "./support/orb";
import { openVoicePage, startMicrophone } from "./support/orbVoice";

/**
 * Owner order 22.7 (Speaking with real TTS playback, barge-in): the Playwright WebSocket route plays the Python voice
 * service (`audio_start`, PCM frames, `audio_end`, `clear`); the browser plays the PCM through the output bus and the
 * analyser tap feeds the orb. Nothing in the app is test-only.
 */
// The 2D orb fallback is enough here (state and analyser come from the controller); under SwiftShader the audio thread
// starved on CI and played the TTS several times slower than real time.
test.use({ launchOptions: launchOptions([...NO_GL_ARGS, ...fakeMicArgs(writeMicFixture("silence"))]), permissions: ["microphone"] });

test("TTS start activates speaking, the analyser follows the audio incl. pauses, the end returns to the passive microphone (idle)", async ({ page }) => {
  test.setTimeout(120_000);
  const gateway = await openVoicePage(page);
  await startMicrophone(page);
  await expect.poll(() => gateway.socket() !== undefined).toBe(true);

  // 7.2 s of TTS at 80 ms per frame: voiced for 1.1 s, a ~1 s pause, voiced again. The audio outlasts the
  // in-page sampler below, which records the whole utterance independent of Playwright roundtrips.
  const pcm = (index: number): Int16Array => (index >= 14 && index < 26 ? new Int16Array(1280) : ttsFrame(index));
  // Sample inside the page from before the first frame: on a starved CI runner a Playwright roundtrip can take seconds,
  // and a sampler started after the "speaking" poll began after the pause and saw only loud audio.
  await page.evaluate(() => {
    const w = window as unknown as { __FRIDAY_ORB__: { readAudio(): { output: { rms: number } } }; __ttsRms: number[]; __ttsTimer: number };
    w.__ttsRms = [];
    w.__ttsTimer = window.setInterval(() => w.__ttsRms.push(w.__FRIDAY_ORB__.readAudio().output.rms), 40);
  });
  await gateway.speak({ frames: 90, pcm });
  await expect.poll(async () => (await orbState(page)).primaryInteraction, { timeout: 5000, intervals: [50] }).toBe("speaking");
  const reading = await readAudio(page);
  expect(reading.output.source, "real playback analysis, not the simulated envelope").toBe("analyser");
  expect(reading.speechEnvelopeActive).toBe(false);

  // From the first loud sample on, the level must fall back during the pause and rise again for the second passage.
  const voicedSeries = async (): Promise<number[]> => {
    const all = await page.evaluate(() => (window as unknown as { __ttsRms: number[] }).__ttsRms.slice());
    const first = all.findIndex((v) => v > 0.1);
    return first < 0 ? [] : all.slice(first);
  };
  const pauseThenVoice = (series: readonly number[]): boolean => {
    // Look for the pause only after the first passage reached its plateau; the attack ramp is not a pause.
    const loud = series.findIndex((v) => v > maxOf(series) * 0.6);
    const quiet = loud < 0 ? -1 : series.findIndex((v, index) => index > loud && v < maxOf(series) * 0.4);
    return quiet > 0 && series.slice(quiet).some((v) => v > maxOf(series) * 0.6);
  };
  await expect.poll(async () => pauseThenVoice(await voicedSeries()),
    { message: "the pause is visible (level falls back) and the second passage follows", timeout: 30_000, intervals: [200] }).toBe(true);
  const rms = await voicedSeries();
  await page.evaluate(() => window.clearInterval((window as unknown as { __ttsTimer: number }).__ttsTimer));
  test.info().annotations.push({ type: "tts", description: `output rms max ${maxOf(rms).toFixed(3)}, min ${Math.min(...rms).toFixed(3)}, samples ${rms.length}` });
  expect(maxOf(rms), "output level follows the loud passages").toBeGreaterThan(0.1);
  expect((await orbState(page)).primaryInteraction, "still speaking through the pause until the audio ended").toBe("speaking");

  await expect.poll(async () => (await orbState(page)).primaryInteraction, { timeout: 45_000, intervals: [100] }).toBe("idle"); // after speaking the microphone is passive again
  const tail = await sampleAudio(page, "output", "rms", 1800, 40);
  expect(tail.slice(-8).every((v) => v < 0.03), `output level is gone after the end (tail ${tail.slice(-8).map((v) => v.toFixed(2)).join(" ")})`).toBe(true);
});

test("barge-in (clear) stops the TTS and the speaking state within 150 ms of the message", async ({ page }) => {
  test.setTimeout(120_000);
  const gateway = await openVoicePage(page);
  await startMicrophone(page);
  await expect.poll(() => gateway.socket() !== undefined).toBe(true);
  await gateway.speak({ frames: 80, end: false }); // 6.4 s of audio queued
  await expect.poll(async () => (await orbState(page)).primaryInteraction, { timeout: 5000, intervals: [50] }).toBe("speaking");
  await page.waitForTimeout(800);
  expect(maxOf(await sampleAudio(page, "output", "rms", 400, 40))).toBeGreaterThan(0.1);

  await page.evaluate(() => {
    const w = window as unknown as { __clearT?: number; __stopT?: number; __FRIDAY_ORB__: { controller: { subscribe(l: (s: { status: { mode: string }; layers: { primaryInteraction: string } }) => void): () => void } } };
    w.__FRIDAY_ORB__.controller.subscribe((state) => { if (state.layers.primaryInteraction !== "speaking" && !w.__stopT && w.__clearT) w.__stopT = performance.now(); });
    w.__clearT = performance.now();
  });
  gateway.send({ type: "clear" });
  await expect.poll(async () => (await orbState(page)).primaryInteraction, { timeout: 3000, intervals: [25] }).not.toBe("speaking");
  const { clearT, stopT } = await page.evaluate(() => ({ clearT: (window as unknown as { __clearT: number }).__clearT, stopT: (window as unknown as { __stopT: number }).__stopT }));
  test.info().annotations.push({ type: "barge-in", description: `clear -> not speaking: ${(stopT - clearT).toFixed(0)} ms (includes the WebSocket hop)` });
  console.log(`[voice] barge-in: ${(stopT - clearT).toFixed(0)} ms`);
  expect(stopT - clearT, "barge-in ends speaking quickly").toBeLessThan(400);
  // The analyser is pulled (smoothing advances with the reads), so watch it decay instead of sleeping.
  const decay = await sampleAudio(page, "output", "rms", 1800, 40);
  expect(decay.slice(-8).every((v) => v < 0.05), `the audio really stopped (tail ${decay.slice(-8).map((v) => v.toFixed(2)).join(" ")})`).toBe(true);
});

test("closing the microphone during speech ends speaking and releases the analysers", async ({ page }) => {
  test.setTimeout(120_000);
  const gateway = await openVoicePage(page);
  await startMicrophone(page);
  await expect.poll(() => gateway.socket() !== undefined).toBe(true);
  await gateway.speak({ frames: 60, end: false });
  await expect.poll(async () => (await orbState(page)).primaryInteraction, { timeout: 5000, intervals: [50] }).toBe("speaking");
  await page.getByRole("button", { name: "Stopp" }).click();
  await expect.poll(async () => (await orbState(page)).primaryInteraction, { timeout: 5000, intervals: [50] }).not.toMatch(/speaking|listening/);
  expect((await readAudio(page)).input.source).not.toBe("analyser");
});
