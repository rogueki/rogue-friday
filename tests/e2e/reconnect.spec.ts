import { test, expect, open, eventStreamChip } from "./support/fixtures";
import type { Page, WebSocketRoute } from "@playwright/test";

/**
 * PLAN §51.5 reconnect. The event socket is proxied with `routeWebSocket`, so the test can drop it exactly like a
 * network failure and refuse new connections for a while. Missed events must be backfilled with `?since=` after it returns.
 */
interface SocketControl {
  /** Number of connections the page opened so far. */
  urls: string[];
  /** While true new connections are closed immediately (server "down"). */
  block(on: boolean): void;
  /** Closes the live connection from the "network" side. */
  drop(): void;
}

async function controlSocket(page: Page): Promise<SocketControl> {
  const urls: string[] = [];
  let live: WebSocketRoute | undefined;
  let blocked = false;
  await page.routeWebSocket(/\/api\/v1\/events/, (ws) => {
    urls.push(ws.url());
    if (blocked) {
      void ws.close({ code: 1006, reason: "e2e blocked" });
      return;
    }
    live = ws;
    ws.connectToServer(); // everything is forwarded unchanged
  });
  return { urls, block: (on) => void (blocked = on), drop: () => void live?.close({ code: 1006, reason: "e2e drop" }) };
}

test("a dropped event stream is reported, retried with backoff and backfilled with ?since= after it returns", async ({ page, api }) => {
  const sockets = await controlSocket(page);
  // This reconnect scenario runs after the long performance/soak cases in CI. Give the initial
  // WebSocket handshake more than the shared open() helper's 15s so a slow runner does not fail
  // before the actual drop/retry behavior is exercised.
  await page.goto("/");
  await expect(page.getByRole("main", { name: "Hauptinhalt" })).toBeVisible();
  await expect(eventStreamChip(page)).toContainText("online", { timeout: 40_000 });
  const firstConnects = sockets.urls.length;
  expect(firstConnects).toBeGreaterThanOrEqual(1);
  // The client resumes from the last sequence it has seen, so let it see one event before the drop.
  await api.post("/tasks", { title: "E2E Vorlauf", priority: "P4" });
  await page.getByRole("link", { name: "Live-Aktivität" }).click();
  await expect(page.getByRole("main").getByText("E2E Vorlauf").first()).toBeVisible();

  sockets.block(true);
  sockets.drop();
  await expect(eventStreamChip(page)).not.toContainText("online", { timeout: 20_000 }); // verbindet / Polling / offline
  const degraded = (await eventStreamChip(page).innerText()).toLowerCase();
  expect(degraded).toMatch(/verbindet|polling|offline|eingeschränkt/);

  // events the client misses while the socket is down: three tasks created through the API
  const created = [];
  for (const title of ["E2E Lückentest 1", "E2E Lückentest 2", "E2E Lückentest 3"]) {
    const result = await api.post("/tasks", { title, priority: "P3" });
    expect(result.status).toBeLessThan(300);
    created.push(result.body.data.id as string);
  }

  await page.waitForTimeout(2500); // at least one refused retry (backoff 0.5 s ... 15 s)
  expect(sockets.urls.length, "client retried while blocked").toBeGreaterThan(firstConnects);
  sockets.block(false);
  await expect(eventStreamChip(page)).toContainText("online", { timeout: 40_000 });
  expect(sockets.urls.at(-1), "reconnect asks for the gap").toMatch(/[?&]since=\d+/);

  // gap backfill: the missed activity is present without a reload
  await page.getByRole("link", { name: "Live-Aktivität" }).click();
  for (const title of ["E2E Lückentest 1", "E2E Lückentest 3"]) {
    await expect(page.getByRole("main").getByText(title).first()).toBeVisible();
  }
  expect(created).toHaveLength(3);
});

test("the live feed keeps updating after the reconnect", async ({ page, api }) => {
  const sockets = await controlSocket(page);
  await open(page, "/activity");
  await expect(eventStreamChip(page)).toContainText("online");
  sockets.drop();
  await expect(eventStreamChip(page)).toContainText("online", { timeout: 40_000 }); // unblocked: immediate reconnect
  await expect.poll(() => sockets.urls.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await api.post("/tasks", { title: "E2E nach Reconnect", priority: "P3" });
  await expect(page.getByRole("main").getByText("E2E nach Reconnect").first()).toBeVisible({ timeout: 20_000 });
});

test("a server restart notice (resync_required) makes the client reload its data instead of showing stale state", async ({ page, api }) => {
  await open(page, "/tasks");
  const before = await page.getByText(/\d+ Treffer/).innerText();
  // reset republishes resync_required to all clients and changes the world (the seeded task count differs from a created one)
  await api.post("/tasks", { title: "E2E Resync Aufgabe", priority: "P3" });
  await expect(page.getByText(/\d+ Treffer/)).not.toHaveText(before);
  await api.reset();
  await expect(page.getByText(before)).toBeVisible({ timeout: 30_000 });
});
