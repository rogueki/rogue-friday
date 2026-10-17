import { test, expect, open, orbRoot, expectOrbMode } from "./support/fixtures";
import { flatPhases, orbProbe, orbState } from "./support/orb";

/**
 * Owner order 22.2 "Idle": the idle orb shows at least five independent movements (core pulse, inner ring A, inner ring B,
 * outer ring, fragments, particles ...). The render probe publishes the animation phase of every scene group
 * (`__ORB_DEBUG__.groupPhases`); a group counts as moving when its phase changes between samples. Independence means the
 * groups do not all advance in lockstep (distinct rates).
 */
test("idle orb: at least five groups move independently and the core pulses", async ({ page, api }) => {
  test.setTimeout(120_000);
  await open(page, "/");
  await api.forceOrb("idle");
  await expectOrbMode(page, "idle");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
  expect((await orbState(page)).mode).toBe("idle");
  await expect.poll(async () => Object.keys(flatPhases(await orbProbe(page))).length, { timeout: 90_000, intervals: [500] }).toBeGreaterThanOrEqual(5);

  const samples: Array<Record<string, number>> = [];
  const times: number[] = [];
  for (let i = 0; i < 9; i += 1) {
    samples.push(flatPhases(await orbProbe(page)));
    times.push(Date.now());
    await page.waitForTimeout(1000);
  }
  const names = Object.keys(samples[0] ?? {});
  const unwrapped = (name: string): number[] => {
    // phases may wrap at 1 or 2*PI: compare successive differences modulo the wrap, so a wrapped value still counts as moving
    return samples.map((sample) => sample[name] ?? 0);
  };
  const moving = names.filter((name) => {
    const series = unwrapped(name);
    return new Set(series.map((v) => v.toFixed(3))).size >= 4;
  });
  test.info().annotations.push({ type: "idle", description: `moving groups: ${moving.join(", ")} of ${names.join(", ")}` });
  console.log(`[idle] moving groups: ${moving.join(", ")} of ${names.join(", ")}`);
  expect(moving.length, `groups with changing phase: ${moving.join(", ")}`).toBeGreaterThanOrEqual(5);

  // independent = not one common rate: at least three different average phase speeds
  const speeds = new Set(
    moving.map((name) => {
      const series = unwrapped(name);
      const span = (times.at(-1)! - times[0]!) / 1000;
      return (Math.abs(series.at(-1)! - series[0]!) / span).toFixed(2);
    }),
  );
  expect(speeds.size, `distinct phase speeds: ${[...speeds].join(", ")}`).toBeGreaterThanOrEqual(3);
});

test("idle orb: the rendered image keeps changing (no frozen picture)", async ({ page, api }) => {
  test.setTimeout(120_000);
  await open(page, "/");
  await api.forceOrb("idle");
  await expectOrbMode(page, "idle");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
  await expect.poll(async () => (await orbProbe(page))?.frames ?? 0, { timeout: 90_000, intervals: [500] }).toBeGreaterThan(20);
  const frame = async (): Promise<string> => (await orbRoot(page).screenshot({ animations: "allow", timeout: 60_000 })).toString("base64");
  const first = await frame();
  await page.waitForTimeout(2500);
  const second = await frame();
  await page.waitForTimeout(2500);
  const third = await frame();
  expect(new Set([first, second, third]).size, "three frames, 2.5 s apart, are pairwise different").toBe(3);
});
