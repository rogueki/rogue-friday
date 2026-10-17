import type { Page } from "@playwright/test";
import { test, expect, orbRoot } from "./support/fixtures";
import { orbProbe, type Rect } from "./support/orb";

/**
 * Owner order 22.1 "Position": the orb is centred in the AI-core stage, nothing of it (glow, particles, outer rings,
 * fragments, pulse rings) is clipped, and the visible orb fills 65-78 % of the usable panel height. The measurement comes
 * from the render probe (`window.__ORB_DEBUG__.bboxPx` = visible orb extent in canvas pixels, placed with the canvas element's box), so it measures what the renderer drew rather than what the CSS promises.
 *
 * Browser zoom 80/100/125 % is the same layout viewport as a larger/smaller window at the same device size:
 * viewport / zoom CSS pixels with deviceScaleFactor = zoom.
 */
const SIZES = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "3840x2160", width: 3840, height: 2160 },
] as const;
const ZOOMS = [0.8, 1, 1.25] as const;

/** No event-stream wait: layout needs no live events, and a software-rendered orb can starve the socket handshake at large sizes. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("main", { name: "Hauptinhalt" })).toBeVisible();
}

const CENTER_TOLERANCE_PX = 3;
const FILL_MIN = 0.65;
const FILL_MAX = 0.78;

test.describe("orb position (acceptance 22.1)", () => {
  test.setTimeout(240_000);

  for (const size of SIZES) {
    for (const zoom of ZOOMS) {
      test(`${size.name} at ${Math.round(zoom * 100)} % zoom: centred, unclipped, 65-78 % of the usable stage`, async ({ page }) => {
        const cssWidth = Math.round(size.width / zoom);
        const cssHeight = Math.round(size.height / zoom);
        await page.setViewportSize({ width: cssWidth, height: cssHeight });
        await open(page, "/");
        await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
        await expect.poll(async () => (await orbProbe(page))?.frames ?? 0, { timeout: 90_000, intervals: [500] }).toBeGreaterThan(10);

        const probe = await orbProbe(page);
        expect(probe?.bboxPx, "probe.bboxPx is published").toBeTruthy();
        const canvasBox = (await orbRoot(page).locator("canvas").first().boundingBox()) as Rect;
        const stage = (await orbRoot(page).boundingBox()) as Rect;
        expect(canvasBox && stage).toBeTruthy();
        const canvas: Rect = canvasBox;
        const box: Rect = { x: canvas.x + probe!.bboxPx!.x, y: canvas.y + probe!.bboxPx!.y, width: probe!.bboxPx!.w, height: probe!.bboxPx!.h };
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const note = `${size.name} @${zoom}: stage ${stage.width.toFixed(0)}x${stage.height.toFixed(0)}, orb ${box.width.toFixed(0)}x${box.height.toFixed(0)}, centre offset ${(cx - (stage.x + stage.width / 2)).toFixed(1)}/${(cy - (stage.y + stage.height / 2)).toFixed(1)}`;
        test.info().annotations.push({ type: "layout", description: note });
        console.log(`[layout] ${note}`);

        expect(Math.abs(cx - (stage.x + stage.width / 2)), `horizontal centre (${note})`).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
        expect(Math.abs(cy - (stage.y + stage.height / 2)), `vertical centre (${note})`).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);

        // Nothing leaves the canvas and the canvas does not leave the stage.
        expect(box.x, "left edge inside canvas").toBeGreaterThanOrEqual(canvas!.x - 0.5);
        expect(box.y, "top edge inside canvas").toBeGreaterThanOrEqual(canvas!.y - 0.5);
        expect(box.x + box.width, "right edge inside canvas").toBeLessThanOrEqual(canvas!.x + canvas!.width + 0.5);
        expect(box.y + box.height, "bottom edge inside canvas").toBeLessThanOrEqual(canvas!.y + canvas!.height + 0.5);
        expect(canvas!.x, "canvas inside stage (left)").toBeGreaterThanOrEqual(stage.x - 0.5);
        expect(canvas!.y, "canvas inside stage (top)").toBeGreaterThanOrEqual(stage.y - 0.5);
        expect(canvas!.x + canvas!.width, "canvas inside stage (right)").toBeLessThanOrEqual(stage.x + stage.width + 0.5);
        expect(canvas!.y + canvas!.height, "canvas inside stage (bottom)").toBeLessThanOrEqual(stage.y + stage.height + 0.5);

        const diameter = Math.max(box.width, box.height);
        // usable area = the stage (canvas fills it; fillRatio applies to it)
        const usable = Math.min(stage.height, stage.width);
        expect(diameter / usable, `fill ratio (${note})`).toBeGreaterThanOrEqual(FILL_MIN);
        expect(diameter / usable, `fill ratio (${note})`).toBeLessThanOrEqual(FILL_MAX);
      });
    }
  }

  test("the brand label and the status strip do not overlap the orb at 1366x768", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await open(page, "/");
    await expect.poll(async () => (await orbProbe(page))?.frames ?? 0, { timeout: 90_000, intervals: [500] }).toBeGreaterThan(10);
    const bb = (await orbProbe(page))!.bboxPx!;
    const canvas = (await orbRoot(page).locator("canvas").first().boundingBox()) as Rect;
    const orb: Rect = { x: canvas.x + bb.x, y: canvas.y + bb.y, width: bb.w, height: bb.h };
    for (const selector of [".ov-orb__brand", ".ov-orb__status"]) {
      const box = (await page.locator(selector).first().boundingBox()) as Rect;
      const overlapY = Math.min(box.y + box.height, orb.y + orb.height) - Math.max(box.y, orb.y);
      const overlapX = Math.min(box.x + box.width, orb.x + orb.width) - Math.max(box.x, orb.x);
      expect(overlapX > 0 && overlapY > 0, `${selector} overlaps the visible orb (${JSON.stringify(box)} vs ${JSON.stringify(orb)})`).toBe(false);
    }
  });
});
