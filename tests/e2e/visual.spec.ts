import { test, expect, open, orbRoot, expectOrbMode, freezeDate, patchSettings, eventStreamChip, ORB_MODES } from "./support/fixtures";
import type { ApiClient } from "./support/api";
import type { Page } from "@playwright/test";

/**
 * PLAN §51.4 Visual regression, §52 orb testability.
 *
 * Determinism (why the baselines are stable):
 *  - seed 42 + simulated clock reset to 08:15 before every test (fixtures.ts `cleanWorld`);
 *  - the browser `Date` is frozen (`freezeDate`), so the top-bar clock and every relative time ("vor 11 Std.") are constant;
 *  - the orb runs with `animations: "off"`. That is a product mode (PLAN §25/§45.13): the 3D scene switches to the static
 *    2D renderer, which is a pure function of the orb state - byte-identical across runs (verified). A live 3D WebGL
 *    frame is a function of wall-clock time (the web app does not expose the orb test clock `fixedTime`/`animationProgress`
 *    of PLAN §52.1, see tests/e2e/README.md "Gaps"), so 3D pixels cannot be baselined; 3D is covered by smoke checks
 *    (non-blank canvas, mode attributes) in orb-3d-smoke below.
 *  - the only live value left, the event-stream latency chip, is masked.
 */
/** Wall-clock / live-metric spots that are not part of the design: stream latency, "Aktualisiert hh:mm" (server wall clock), host metrics. */
const MASK_LIVE = (page: Page) => [
  eventStreamChip(page),
  page.getByText(/^Aktualisiert \d/),
  page.getByRole("region", { name: "Systemmonitor" }),
  page.getByText("Netzwerk", { exact: true }).locator(".."),
];

async function prepare(page: Page, api: ApiClient, opts: { motion?: "off" | "reduced"; renderMode?: "auto" | "2d" } = {}): Promise<void> {
  const settings = (await api.get("/settings")).body.data;
  await patchSettings(api, { orb: { ...settings.orb, animations: opts.motion ?? "off", renderMode: opts.renderMode ?? "auto" } });
  await freezeDate(page);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(900);
}

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: MASK_LIVE(page), fullPage: opts.fullPage ?? false, timeout: 90_000 });
}

const PAGES: ReadonlyArray<readonly [string, string]> = [
  ["overview", "/"], ["tasks", "/tasks"], ["activity", "/activity"], ["memory", "/memory"], ["agents", "/agents"],
  ["approvals", "/approvals"], ["communication", "/communication"], ["calendar", "/calendar"], ["automations", "/automations"],
  ["research", "/research"], ["files", "/files"], ["voice", "/voice"], ["alerts", "/alerts"], ["system", "/system"],
  ["audit", "/audit"], ["settings", "/settings"], ["dev-scenarios", "/dev/scenarios"],
];

test.describe("orb states (static 2D render, 14 modes)", () => {
  test("every orb mode", async ({ page, api }) => {
    test.setTimeout(240_000);
    await prepare(page, api);
    await open(page, "/");
    for (const mode of ORB_MODES) {
      await api.forceOrb(mode);
      await expectOrbMode(page, mode);
      await settle(page);
      await expect(orbRoot(page)).toHaveScreenshot(`orb-${mode}.png`, { mask: [page.getByText(/^Aktualisiert \d/)] });
    }
  });

  test("low quality", async ({ page, api }) => {
    const settings = (await api.get("/settings")).body.data;
    await patchSettings(api, { orb: { ...settings.orb, animations: "off", quality: "low" } });
    await freezeDate(page);
    await api.forceOrb("working");
    await open(page, "/");
    await expectOrbMode(page, "working");
    await expect(orbRoot(page)).toHaveAttribute("data-orb-quality", "low");
    await settle(page);
    await expect(orbRoot(page)).toHaveScreenshot("orb-working-low-quality.png", { mask: [page.getByText(/^Aktualisiert \d/)] });
  });

  test("reduced motion (OS preference, orb animations off)", async ({ page, api }) => {
    // The orb setting "reduced" still breathes subtly in the 2D renderer (not byte-stable), so the baseline combines the
    // OS preference with the static mode; the "reduced" setting itself is asserted structurally in a11y.spec.ts.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await prepare(page, api);
    await api.forceOrb("thinking");
    await open(page, "/");
    await expectOrbMode(page, "thinking");
    await settle(page);
    await expect(orbRoot(page)).toHaveScreenshot("orb-thinking-reduced-motion.png", { mask: [page.getByText(/^Aktualisiert \d/)] });
  });

  test("3D smoke: the WebGL canvas draws something (pixels are time-dependent, so no baseline)", async ({ page, api }) => {
    await api.forceOrb("working");
    await open(page, "/");
    await expect(orbRoot(page)).toHaveAttribute("data-orb-renderer", "3d");
    await expect(orbRoot(page)).toHaveAttribute("data-orb-webgl", "yes");
    await page.waitForTimeout(2500);
    const shot3d = await orbRoot(page).screenshot({ animations: "allow", timeout: 60_000 });
    const lit = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      let golden = 0;
      for (let i = 0; i < data.length; i += 16) {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (r + g + b > 150) bright += 1;
        if (r > 150 && g > 90 && b < g) golden += 1;
      }
      return { bright: bright / (data.length / 16), golden: golden / (data.length / 16) };
    }, shot3d.toString("base64"));
    expect(lit.bright, "orb area is not black").toBeGreaterThan(0.01);
    expect(lit.golden, "gold/amber identity present").toBeGreaterThan(0.003);
  });
});

test.describe("core pages 1920x1080", () => {
  for (const [name, route] of PAGES) {
    test(name, async ({ page, api }) => {
      await prepare(page, api);
      await open(page, route);
      await shot(page, `${name}-1080p`);
    });
  }
});

test.describe("other sizes", () => {
  test("overview 1440p (2560x1440)", async ({ page, api }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await prepare(page, api);
    await open(page, "/");
    await shot(page, "overview-1440p");
  });
  test("tasks 1440p", async ({ page, api }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await prepare(page, api);
    await open(page, "/tasks");
    await shot(page, "tasks-1440p");
  });
  test("approvals 1440p", async ({ page, api }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await prepare(page, api);
    await open(page, "/approvals");
    await shot(page, "approvals-1440p");
  });
  test("overview 4K (3840x2160)", async ({ page, api }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 3840, height: 2160 });
    await prepare(page, api);
    await open(page, "/");
    await shot(page, "overview-4k");
  });
  for (const [name, route] of [["overview", "/"], ["tasks", "/tasks"], ["approvals", "/approvals"], ["settings", "/settings"]] as const) {
    test(`${name} tablet 1024x768`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await prepare(page, api);
      await open(page, route);
      await shot(page, `${name}-tablet`);
    });
  }
});

test.describe("reduced motion", () => {
  for (const [name, route] of [["overview", "/"], ["tasks", "/tasks"]] as const) {
    test(`${name}`, async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await prepare(page, api);
      await open(page, route);
      await shot(page, `${name}-reduced-motion`);
    });
  }
});

test.describe("long German text profile (scenario long-german-text)", () => {
  async function play(api: ApiClient): Promise<void> {
    await api.play("long-german-text", 10);
    await expect.poll(async () => (await api.get("/dev/scenarios/state")).body.data.running, { timeout: 15_000 }).toBe(false);
  }
  for (const [name, route] of [["overview", "/"], ["tasks", "/tasks"], ["approvals", "/approvals"], ["communication", "/communication"], ["alerts", "/alerts"]] as const) {
    test(`${name} 1080p`, async ({ page, api }) => {
      await play(api);
      await prepare(page, api);
      await open(page, route);
      await shot(page, `${name}-long-german-1080p`);
    });
  }
  for (const [name, route] of [["overview", "/"], ["tasks", "/tasks"]] as const) {
    test(`${name} tablet`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await play(api);
      await prepare(page, api);
      await open(page, route);
      await shot(page, `${name}-long-german-tablet`);
    });
  }
  test("no layout overflow with the long German titles (checked as numbers, independent of pixels)", async ({ page, api }) => {
    await play(api);
    await prepare(page, api);
    for (const route of ["/", "/tasks", "/approvals", "/communication", "/memory", "/calendar"]) {
      await open(page, route);
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal page overflow on ${route}`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("states", () => {
  for (const scenario of ["partial-outage", "critical-alert", "approval-waiting", "empty-new-installation"] as const) {
    test(`overview in scenario ${scenario}`, async ({ page, api }) => {
      await api.play(scenario, 10);
      await expect.poll(async () => (await api.get("/dev/scenarios/state")).body.data.running, { timeout: 120_000 }).toBe(false);
      await prepare(page, api);
      await open(page, "/");
      await shot(page, `overview-${scenario}`);
    });
  }
});
