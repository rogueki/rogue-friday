import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { ApiClient } from "./api";
import { API_ORIGIN } from "./constants";

type Settings = Record<string, unknown> & { version: number };

/** Worker-wide state: the owner API session and the settings of a fresh instance (restored before every test). */
interface WorkerFixtures {
  api: ApiClient;
  baselineSettings: Settings;
}

interface TestFixtures {
  /** Resets world + settings to the seeded baseline before the test (auto). */
  cleanWorld: void;
  /** Fails the test on uncaught page exceptions (auto). Console errors are not fatal: reconnect tests provoke them on purpose. */
  pageErrors: string[];
  /** Keeps the optional first-run popup out of unrelated flows and visual baselines. */
  snoozedOnboarding: void;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  api: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern for "no dependencies"
    async ({}, use) => {
      await use(await ApiClient.login("owner"));
    },
    { scope: "worker" },
  ],
  baselineSettings: [
    async ({ api }, use) => {
      const result = await api.get("/settings");
      const settings = result.body.data as Settings;
      const orb = settings.orb as { animations: string; renderMode: string; quality: string };
      if (orb.animations !== "full" || orb.renderMode !== "auto" || orb.quality !== "auto") {
        throw new Error("Der E2E-Stack ist nicht unberührt (Orb-Einstellungen verändert): bitte den Stack neu starten.");
      }
      await use(settings);
    },
    { scope: "worker" },
  ],
  cleanWorld: [
    async ({ api, baselineSettings }, use) => {
      await api.reset();
      await restoreSettings(api, baselineSettings);
      await use();
      await restoreSettings(api, baselineSettings); // leave a clean instance behind, also after a failed test
    },
    { auto: true },
  ],
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors, "uncaught page exceptions").toEqual([]);
    },
    { auto: true },
  ],
  snoozedOnboarding: [
    async ({ page }, use) => {
      await page.addInitScript((origin) => {
        if (location.origin !== origin) return;
        try {
          sessionStorage.setItem("friday-onboarding-later", "1");
        } catch {
          // Storage can be unavailable in opaque documents during security and iframe tests.
        }
      }, API_ORIGIN);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/** PATCH /settings replaces whole areas; put back every area that differs from the baseline. */
export async function restoreSettings(api: ApiClient, baseline: Settings): Promise<void> {
  const current = (await api.get("/settings")).body.data as Settings;
  const patch: Record<string, unknown> = {};
  for (const [area, value] of Object.entries(baseline)) {
    if (area === "version" || area === "updatedAt") continue;
    if (JSON.stringify(current[area]) !== JSON.stringify(value)) patch[area] = value;
  }
  if (Object.keys(patch).length === 0) return;
  const result = await api.request("PATCH", "/settings", patch, { "If-Match": String(current.version) });
  if (result.status !== 200) throw new Error(`Settings-Wiederherstellung fehlgeschlagen: ${result.status} ${JSON.stringify(result.body)}`);
}

/** Patches settings areas through the API (as the settings page does), against the current version. */
export async function patchSettings(api: ApiClient, patch: Record<string, unknown>): Promise<void> {
  const current = (await api.get("/settings")).body.data as Settings;
  const result = await api.request("PATCH", "/settings", patch, { "If-Match": String(current.version) });
  if (result.status !== 200) throw new Error(`PATCH /settings fehlgeschlagen: ${result.status} ${JSON.stringify(result.body)}`);
}

export const ORB_MODES = [
  "booting", "idle", "listening", "transcribing", "thinking", "syncing", "working", "speaking",
  "waiting_approval", "success", "warning", "error", "offline", "paused",
] as const;
export type OrbModeName = (typeof ORB_MODES)[number];

/** Opens a page of the built app and waits until the shell and the page region rendered. */
export async function open(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("main", { name: "Hauptinhalt" })).toBeVisible();
  // The menu collapses on tablet widths, so only wide viewports are expected to show it.
  // Wait for the event stream: a state forced right after the page load would otherwise race the socket subscription.
  if ((page.viewportSize()?.width ?? 1920) >= 1280) {
    await expect(eventStreamChip(page)).toContainText(/online|eingeschränkt/);
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
  }
}

/** The orb(s) on the page by their wrapper; the overview shows one in the AI-core panel. */
export const orbRoot = (page: Page): Locator => page.locator("[data-orb-root]").first();

export async function expectOrbMode(page: Page, mode: string, timeout = 15_000): Promise<void> {
  await expect(orbRoot(page)).toHaveAttribute("data-orb-mode", mode, { timeout });
}

/**
 * Pins the browser's notion of "now" into the mock world's day (seed data lives on 14.10.2026): `Date` is frozen (timers
 * and rAF keep running) and GET /meta reports the same `serverTime`, because the web app derives its clock skew from it.
 * Without the second half, seed expiry times ("läuft ab", "Abgelaufen") would depend on the real date the suite runs on.
 */
export async function freezeDate(page: Page, iso = "2026-10-14T08:15:30.000Z"): Promise<void> {
  await page.clock.setFixedTime(new Date(iso));
  await page.route("**/api/v1/meta", async (route) => {
    try {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...body, serverTime: iso } });
    } catch {
      // the page navigated away / closed while the request was in flight: nothing left to patch
      await route.continue().catch(() => undefined);
    }
  });
}

/** Waits for the websocket status chip of the top bar ("Event-Stream online ..."). */
export const eventStreamChip = (page: Page): Locator => page.getByRole("banner").getByText(/Event-Stream/);
