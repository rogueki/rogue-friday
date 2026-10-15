import { chromium } from "@playwright/test";
import { test, expect, open, orbRoot, expectOrbMode, patchSettings } from "./support/fixtures";
import { launchOptions, NO_GL_ARGS } from "./support/browser";
import { API_ORIGIN } from "./support/constants";

/** PLAN §51.5 2D fallback, §45.14: the orb keeps all states and texts without WebGL; the page stays usable. */
test("renderer setting '2D' draws the fallback with the same states and texts", async ({ page, api }) => {
  const orb = (await api.get("/settings")).body.data.orb;
  await patchSettings(api, { orb: { ...orb, renderMode: "2d" } });
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "2d");
  await expect(orbRoot(page).locator("canvas")).toHaveCount(1);
  await api.forceOrb("speaking");
  await expectOrbMode(page, "speaking");
  await expect(orbRoot(page).getByRole("status")).toContainText("F.R.I.D.A.Y. spricht.");
});

test("scenario 'webgl-failure' switches the running orb to the 2D fallback and the overview stays operable", async ({ page, api }) => {
  // KNOWN GAP (reported, not fixed here: apps/ is out of scope): the built Control API's GET /meta builds `features`
  // itself (apps/control-api/src/handlers/meta.ts) and drops the world's uiHints (forceOrbFallback2D / reducedMotion) that
  // the scenarios set (MockWorld.meta does include them, standalone MSW mode works). Playing the scenario therefore never
  // reaches the browser. Playwright flips this to a failure ("expected to fail but passed") once /meta carries the hints.
  test.fail(true, "Control API /meta omits world uiHints, so scenario webgl-failure has no effect in the real stack");
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
  await api.play("webgl-failure", 10);
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "2d", { timeout: 30_000 });
  await expectOrbMode(page, "working", 30_000);
  await expect(page.getByRole("main")).toContainText(/WebGL/i); // the hint "WebGL nicht verfügbar"
  await page.getByRole("link", { name: "Aufgaben" }).click(); // the rest of the app is not affected
  await expect(page.getByRole("group", { name: "Kanban-Board" })).toBeVisible();
});

test("a browser without WebGL falls back to 2D on its own and the orb click still opens details", async ({ api }) => {
  await api.forceOrb("working");
  const browser = await chromium.launch(launchOptions(NO_GL_ARGS));
  try {
    const context = await browser.newContext({ baseURL: API_ORIGIN, viewport: { width: 1920, height: 1080 }, locale: "de-DE" });
    const page = await context.newPage();
    const probe = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl") ?? document.createElement("canvas").getContext("webgl2")));
    expect(probe, "WebGL is really unavailable in this browser").toBe(false);
    await open(page, "/");
    await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "2d");
    await expectOrbMode(page, "working");
    await expect(page.getByRole("complementary").first()).toContainText("F.R.I.D.A.Y.");
    await orbRoot(page).getByRole("button", { name: /^Orb: Details öffnen\./ }).click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
  } finally {
    await browser.close();
  }
});
