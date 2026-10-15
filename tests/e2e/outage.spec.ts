import { test, expect, open, expectOrbMode } from "./support/fixtures";

/** PLAN §51.5 Adapter outage, §45.8: only the mail module is offline, everything else stays usable. */
test("partial outage: mail is offline and marked as such, tasks/calendar/agents keep working", async ({ page, api }) => {
  await open(page, "/");
  await api.play("partial-outage", 10);
  await expectOrbMode(page, "warning");
  await expect(page.getByRole("banner")).toContainText("EINGESCHRÄNKT");

  // API level: only the mail endpoints answer 503 ADAPTER_UNAVAILABLE
  const mail = await api.get("/communication/threads");
  expect(mail.status).toBe(503);
  expect(mail.body.error?.code ?? mail.body.code).toBe("ADAPTER_UNAVAILABLE");
  for (const path of ["/tasks", "/calendar/events", "/agents", "/approvals", "/memory"]) {
    expect((await api.get(path)).status, path).toBe(200);
  }

  // UI level: the mail page says so and disables sending; other pages render data
  await page.getByRole("link", { name: "Mail & Kommunikation" }).click();
  await expect(page.getByRole("main").getByText(/nicht verbunden|offline|nicht erreichbar|nicht verfügbar/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Neue Nachricht" })).toBeDisabled();

  await page.getByRole("link", { name: "Aufgaben" }).click();
  await expect(page.getByRole("group", { name: "Kanban-Board" }).getByRole("article").first()).toBeVisible();
  await page.getByRole("link", { name: "Kalender" }).click();
  await expect(page.getByRole("main").getByText(/nicht verbunden|nicht erreichbar/i)).toHaveCount(0);
  await page.getByRole("link", { name: "Agenten" }).click();
  await expect(page.getByRole("main").getByRole("article").first()).toBeVisible();

  // the system page names the offline adapter
  await page.getByRole("link", { name: "System" }).click();
  const adapters = (await api.get("/adapters")).body.items as Array<{ manifest: { id: string }; health: { status: string } }>;
  expect(adapters.filter((adapter) => adapter.health.status === "offline").map((adapter) => adapter.manifest.id)).toEqual(["mock-communication"]);
  await expect(page.getByRole("main").getByText("mock-communication").first()).toBeVisible();
});

test("adapter recovery: bringing the adapter back restores the module without a reload", async ({ page, api }) => {
  await api.control({ action: "adapter_offline", adapterId: "mock-communication", offline: true });
  await open(page, "/communication");
  await expect(page.getByRole("button", { name: "Neue Nachricht" })).toBeDisabled();

  await api.control({ action: "adapter_offline", adapterId: "mock-communication", offline: false });
  await expect(page.getByRole("searchbox", { name: "Nachrichten durchsuchen" })).toBeVisible();
  await expect(page.getByRole("main").getByText(/Treffer/)).not.toHaveText("0 Treffer", { timeout: 60_000 });
  expect((await api.get("/communication/threads")).status).toBe(200);
});

test("adapter-recovery scenario walks the calendar through its degraded/offline phases and back to online", async ({ page, api }) => {
  await open(page, "/");
  await api.play("adapter-recovery", 2); // 21 s of mock time -> ~10.5 s
  const seen = new Set<string>();
  const sample = async (): Promise<string | undefined> => {
    const calendar = ((await api.get("/adapters")).body.items as Array<{ manifest: { id: string }; health: { status: string } }>).find((item) => item.manifest.id === "mock-calendar");
    if (calendar) seen.add(calendar.health.status);
    return (await api.get("/calendar/events")).status === 503 ? "unavailable" : calendar?.health.status;
  };
  await expect.poll(async () => (await sample()) === "unavailable" || [...seen].some((status) => status !== "online"), { timeout: 30_000, intervals: [250] }).toBe(true);
  await expect.poll(async () => (await sample()) === "online" && seen.size > 1, { timeout: 40_000, intervals: [250] }).toBe(true);
  await expectOrbMode(page, "idle", 40_000);
});
