import type { Page } from "@playwright/test";
import { test, expect, open } from "./support/fixtures";

/** PLAN Phase 11 / §8.9 / §12.5: a reload while the API is unreachable shows the last data, marked as offline cache. */
const STORAGE_KEY = "friday.offlineCache.v1";
const readCache = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);

async function waitForSnapshot(page: Page, minQueries = 3): Promise<string> {
  await expect
    .poll(async () => {
      const raw = await readCache(page);
      return raw ? (JSON.parse(raw) as { queries: unknown[] }).queries.length : 0;
    }, { timeout: 20_000, message: "offline cache snapshot written" })
    .toBeGreaterThanOrEqual(minQueries);
  return (await readCache(page)) as string;
}

const blockApi = (page: Page) => page.route("**/api/**", (route) => route.abort("connectionrefused"));

test("a reload while the API is unreachable shows the last tasks marked offline-cache, without crashing", async ({ page }) => {
  await open(page, "/tasks");
  const board = page.getByRole("group", { name: "Kanban-Board" });
  await expect(board.getByRole("article").first()).toBeVisible();
  const titlesBefore = await board.getByRole("article").evaluateAll((nodes) => nodes.slice(0, 3).map((node) => node.querySelector("h3, h4, [class*=title]")?.textContent?.trim() ?? ""));
  await waitForSnapshot(page);

  await blockApi(page);
  await page.reload();

  const banner = page.getByTestId("offline-cache-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText("Control API ist nicht erreichbar");
  await expect(banner.getByText("Offline-Cache")).toBeVisible();
  await expect(banner).toContainText(/vor \d+ (Sek|Min|Std)|gerade|jetzt/i);
  await expect(page.getByRole("main", { name: "Hauptinhalt" })).toBeVisible();
  await expect(board.getByRole("article").first()).toBeVisible();
  await expect(page.getByRole("main").getByText("Offline-Cache").first()).toBeVisible();
  for (const title of titlesBefore.filter(Boolean)) await expect(board.getByText(title, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Etwas ist schiefgelaufen|Application error/i)).toHaveCount(0);
});

test("other cached pages work offline: overview and approvals show their last data", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByRole("region", { name: /Live-Intelligenz|Aufmerksamkeit/ }).or(page.locator(".ov-cell--attention-feed")).first()).toBeVisible();
  await page.goto("/approvals");
  await expect(page.getByRole("main").getByRole("article").first()).toBeVisible();
  await waitForSnapshot(page, 5);

  await blockApi(page);
  await page.goto("/approvals");
  await expect(page.getByTestId("offline-cache-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("main").getByRole("article").first()).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "Benachrichtigungen" }).waitFor({ state: "visible" });
  await page.goto("/");
  await expect(page.getByTestId("offline-cache-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".ov-cell--attention-feed")).toBeVisible();
  await expect(page.locator(".ov-cell--ai-core-orb")).toBeVisible();
});

test("the stored cache holds no session, token, CSRF value or audit data", async ({ page }) => {
  await open(page, "/");
  await page.goto("/approvals");
  const raw = await waitForSnapshot(page);
  const stored = JSON.parse(raw) as { identity: Record<string, unknown>; queries: Array<{ key: unknown[] }> };
  const roots = new Set(stored.queries.map((entry) => String(entry.key[0])));
  for (const forbidden of ["auth", "audit", "memory", "files", "communication-threads", "communication-drafts", "commands", "adapters"]) expect(roots.has(forbidden), forbidden).toBe(false);
  expect(Object.keys(stored.identity).sort()).toEqual(["displayName", "role", "userId"]);
  const cookies = await page.context().cookies();
  for (const cookie of cookies) expect(raw, `cookie ${cookie.name} must not be persisted`).not.toContain(cookie.value);
  expect(raw).not.toMatch(/csrfToken|approvalToken|X-Approval-Token/i);
});

test("recovery: when the API is back the banner disappears and live data returns without a manual reload", async ({ page }) => {
  await open(page, "/tasks");
  await expect(page.getByRole("group", { name: "Kanban-Board" }).getByRole("article").first()).toBeVisible();
  await waitForSnapshot(page);
  await blockApi(page);
  await page.reload();
  await expect(page.getByTestId("offline-cache-banner")).toBeVisible({ timeout: 30_000 });

  await page.unroute("**/api/**");
  await expect(page.getByTestId("offline-cache-banner")).toBeHidden({ timeout: 45_000 });
  await expect(page.getByRole("banner").getByText(/Event-Stream/)).toContainText(/online|eingeschränkt/, { timeout: 45_000 });
  await expect(page.getByRole("group", { name: "Kanban-Board" }).getByRole("article").first()).toBeVisible();
});
