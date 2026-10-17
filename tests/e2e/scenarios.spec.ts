import { test, expect, open, expectOrbMode } from "./support/fixtures";

/** PLAN §51.5 Mock scenario switch via the console page (§44.6): the UI drives the dev endpoints and the app follows. */
test("playing a scenario from the console switches the mock world and the whole app follows", async ({ page, api }) => {
  await open(page, "/dev/scenarios");
  const scenario = page.getByRole("region", { name: "Szenario", exact: true });
  await scenario.getByRole("combobox", { name: "Szenario" }).selectOption({ label: "Approval Waiting" });
  await scenario.getByRole("button", { name: "10×" }).click();
  await scenario.getByRole("button", { name: "Abspielen" }).click();

  const state = page.getByRole("region", { name: "Engine-Zustand" });
  await expect(state.getByText("approval-waiting")).toBeVisible();
  const live = (await api.get("/dev/scenarios/state")).body.data;
  expect(live.activeScenarioId).toBe("approval-waiting");
  expect(live.seed, "fixed mock seed").toBe(42);

  // the orb and the approvals page reflect the scenario (no reload)
  const pending = (await api.get("/approvals?status=pending&limit=50")).body.items as Array<{ action: string }>;
  expect(pending, "the scenario requests exactly one send approval").toHaveLength(1);
  await page.getByRole("link", { name: "Freigaben" }).click();
  await expect(page.getByRole("article", { name: `Freigabe: ${pending[0]!.action}` })).toBeVisible();
  await page.getByRole("link", { name: "Übersicht" }).click();
  await expectOrbMode(page, "waiting_approval");
});

test("the console advances the simulated clock, forces and releases an orb state, and resets the snapshot", async ({ page, api }) => {
  await open(page, "/dev/scenarios");
  const before = (await api.get("/dev/scenarios/state")).body.data.clockOffsetMs as number;
  await page.getByRole("region", { name: "Uhr" }).getByRole("button", { name: "+1 min" }).click();
  await expect.poll(async () => (await api.get("/dev/scenarios/state")).body.data.clockOffsetMs as number).toBeGreaterThanOrEqual(before + 60_000);

  const orb = page.getByRole("region", { name: "Orb" });
  await orb.getByRole("combobox", { name: "Zustand erzwingen" }).selectOption({ label: "Fehler" });
  await orb.getByRole("button", { name: "Erzwingen" }).click();
  await expect.poll(async () => (await api.get("/dev/scenarios/state")).body.data.forcedOrbMode).toBe("error");
  await expect(orb.getByRole("status", { name: "Aktueller Orb-Status" })).toContainText("Fehler");

  await page.getByRole("button", { name: "Snapshot zurücksetzen" }).click();
  await expect.poll(async () => (await api.get("/dev/scenarios/state")).body.data.forcedOrbMode).toBeNull();
  expect((await api.get("/dev/scenarios/state")).body.data.clockOffsetMs).toBeLessThan(before + 60_000);
});

test("a single adapter can be switched offline and online again from the console", async ({ page, api }) => {
  await open(page, "/dev/scenarios");
  const adapters = page.getByRole("region", { name: "Adapter" });
  await adapters.getByRole("combobox", { name: "Ziel" }).selectOption("mock-calendar");
  await adapters.getByRole("button", { name: "Offline schalten" }).click();
  await expect.poll(async () => {
    const list = (await api.get("/adapters")).body.items as Array<{ manifest: { id: string }; health: { status: string } }>;
    return list.find((item) => item.manifest.id === "mock-calendar")?.health.status;
  }).toBe("offline");
  const localCalendar = await api.get("/calendar/events");
  expect(localCalendar.status).toBe(200);
  expect((localCalendar.body.sources as Array<{ adapterId: string }>).map((source) => source.adapterId)).toContain("friday-local-calendar");
  await adapters.getByRole("button", { name: "Online schalten" }).click();
  await expect.poll(async () => {
    const list = (await api.get("/adapters")).body.items as Array<{ manifest: { id: string }; health: { status: string } }>;
    return list.find((item) => item.manifest.id === "mock-calendar")?.health.status;
  }).toBe("online");
  expect((await api.get("/calendar/events")).status).toBe(200);
});
