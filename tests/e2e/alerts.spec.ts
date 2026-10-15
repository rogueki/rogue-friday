import { test, expect, open } from "./support/fixtures";
import type { ApiClient } from "./support/api";
import type { Page } from "@playwright/test";

/**
 * PLAN §39 Notifications & Alerts, §51.5: a P0 alert is prominent without blinking, can be acknowledged, snoozed and
 * resolved (P0/P1 only after a confirmation), shows the escalation chain Dashboard -> Telegram -> WhatsApp -> Telefon
 * with timestamps, lands in the history tab and drives the sidebar badge. Every UI step is verified against the API.
 */
interface Alert {
  id: string;
  version: number;
  priority: string;
  status: string;
  title: string;
  snoozedUntil: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  escalation: Array<{ step: number; channel: string; state: string; scheduledAt: string; sentAt: string | null; acknowledgedAt: string | null }>;
}

const P0_TITLE = "Kritisch: Windows-Worker nicht erreichbar, Backup überfällig";
const ALERTS_LINK = "Meldungen & Alarme";

async function listAlerts(api: ApiClient, query = ""): Promise<Alert[]> {
  return (await api.get(`/notifications?limit=100${query}`)).body.items as Alert[];
}
/** The scenario raises its alert from a mock-clock timer, so it can appear a few ms after the play call returned. */
async function alertByTitle(api: ApiClient, title: string): Promise<Alert> {
  let found: Alert | undefined;
  await expect.poll(async () => (found = (await listAlerts(api)).find((alert) => alert.title === title))?.id, { message: `Meldung "${title}"` }).toBeTruthy();
  return found!;
}

/**
 * Raises the P0 scenario. Playing a scenario restores its baseline: "critical-alert" is a quiet one, i.e. every other
 * open alert is resolved (they are history afterwards) and the P0 is the only open alert. At speed 0.05 the steps are 20x further apart than in real time, so the simulated clock is
 * advanced instead: 1600 s sim-time = all four channels sent (escalation timestamps are deterministic), while the final
 * "Alert bestätigt" step (1800 s) is still ahead, so the alert stays open for the UI to handle.
 */
async function raiseCriticalAlert(api: ApiClient, escalated = false): Promise<Alert> {
  await api.play("critical-alert", escalated ? 0.05 : 0.02);
  if (escalated) {
    const result = await api.control({ action: "clock_advance", ms: 1_600_000 });
    expect(result.status).toBe(200);
  }
  return alertByTitle(api, P0_TITLE);
}

const card = (page: Page, priority: string, title: string) => page.getByRole("article", { name: `${priority} · ${title}` });
const navAlerts = (page: Page) => page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: new RegExp(ALERTS_LINK) });
const berlinTime = (iso: string): string => new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

test("a P0 alert is the first, most prominent entry and nothing on it blinks or pulses", async ({ page, api }) => {
  const p0 = await raiseCriticalAlert(api);
  await open(page, "/alerts");

  const first = page.getByRole("list", { name: "Aktive Meldungen" }).getByRole("article").first();
  await expect(first, "P0 sorts before every P1-P4").toHaveAttribute("data-priority", "P0");
  await expect(first).toHaveAttribute("aria-label", `P0 · ${P0_TITLE}`);
  await expect(first).toHaveClass(/alr-card--prominent/);
  await expect(first.getByText("P0 · Kritisch")).toBeVisible();
  await expect(first.getByText("Offen", { exact: true })).toBeVisible();
  // the priority strip counts it
  await expect(page.getByRole("group", { name: "Nach Priorität filtern" }).getByRole("button", { name: /^P0 1 Kritisch$/ })).toBeVisible();

  // PLAN §39.3: "deutlich, aber nicht durch gefährliches Dauerblinken" -> no running CSS animation or transition on the card
  // or anywhere below it, and no animation-name other than none on any element of the card.
  const motion = await first.evaluate((element) => {
    const nodes = [element, ...element.querySelectorAll("*")];
    return {
      running: element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").map((animation) => animation.id || (animation as CSSAnimation).animationName || "transition"),
      names: nodes.map((node) => getComputedStyle(node).animationName).filter((name) => name !== "none"),
      iterations: nodes.map((node) => getComputedStyle(node).animationIterationCount).filter((count) => count === "infinite"),
    };
  });
  expect(motion.running, "no running animation").toEqual([]);
  expect(motion.names, "no animation-name").toEqual([]);
  expect(motion.iterations, "no infinite animation").toEqual([]);
  expect(p0.priority).toBe("P0");
  await expect(page.locator('article[data-status="open"]'), "quiet baseline: the P0 is the only open alert").toHaveCount(1);
});

test("the sidebar badge counts open alerts up to P2 and follows acknowledge, resolve and a live P0 without a reload", async ({ page, api }) => {
  await open(page, "/alerts");
  const expected = async (): Promise<number> => (await listAlerts(api)).filter((alert) => alert.status === "open" && ["P0", "P1", "P2"].includes(alert.priority)).length;
  const before = await expected();
  expect(before, "seed: open P1/P2 alerts").toBeGreaterThan(1);
  await expect(navAlerts(page)).toContainText(`${before} offene Alarme`);

  // acknowledge one -> badge drops
  const [first] = (await listAlerts(api)).filter((alert) => alert.status === "open" && alert.priority === "P2");
  await card(page, "P2", first!.title).getByRole("button", { name: "Bestätigen" }).click();
  await expect(navAlerts(page)).toContainText(`${before - 1} offene Alarme`);
  expect(await expected()).toBe(before - 1);

  // a P2 resolved in place also leaves the count
  const [second] = (await listAlerts(api)).filter((alert) => alert.status === "open" && alert.priority === "P2");
  await card(page, "P2", second!.title).getByRole("button", { name: "Lösen" }).click();
  await expect(navAlerts(page)).toContainText(`${before - 2} offene Alarme`);
  expect(await expected()).toBe(before - 2);

  // the P0 scenario resolves everything else (quiet baseline) and raises exactly one open alert: live, no reload
  await api.play("critical-alert", 0.02);
  await expect(page.getByRole("article", { name: `P0 · ${P0_TITLE}` })).toBeVisible();
  await expect(navAlerts(page)).toContainText("1 offene Alarme");
  expect(await expected()).toBe(1);

  await card(page, "P0", P0_TITLE).getByRole("button", { name: "Bestätigen" }).click();
  await expect(navAlerts(page)).not.toContainText("offene Alarme"); // no open alert left -> no badge
  expect(await expected()).toBe(0);
});

test("acknowledge: the P0 alert becomes Bestätigt, the server records it and the escalation stops", async ({ page, api }) => {
  const p0 = await raiseCriticalAlert(api);
  await open(page, "/alerts");
  const entry = card(page, "P0", P0_TITLE);
  await entry.getByRole("button", { name: "Bestätigen" }).click();
  await expect(entry.getByText("Bestätigt", { exact: true })).toBeVisible();
  await expect(entry.getByRole("button", { name: "Bestätigen" }), "no second acknowledge once acknowledged").toHaveCount(0);
  await expect(entry.getByRole("button", { name: "Lösen" })).toBeVisible();

  const after = await alertByTitle(api, P0_TITLE);
  expect(after.status).toBe("acknowledged");
  expect(after.acknowledgedAt).toBeTruthy();
  expect(after.version, "version bumped, If-Match carried the seen version").toBeGreaterThan(p0.version);
});

test("snooze: a P2 alert can be snoozed for a chosen time, shows 'Zurückgestellt bis' and the server stores the end", async ({ page, api }) => {
  const target = (await listAlerts(api)).find((alert) => alert.priority === "P2" && alert.status === "open")!;
  await open(page, "/alerts");
  const entry = card(page, "P2", target.title);
  await entry.getByRole("button", { name: "Zurückstellen" }).click();
  const dialog = page.getByRole("dialog", { name: "Meldung zurückstellen" });
  await dialog.getByRole("combobox", { name: "Dauer" }).selectOption({ label: "4 Stunden" });
  await dialog.getByRole("button", { name: "Zurückstellen" }).click();
  await expect(dialog).toBeHidden();
  await expect(entry).toHaveAttribute("data-status", "snoozed");
  await expect(entry.getByText(/Zurückgestellt bis \d{2}:\d{2}/)).toBeVisible();
  await expect(entry.getByRole("button", { name: "Zurückstellen" }), "already snoozed").toHaveCount(0);

  const after = (await listAlerts(api)).find((alert) => alert.id === target.id)!;
  expect(after.status).toBe("snoozed");
  const simulatedNow = (await api.get("/dev/scenarios/state")).body.data.simulatedTime as string; // the mock world runs on its own clock
  const hours = (Date.parse(after.snoozedUntil!) - Date.parse(simulatedNow)) / 3_600_000;
  expect(hours, "snoozed for about 4 hours").toBeGreaterThan(3.9);
  expect(hours).toBeLessThan(4.1);
});

test("snooze rejects a custom duration outside 1..10080 minutes without calling the server", async ({ page, api }) => {
  const target = (await listAlerts(api)).find((alert) => alert.priority === "P2" && alert.status === "open")!;
  await open(page, "/alerts");
  await card(page, "P2", target.title).getByRole("button", { name: "Zurückstellen" }).click();
  const dialog = page.getByRole("dialog", { name: "Meldung zurückstellen" });
  await dialog.getByRole("combobox", { name: "Dauer" }).selectOption({ label: "Eigene Dauer …" });
  await dialog.getByRole("spinbutton", { name: "Minuten" }).fill("0");
  await dialog.getByRole("button", { name: "Zurückstellen" }).click();
  await expect(dialog).toContainText("Bitte eine ganze Zahl zwischen 1 und 10080 Minuten wählen.");
  expect((await listAlerts(api)).find((alert) => alert.id === target.id)!.status).toBe("open");
});

test("resolve of a P0 asks for confirmation first, then moves it to the history tab", async ({ page, api }) => {
  await raiseCriticalAlert(api);
  await open(page, "/alerts");
  const entry = card(page, "P0", P0_TITLE);
  await entry.getByRole("button", { name: "Lösen" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Meldung lösen?" });
  await expect(confirm).toContainText(P0_TITLE);
  await expect(confirm).toContainText("Die Eskalation wird beendet.");

  // backing out has no effect
  await confirm.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirm).toBeHidden();
  expect((await alertByTitle(api, P0_TITLE)).status).toBe("open");

  await entry.getByRole("button", { name: "Lösen" }).click();
  await page.getByRole("alertdialog", { name: "Meldung lösen?" }).getByRole("button", { name: "Lösen" }).click();
  await expect(entry).toHaveCount(0); // gone from the active tab
  const resolved = await alertByTitle(api, P0_TITLE);
  expect(resolved.status).toBe("resolved");
  expect(resolved.resolvedAt).toBeTruthy();
  expect(resolved.escalation.filter((step) => step.state === "pending").length, "no further escalation after resolve").toBe(0);

  // history tab shows the resolved item (next to those the quiet baseline resolved), without action buttons
  await page.getByRole("tab", { name: "Verlauf" }).click();
  const history = page.getByRole("list", { name: "Verlauf gelöster Meldungen" });
  const done = history.getByRole("article", { name: `P0 · ${P0_TITLE}` });
  await expect(done).toBeVisible();
  await expect(done).toHaveAttribute("data-status", "resolved");
  await expect(done.getByRole("button", { name: "Lösen" })).toHaveCount(0);
  await expect(history.getByRole("article")).toHaveCount((await listAlerts(api, "&status=resolved")).length);
  await expect(page.getByRole("tab", { name: /^Aktiv/ })).not.toContainText(P0_TITLE);
});

test("resolve of a P2 alert needs no confirmation", async ({ page, api }) => {
  const target = (await listAlerts(api)).find((alert) => alert.priority === "P2" && alert.status === "open")!;
  await open(page, "/alerts");
  await card(page, "P2", target.title).getByRole("button", { name: "Lösen" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect.poll(async () => (await listAlerts(api)).find((alert) => alert.id === target.id)!.status).toBe("resolved");
  await expect(card(page, "P2", target.title)).toHaveCount(0);
});

test("the escalation chain shows Dashboard -> Telegram -> WhatsApp -> Telefon in order with timestamps", async ({ page, api }) => {
  const p0 = await raiseCriticalAlert(api, true);
  expect(p0.escalation.map((step) => step.channel)).toEqual(["dashboard", "telegram", "whatsapp", "phone"]);
  expect(p0.escalation.every((step) => step.state === "sent" && step.sentAt), "all four channels were triggered").toBe(true);

  await open(page, "/alerts");
  // compact one-line chain in the list: each channel with state word and time
  const summary = card(page, "P0", P0_TITLE).getByRole("list", { name: "Eskalation" });
  const items = summary.getByRole("listitem");
  await expect(items).toHaveCount(4);
  const labels = ["Dashboard", "Telegram", "WhatsApp", "Telefon"];
  for (const [index, label] of labels.entries()) {
    await expect(items.nth(index)).toContainText(`${label} · Gesendet ${berlinTime(p0.escalation[index]!.sentAt!)}`);
  }

  // detailed view in the drawer: four steps in order, each with scheduled/sent timestamps and "Bestätigt: —"
  await card(page, "P0", P0_TITLE).getByRole("button", { name: `Details zu „${P0_TITLE}“` }).click();
  const drawer = page.getByRole("dialog", { name: P0_TITLE });
  const chain = drawer.getByRole("list", { name: "Eskalation" });
  const steps = chain.locator(".alr-chain__step");
  await expect(steps).toHaveCount(4);
  for (const [index, label] of labels.entries()) {
    const step = steps.nth(index);
    await expect(step).toContainText(`Stufe ${index + 1} · ${label}`);
    await expect(step.getByText("Gesendet", { exact: true }).first()).toBeVisible();
    // two real timestamps (scheduled + sent) and one dash (nobody acknowledged this step)
    await expect(step.locator("dd")).toHaveText([
      new RegExp(`14\\.10\\.2026, ${berlinTime(p0.escalation[index]!.scheduledAt)}`),
      new RegExp(`14\\.10\\.2026, ${berlinTime(p0.escalation[index]!.sentAt!)}`),
      "—",
    ]);
  }
  await expect(drawer).toContainText("Die Eskalation läuft weiter, bis die Meldung bestätigt oder gelöst wird.");

  // acknowledging in the drawer ends the escalation notice
  await drawer.getByRole("button", { name: "Bestätigen" }).click();
  await expect(drawer.getByText("Die Eskalation ist beendet: Weitere Stufen werden nicht mehr ausgelöst.")).toBeVisible();
  expect((await alertByTitle(api, P0_TITLE)).status).toBe("acknowledged");
});

test("a freshly raised P0 shows the pending channels as 'Geplant' and the channel status panel lists every escalation channel", async ({ page, api }) => {
  await raiseCriticalAlert(api);
  await open(page, "/alerts");
  const items = card(page, "P0", P0_TITLE).getByRole("list", { name: "Eskalation" }).getByRole("listitem");
  await expect(items.nth(0)).toContainText("Dashboard · Gesendet");
  for (const label of ["Telegram", "WhatsApp", "Telefon"]) await expect(items.filter({ hasText: label })).toContainText("Geplant");

  const channels = page.getByRole("list", { name: "Kanalstatus" });
  for (const label of ["Dashboard", "Telegram", "WhatsApp", "SMS", "Telefon", "E-Mail"]) await expect(channels.getByRole("listitem").filter({ hasText: label })).toHaveCount(1);
  await expect(channels.getByRole("listitem").filter({ hasText: "Dashboard" })).toContainText("Online");
});

test("the priority strip filters the list and the detail drawer opens from a deep link", async ({ page, api }) => {
  const p1 = (await listAlerts(api)).filter((alert) => alert.priority === "P1" && alert.status !== "resolved");
  expect(p1.length).toBeGreaterThan(0);
  await open(page, "/alerts");
  await page.getByRole("group", { name: "Nach Priorität filtern" }).getByRole("button", { name: /^P1 / }).click();
  const articles = page.getByRole("list", { name: "Aktive Meldungen" }).getByRole("article");
  await expect(articles).toHaveCount(p1.length);
  for (const article of await articles.all()) {
    await expect(article).toHaveAttribute("data-priority", "P1");
    await expect(article, "P1 is prominent too").toHaveClass(/alr-card--prominent/);
  }
  await page.getByRole("group", { name: "Nach Priorität filtern" }).getByRole("button", { name: /^P2 / }).click();
  for (const article of await articles.all()) await expect(article, "P2 is not").not.toHaveClass(/alr-card--prominent/);
  await page.getByRole("group", { name: "Nach Priorität filtern" }).getByRole("button", { name: /^Alle / }).click();
  // nothing in the whole list animates, whatever its priority
  expect(await page.getByRole("list", { name: "Aktive Meldungen" }).evaluate((list) => list.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length)).toBe(0);

  await open(page, `/alerts?alert=${p1[0]!.id}`);
  await expect(page.getByRole("dialog", { name: p1[0]!.title })).toBeVisible();
});
