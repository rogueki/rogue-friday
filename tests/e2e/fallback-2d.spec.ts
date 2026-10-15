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
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
  await api.play("webgl-failure", 10);
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "2d", { timeout: 30_000 });
  await expectOrbMode(page, "working", 30_000);
  await expect(page.getByRole("main")).toContainText("2D-Darstellung aktiv"); // the panel hint for the fallback renderer
  await page.getByRole("link", { name: "Aufgaben" }).click(); // the rest of the app is not affected
  await expect(page.getByRole("group", { name: "Kanban-Board" })).toBeVisible();
  await api.reset(); // the hint is cleared with the scenario, the running orb returns to 3D
  await open(page, "/");
  await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
});

test("the Control API exposes the scenario UI hints in GET /meta", async ({ api }) => {
  expect((await api.get("/meta")).body.features.forceOrbFallback2D).toBeFalsy();
  await api.play("webgl-failure", 10);
  await expect.poll(async () => (await api.get("/meta")).body.features.forceOrbFallback2D).toBe(true);
  await api.reset();
  await expect.poll(async () => (await api.get("/meta")).body.features.forceOrbFallback2D).toBeFalsy();
});

/** PLAN §45.13: the scenario forces reduced motion; every orb state keeps its information. */
test("scenario 'reduced-motion' switches the running app to reduced motion without a reload", async ({ page, api }) => {
  await open(page, "/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await api.play("reduced-motion", 10);
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced", { timeout: 30_000 });
  await expect.poll(async () => (await api.get("/dev/scenarios/state")).body.data.running, { timeout: 30_000 }).toBe(false);
  await page.waitForTimeout(500);
  const running = await page.evaluate(() =>
    document.getAnimations().filter((animation) => animation.playState === "running" && (animation.effect?.getTiming().iterations ?? 1) === Infinity).length,
  );
  expect(running, "no infinite animation while the scenario forces reduced motion").toBe(0);
  for (const mode of ["thinking", "speaking", "error"]) {
    await api.forceOrb(mode);
    await expectOrbMode(page, mode);
    await expect(orbRoot(page).getByRole("status")).not.toBeEmpty(); // information stays complete (text state)
  }
  await api.reset();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full", { timeout: 30_000 });
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
