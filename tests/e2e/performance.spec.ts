import { test, expect, open, orbRoot, eventStreamChip, patchSettings } from "./support/fixtures";
import { domNodes, drawCalls, heapUsed, installDrawCounter, measureFrames, setTabHidden, wheelScroll } from "./support/perf";
import type { WebSocketRoute } from "@playwright/test";

/**
 * PLAN §51.6 Performance. Budgets are deliberately generous: the CI browser renders WebGL in software (SwiftShader), so the
 * numbers prove "stays responsive and bounded", not GPU-class frame rates. Measured values are attached to every run
 * as annotations so a regression is visible long before a budget is hit.
 */
const note = (description: string): void => {
  test.info().annotations.push({ type: "perf", description });
  console.log(`[perf] ${description}`);
};

async function loadHighLoad(api: import("./support/api").ApiClient): Promise<void> {
  await api.play("high-load", 1);
  await expect.poll(async () => (await api.get("/tasks?limit=1")).status).toBe(200);
}

test.describe("high load (profile highLoad: 1 000 tasks, 10 000 activity events, 100 agents)", () => {
  test("the activity feed with 10 000 events is virtualised and scrolls responsively", async ({ page, api }) => {
    await loadHighLoad(api);
    await open(page, "/activity");
    const list = page.getByRole("main").getByRole("list").first();
    await expect(list).toBeVisible();
    await page.waitForTimeout(1500);
    const total = (await api.get("/activity?limit=1")).body;
    note(`activity page size sample: ${JSON.stringify(total.page ?? {}).slice(0, 80)}`);

    const nodes = await domNodes(page);
    note(`DOM nodes after load: ${nodes}`);
    expect(nodes, "DOM does not explode with 10 000 events").toBeLessThan(6000);

    // Software rendering (SwiftShader) makes absolute frame times meaningless, so scrolling is compared with the same
    // page standing still: virtualised scrolling must not cost materially more per frame than idling, and the main
    // thread must not be blocked (long tasks).
    const idle = await measureFrames(page, () => page.waitForTimeout(3000));
    const box = (await page.getByRole("main").boundingBox())!;
    const stats = await measureFrames(page, () => wheelScroll(page, box.x + box.width / 2, box.y + box.height / 2, 40, 600, 30));
    const longTaskShare = stats.longTaskMs / stats.durationMs;
    note(`idle p50=${idle.p50.toFixed(1)}ms p95=${idle.p95.toFixed(1)}ms | scroll frames=${stats.frames} p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.max.toFixed(0)}ms longTasks=${stats.longTaskMs.toFixed(0)}ms over ${stats.durationMs.toFixed(0)}ms (${(longTaskShare * 100).toFixed(1)}%)`);
    expect(stats.frames).toBeGreaterThan(20);
    expect(stats.p95, "scroll p95 frame time vs idle (x2.5 + 150 ms slack)").toBeLessThan(idle.p95 * 2.5 + 150);
    // The action can stretch by tens of seconds on a software-rendered runner; compare blocking time to that same window.
    expect(longTaskShare, "main-thread long-task share during 40 wheel steps").toBeLessThan(0.3);
    expect(stats.max, "no single frame stalls for several seconds").toBeLessThan(4000);
    expect(await domNodes(page), "still bounded after scrolling").toBeLessThan(6000);
  });

  test("1 000 tasks render bounded (counters instead of all cards) and filtering stays fast", async ({ page, api }) => {
    await loadHighLoad(api);
    await open(page, "/tasks");
    await expect(page.getByText(/\d+ Treffer/)).toBeVisible({ timeout: 30_000 });
    const rendered = await page.getByRole("group", { name: "Kanban-Board" }).getByRole("article").count();
    const nodes = await domNodes(page);
    note(`kanban cards in DOM: ${rendered}, DOM nodes: ${nodes}`);
    expect(rendered, "cards in the DOM are bounded").toBeLessThanOrEqual(400);
    expect(nodes).toBeLessThan(15000);

    const started = Date.now();
    await page.getByRole("searchbox", { name: "Aufgaben suchen" }).fill("Büromöbel");
    await expect(page.getByText(/\d+ Treffer/)).toBeVisible();
    const filtered = Date.now() - started;
    note(`search over 1 000 tasks answered in ${filtered} ms`);
    expect(filtered, "search feedback within 5 s (software-rendered CI)").toBeLessThan(5000);

    await page.getByRole("button", { name: "Liste", exact: true }).click();
    await expect(page.getByRole("main").getByRole("article").or(page.getByRole("main").getByRole("row")).first()).toBeVisible();
    expect(await domNodes(page), "list view bounded too").toBeLessThan(15000);
  });

  test("the event stream reconnects under load and the burst of the scenario is not lost", async ({ page, api }) => {
    let live: WebSocketRoute | undefined;
    let blocked = false;
    const urls: string[] = [];
    await page.routeWebSocket(/\/api\/v1\/events/, (ws) => {
      urls.push(ws.url());
      if (blocked) return void ws.close({ code: 1006 });
      live = ws;
      ws.connectToServer();
    });
    await loadHighLoad(api);
    await open(page, "/activity");
    await expect(eventStreamChip(page)).toContainText("online");
    await api.post("/tasks", { title: "E2E Vorlauf", priority: "P4" }); // the client resumes from the last sequence it saw
    await expect(page.getByRole("main").getByText("E2E Vorlauf").first()).toBeVisible({ timeout: 20_000 });

    const nav = page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: /Aufgaben/ });
    const openTasks = async (): Promise<number> => Number(/(\d+) offene Aufgaben/.exec((await nav.getAttribute("aria-label")) ?? (await nav.innerText()))?.[1] ?? NaN);
    const openBefore = await openTasks();
    expect(openBefore).toBeGreaterThan(0);

    blocked = true;
    live?.close({ code: 1006 });
    for (let i = 0; i < 25; i += 1) await api.post("/tasks", { title: `E2E Last ${i}`, priority: "P4" }); // missed while down
    await page.waitForTimeout(2000);
    const dropped = Date.now();
    blocked = false;
    await expect(eventStreamChip(page)).toContainText("online", { timeout: 45_000 });
    const recovery = Date.now() - dropped;
    note(`reconnect under load: online again ${recovery} ms after the server came back`);
    expect(urls.at(-1)).toMatch(/since=\d+/);
    expect(recovery).toBeLessThan(30_000);
    // the 25 tasks created while the socket was down arrive through the gap backfill / resync (the feed is sorted by
    // mock time, so the badge is the order-independent witness)
    await expect.poll(openTasks, { timeout: 30_000 }).toBeGreaterThanOrEqual(openBefore + 25);
  });
});

test.describe("orb render loop", () => {
  test("a background tab stops the orb's WebGL render loop and it resumes when visible again", async ({ page }) => {
    await installDrawCounter(page);
    await open(page, "/");
    await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
    await page.waitForTimeout(2000);
    const rate = async (label: string, minFrames = 8): Promise<number> => {
      const before = await page.evaluate(() => ({ quality: document.querySelector("[data-orb-root]")?.getAttribute("data-orb-quality"),
        probe: (window as unknown as { __ORB_DEBUG__?: { frames: number; draws: number } }).__ORB_DEBUG__ }));
      const start = await drawCalls(page);
      const startedAt = Date.now();
      if (minFrames === 0) await page.waitForTimeout(3000);
      else {
        do {
          await page.waitForTimeout(500);
        } while (Date.now() - startedAt < 12_000 &&
          (await page.evaluate(() => (window as unknown as { __ORB_DEBUG__?: { frames: number } }).__ORB_DEBUG__?.frames ?? 0)) - (before.probe?.frames ?? 0) < minFrames);
      }
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const result = ((await drawCalls(page)) - start) / elapsedSeconds;
      const after = await page.evaluate(() => ({ quality: document.querySelector("[data-orb-root]")?.getAttribute("data-orb-quality"),
        probe: (window as unknown as { __ORB_DEBUG__?: { frames: number; draws: number } }).__ORB_DEBUG__ }));
      note(`${label}: calls/s=${result.toFixed(1)}, elapsed=${elapsedSeconds.toFixed(2)}s, quality=${before.quality}->${after.quality}, frames=${before.probe?.frames}->${after.probe?.frames}, draws/frame=${before.probe?.draws}->${after.probe?.draws}`);
      return result;
    };
    const visibleRate = await rate("visible baseline");
    await rate("visible consecutive");
    await setTabHidden(page, true);
    await page.waitForTimeout(1500); // let in-flight frames drain
    const hiddenRate = await rate("hidden", 0);
    await setTabHidden(page, false);
    await page.waitForTimeout(1500);
    const resumedRate = await rate("resumed");
    note(`WebGL draw calls/s: visible ${visibleRate.toFixed(1)}, hidden ${hiddenRate.toFixed(1)}, resumed ${resumedRate.toFixed(1)}`);
    expect(visibleRate, "the orb renders while visible").toBeGreaterThan(5);
    expect(hiddenRate, "hidden tab: render loop stopped (<= 5 % of visible)").toBeLessThan(visibleRate * 0.05);
    expect(resumedRate, "resumes after becoming visible").toBeGreaterThan(visibleRate / 3);
  });
});

/**
 * GPU quality scaling (PLAN §51.6, §22.1). The orb's `auto` mode steps down when the frame time stays high. A software
 * renderer's real frame times say nothing about a GPU, so the test feeds the controller a synthetic frame time through the
 * test hook (`window.__FRIDAY_ORB_TEST__.frameMs`, only honoured while `features.devScenarios` is on) and reads the result
 * from `data-orb-quality` and the render probe `window.__ORB_DEBUG__`.
 */
interface OrbProbe { frames: number; quality: string; segments: number; plates: number; nodes: number; points: number; draws: number }
const probe = (page: import("@playwright/test").Page): Promise<OrbProbe | null> =>
  page.evaluate(() => (window as unknown as { __ORB_DEBUG__?: OrbProbe }).__ORB_DEBUG__ ?? null);
const qualityOf = async (page: import("@playwright/test").Page): Promise<string> => (await orbRoot(page).getAttribute("data-orb-quality")) ?? "";

test.describe("GPU quality scaling", () => {
  test("auto mode keeps its level at a healthy frame time and steps down to low when frames stay slow", async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      (window as unknown as { __FRIDAY_ORB_TEST__: unknown }).__FRIDAY_ORB_TEST__ = { frameMs: 6 };
    });
    await open(page, "/");
    await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
    const initial = await qualityOf(page);
    expect(["medium", "high"], "auto never starts at ultra and not at low").toContain(initial);
    await expect.poll(async () => (await probe(page))?.frames ?? 0, { timeout: 60_000 }).toBeGreaterThan(40);
    await page.waitForTimeout(6000);
    const rank = (level: string): number => ["low", "medium", "high", "ultra"].indexOf(level);
    expect(rank(await qualityOf(page)), "healthy frame time: no downgrade (a step up is allowed)").toBeGreaterThanOrEqual(rank(initial));

    // GPU load: the controller now sees 45 ms frames (p95 > 20 ms for 3 s) and walks down one level at a time
    const seen = new Set<string>([await qualityOf(page)]);
    await page.evaluate(() => {
      (window as unknown as { __FRIDAY_ORB_TEST__: unknown }).__FRIDAY_ORB_TEST__ = { frameMs: 45 };
      window.dispatchEvent(new Event("friday-orb-test"));
    });
    await expect
      .poll(async () => {
        seen.add(await qualityOf(page));
        return qualityOf(page);
      }, { timeout: 120_000, intervals: [500] })
      .toBe("low");
    note(`auto quality under 45 ms frames: ${[...seen].join(" -> ")}`);
    const low = await probe(page);
    expect(low?.quality).toBe("low");
  });

  test("low, medium, high and ultra change the number of drawn fragments and particles", async ({ page, api }) => {
    test.setTimeout(300_000);
    const orb = (await api.get("/settings")).body.data.orb;
    const counts: Record<string, OrbProbe> = {};
    for (const level of ["low", "medium", "high", "ultra"] as const) {
      await patchSettings(api, { orb: { ...orb, quality: level, animations: "full", renderMode: "3d" } });
      await open(page, "/");
      await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
      await expect(orbRoot(page)).toHaveAttribute("data-orb-quality", level);
      // the probe publishes the layer counters every 15th frame
      await expect.poll(async () => (await probe(page))?.segments ?? 0, { timeout: 90_000, intervals: [500] }).toBeGreaterThan(0);
      counts[level] = (await probe(page)) as OrbProbe;
    }
    note(`segments/plates/points: ${Object.entries(counts).map(([level, c]) => `${level} ${c.segments}/${c.plates}/${c.points}`).join(", ")}`);
    const order = ["low", "medium", "high", "ultra"];
    for (const key of ["segments", "plates", "points"] as const) {
      const values = order.map((level) => counts[level]![key]);
      for (let i = 1; i < values.length; i += 1) expect(values[i], `${key}: ${order[i]} draws more than ${order[i - 1]}`).toBeGreaterThan(values[i - 1]!);
    }
  });
});

/**
 * Orb soak (PLAN §51.6 "30 Minuten Orb ohne Memory Leak", owner order 22.10): the orb runs on the overview while the orb mode
 * changes every few seconds (state transitions are where per-state resources could leak) and the local voice path (microphone
 * facts, simulated speech envelope, service levels) is exercised through the event bridge on every round. The JS heap is
 * sampled after a forced GC; the render probe provides draw calls, geometries and textures. Console errors fail the run
 * (acceptance 22.10 "keine Console Errors").
 * Default run: 2 minutes. `E2E_SOAK=1`: 30 minutes. The budget compares the second half of the run with the first
 * stable sample, so one-off warm-up allocations do not count as growth.
 */
const SOAK_MINUTES = process.env.E2E_SOAK === "1" ? 30 : 2;
const MODES = ["working", "listening", "thinking", "speaking", "waiting_approval", "success", "warning", "idle"] as const;
const DRAW_CALL_BUDGET = 70;

test(`orb soak: ${SOAK_MINUTES} min of state changes keep JS heap, DOM, draw calls and GPU resources bounded, no console errors`, async ({ page, api }) => {
  test.setTimeout((SOAK_MINUTES + 4) * 60_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
  await page.waitForFunction(() => Boolean((window as unknown as { __FRIDAY_ORB__?: unknown }).__FRIDAY_ORB__));
  const cdp = await page.context().newCDPSession(page);
  const samples: Array<{ t: number; heap: number; nodes: number; draws: number; geometries: number; textures: number }> = [];
  const started = Date.now();
  const warmup = 20_000;
  let next = 0;
  let i = 0;
  const sample = async (): Promise<void> => {
    const p = await probe(page);
    samples.push({ t: Date.now() - started, heap: await heapUsed(cdp), nodes: await domNodes(page), draws: p?.draws ?? 0, geometries: (p as unknown as { geometries?: number })?.geometries ?? 0, textures: (p as unknown as { textures?: number })?.textures ?? 0 });
  };
  while (Date.now() - started < SOAK_MINUTES * 60_000) {
    await api.forceOrb(MODES[i % MODES.length]!, { audioLevel: (i % 5) / 5 });
    // local voice facts: microphone open/close, speech envelope start/stop, service levels
    await page.evaluate((round) => {
      const hook = (window as unknown as { __FRIDAY_ORB__: { bridge: Record<string, (...a: unknown[]) => void>; sources: Record<string, (...a: unknown[]) => void> } }).__FRIDAY_ORB__;
      hook.bridge.onMicrophoneOpened!({ source: "browser", passive: false });
      hook.sources.pushServiceInput!({ level: (round % 7) / 7, low: 0.3, mid: 0.2, high: 0.1 });
      hook.bridge.onTtsStarted!({ engine: "soak", hasAudioAnalysis: false });
      hook.sources.beginSpeech!({ hasAudioAnalysis: false });
      hook.sources.pushServiceOutput!({ level: (round % 5) / 5 });
    }, i);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const hook = (window as unknown as { __FRIDAY_ORB__: { bridge: Record<string, (...a: unknown[]) => void>; sources: Record<string, (...a: unknown[]) => void> } }).__FRIDAY_ORB__;
      hook.sources.endSpeech!(true);
      hook.bridge.onTtsEnded!({ interrupted: true });
      hook.bridge.onMicrophoneClosed!();
    });
    i += 1;
    await page.waitForTimeout(1500);
    if (Date.now() - started >= next) {
      await sample();
      next += SOAK_MINUTES === 30 ? 60_000 : 10_000;
    }
  }
  await sample();
  const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;
  note(`soak ${SOAK_MINUTES} min heap MB: ${samples.map((s) => mb(s.heap)).join(" ")}; DOM nodes: ${samples.map((s) => s.nodes).join(" ")}`);
  note(`draw calls: ${samples.map((s) => s.draws).join(" ")}; geometries: ${samples.map((s) => s.geometries).join(" ")}; textures: ${samples.map((s) => s.textures).join(" ")}`);

  const baseline = samples.find((sample) => sample.t >= warmup) ?? samples[0]!;
  const last = samples.at(-1)!;
  const growthMb = mb(last.heap) - mb(baseline.heap);
  const slopeMbPerMin = growthMb / Math.max(1, (last.t - baseline.t) / 60_000);
  note(`heap growth after warm-up: ${growthMb.toFixed(1)} MB (${slopeMbPerMin.toFixed(2)} MB/min)`);
  expect(growthMb, "JS heap growth after warm-up").toBeLessThan(SOAK_MINUTES === 30 ? 60 : 20);
  expect(slopeMbPerMin, "no sustained growth rate").toBeLessThan(1.5);
  expect(last.nodes - baseline.nodes, "DOM node count stays flat").toBeLessThan(200);
  const settled = samples.filter((s) => s.t >= warmup);
  expect(Math.max(...settled.map((s) => s.draws)), `draw calls stay within the budget of ${DRAW_CALL_BUDGET}`).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  expect(last.draws, "draw calls do not climb over the run").toBeLessThanOrEqual(Math.max(...settled.slice(0, Math.ceil(settled.length / 2)).map((s) => s.draws)) + 5);
  // (a sample is 0 while the probe is re-created after a renderer swap, so compare with the largest settled early value)
  const early = settled.slice(0, Math.ceil(settled.length / 2));
  expect(last.geometries, "no geometry is leaked").toBeLessThanOrEqual(Math.max(...early.map((s) => s.geometries)));
  expect(last.textures, "no texture is leaked").toBeLessThanOrEqual(Math.max(...early.map((s) => s.textures)));
  expect(consoleErrors, "no console errors during the soak").toEqual([]);
});
