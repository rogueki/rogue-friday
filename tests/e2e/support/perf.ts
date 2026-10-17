import type { CDPSession, Page } from "@playwright/test";

export interface FrameStats {
  frames: number;
  durationMs: number;
  p50: number;
  p95: number;
  max: number;
  /** Sum of main-thread long tasks (> 50 ms) in ms. */
  longTaskMs: number;
}

/** Records rAF frame deltas and long tasks while `action` runs (e.g. a scroll sequence). */
export async function measureFrames(page: Page, action: () => Promise<void>): Promise<FrameStats> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames?: { deltas: number[]; long: number; stop: boolean } };
    const state = { deltas: [] as number[], long: 0, stop: false, startedAt: performance.now() };
    w.__frames = state;
    let last = performance.now();
    const tick = (now: number): void => {
      state.deltas.push(now - last);
      last = now;
      if (!state.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.long += entry.duration;
      }).observe({ type: "longtask", buffered: false });
    } catch {
      /* longtask unsupported: long = 0 */
    }
  });
  await action();
  return page.evaluate(() => {
    const state = (window as unknown as { __frames: { deltas: number[]; long: number; stop: boolean; startedAt: number } }).__frames;
    state.stop = true;
    const sorted = [...state.deltas].slice(1).sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    return { frames: sorted.length, durationMs: performance.now() - state.startedAt, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0, longTaskMs: state.long };
  });
}

/** Wheel-scrolls `steps` times by `delta` px with a short pause; positions the pointer over `x,y` first. */
export async function wheelScroll(page: Page, x: number, y: number, steps: number, delta = 420, pauseMs = 40): Promise<void> {
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(pauseMs);
  }
}

/** JS heap in bytes after a forced GC (CDP; no browser flag needed). */
export async function heapUsed(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
  return usedSize;
}

export const domNodes = (page: Page): Promise<number> => page.evaluate(() => document.getElementsByTagName("*").length);

/** Counts WebGL draw calls (the orb renders through WebGL; other rAF users such as CSS-in-JS must not count). */
export async function installDrawCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __draws: number };
    w.__draws = 0;
    for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype] as unknown as Array<Record<string, unknown>>) {
      for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
        const original = proto[name] as (...args: unknown[]) => unknown;
        if (typeof original !== "function") continue;
        proto[name] = function (this: unknown, ...args: unknown[]) {
          w.__draws += 1;
          return original.apply(this, args);
        };
      }
    }
  });
}

export const drawCalls = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __draws: number }).__draws);

/** Emulates a background tab for the page's own logic (document.hidden / visibilityState / visibilitychange). */
export async function setTabHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (value ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
