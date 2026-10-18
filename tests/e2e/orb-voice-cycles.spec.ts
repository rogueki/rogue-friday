import { GL_ARGS, launchOptions } from "./support/browser";
import { test, expect } from "./support/fixtures";
import { fakeMicArgs, orbState, readAudio, writeMicFixture } from "./support/orb";
import { MIC_BUTTON, openVoicePage } from "./support/orbVoice";

test.use({ launchOptions: launchOptions([...GL_ARGS, ...fakeMicArgs(writeMicFixture("quiet"))]), permissions: ["microphone"] });

/**
 * Acceptance 22.10 (analyser part): opening and closing the microphone repeatedly neither leaks AudioContexts nor JS heap.
 * `E2E_SOAK=1` runs 200 cycles, the default run 25.
 */
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
    await expect.poll(async () => (await orbState(page)).primaryInteraction, { timeout: 10_000, intervals: [25] }).toBe("listening");
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: "Stopp" }).click();
    await expect.poll(async () => (await orbState(page)).primaryInteraction, { timeout: 10_000, intervals: [25] }).not.toBe("listening");
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
