import { test, expect, open, orbRoot, eventStreamChip } from "./support/fixtures";
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
    note(`idle p50=${idle.p50.toFixed(1)}ms p95=${idle.p95.toFixed(1)}ms | scroll frames=${stats.frames} p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.max.toFixed(0)}ms longTasks=${stats.longTaskMs.toFixed(0)}ms`);
    expect(stats.frames).toBeGreaterThan(20);
    expect(stats.p95, "scroll p95 frame time vs idle (x2.5 + 150 ms slack)").toBeLessThan(idle.p95 * 2.5 + 150);
    expect(stats.longTaskMs, "main-thread long tasks during 40 wheel steps").toBeLessThan(4000);
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
    const rate = async (): Promise<number> => {
      const start = await drawCalls(page);
      await page.waitForTimeout(3000);
      return ((await drawCalls(page)) - start) / 3;
    };
    const visibleRate = await rate();
    await setTabHidden(page, true);
    await page.waitForTimeout(1500); // let in-flight frames drain
    const hiddenRate = await rate();
    await setTabHidden(page, false);
    await page.waitForTimeout(1500);
    const resumedRate = await rate();
    note(`WebGL draw calls/s: visible ${visibleRate.toFixed(1)}, hidden ${hiddenRate.toFixed(1)}, resumed ${resumedRate.toFixed(1)}`);
    expect(visibleRate, "the orb renders while visible").toBeGreaterThan(5);
    expect(hiddenRate, "hidden tab: render loop stopped (<= 5 % of visible)").toBeLessThan(visibleRate * 0.05);
    expect(resumedRate, "resumes after becoming visible").toBeGreaterThan(visibleRate / 3);
  });
});

/**
 * Orb soak (PLAN §51.6 "30 Minuten Orb ohne Memory Leak"): the orb runs on the overview while the orb mode changes every
 * few seconds (state transitions are where per-state resources could leak). The JS heap is sampled after a forced GC.
 * Default run: 2 minutes. `E2E_SOAK=1`: 30 minutes. The budget compares the second half of the run with the first
 * stable sample, so one-off warm-up allocations do not count as growth.
 */
const SOAK_MINUTES = process.env.E2E_SOAK === "1" ? 30 : 2;
const MODES = ["working", "listening", "thinking", "speaking", "waiting_approval", "success", "warning", "idle"] as const;

test(`orb soak: ${SOAK_MINUTES} min of state changes keep JS heap and DOM bounded`, async ({ page, api }) => {
  test.setTimeout((SOAK_MINUTES + 4) * 60_000);
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
  const cdp = await page.context().newCDPSession(page);
  const samples: Array<{ t: number; heap: number; nodes: number }> = [];
  const started = Date.now();
  const warmup = 20_000;
  let next = 0;
  let i = 0;
  while (Date.now() - started < SOAK_MINUTES * 60_000) {
    await api.forceOrb(MODES[i % MODES.length]!, { audioLevel: (i % 5) / 5 });
    i += 1;
    await page.waitForTimeout(3000);
    if (Date.now() - started >= next) {
      samples.push({ t: Date.now() - started, heap: await heapUsed(cdp), nodes: await domNodes(page) });
      next += SOAK_MINUTES === 30 ? 60_000 : 10_000;
    }
  }
  samples.push({ t: Date.now() - started, heap: await heapUsed(cdp), nodes: await domNodes(page) });
  const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;
  note(`soak ${SOAK_MINUTES} min heap MB: ${samples.map((s) => mb(s.heap)).join(" ")}; DOM nodes: ${samples.map((s) => s.nodes).join(" ")}`);

  const baseline = samples.find((sample) => sample.t >= warmup) ?? samples[0]!;
  const last = samples.at(-1)!;
  const growthMb = mb(last.heap) - mb(baseline.heap);
  const slopeMbPerMin = growthMb / Math.max(1, (last.t - baseline.t) / 60_000);
  note(`heap growth after warm-up: ${growthMb.toFixed(1)} MB (${slopeMbPerMin.toFixed(2)} MB/min)`);
  expect(growthMb, "JS heap growth after warm-up").toBeLessThan(SOAK_MINUTES === 30 ? 60 : 20);
  expect(slopeMbPerMin, "no sustained growth rate").toBeLessThan(1.5);
  expect(last.nodes - baseline.nodes, "DOM node count stays flat").toBeLessThan(200);
});
