import { API_ORIGIN } from "./support/constants";
import { test, expect, open } from "./support/fixtures";
import { ApiClient } from "./support/api";
import type { DevRole } from "./support/constants";
import type { Locator, Page } from "@playwright/test";

/**
 * PLAN §29 Live Activity, §51.5: events stream in while a scenario plays, filter by agent and severity, activity tree
 * (User Request -> Task -> Agent -> Tool Call), pause/resume with a counter for what arrived meanwhile, event detail with
 * copyable correlation id and jumps to task and agent, raw JSON only for the owner. Every UI step is checked against the API.
 */
interface ActivityEvent {
  id: string;
  kind: string;
  title: string;
  severity: string;
  status: string;
  parentId: string | null;
  agentId: string | null;
  taskId: string | null;
  correlationId: string;
  occurredAt: string;
}

const feed = (page: Page): Locator => page.getByRole("list", { name: "Ereignisse", exact: true });
const tree = (page: Page): Locator => page.getByRole("tree", { name: "Aktivitätsbaum" });
const pauseButton = (page: Page): Locator => page.getByRole("button", { name: /^Live pausieren$|^Fortsetzen/ });
const shownCount = async (page: Page): Promise<number> => {
  const text = (await page.getByText(/Ereignisse angezeigt, \d+ geladen/).first().textContent()) ?? "";
  return Number(/^(\d+) Ereignisse angezeigt/.exec(text.trim())?.[1] ?? Number.NaN);
};

async function allEvents(api: ApiClient): Promise<ActivityEvent[]> {
  return (await api.get("/activity?limit=200")).body.items as ActivityEvent[];
}
const advance = async (api: ApiClient, ms: number): Promise<void> => {
  expect((await api.control({ action: "clock_advance", ms })).status).toBe(200);
};

/** Plays the "syncing" scenario at 1/10 speed: its four activity events appear at 0 s, 15 s, 40 s and 60 s of simulated time. */
async function startSyncScenario(api: ApiClient): Promise<number> {
  const before = (await allEvents(api)).length;
  await api.play("syncing", 0.1);
  await expect.poll(async () => (await allEvents(api)).length).toBe(before + 1);
  return before;
}

test("events stream into the open feed while a scenario plays, newest first, without a reload", async ({ page, api }) => {
  await api.play("multi-agent-working", 0.1);
  await open(page, "/activity");
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
  const before = await shownCount(page);
  expect(before).toBe((await allEvents(api)).length);

  // 14 s of scenario time at 1/10 speed: "Recherche fertig" completes the research task -> a task event on the stream
  await advance(api, 140_000);
  const completed = "Aufgabe abgeschlossen: Marktanalyse Büromöbel Region Hannover";
  const top = feed(page).getByRole("listitem").first();
  await expect(top).toContainText(completed);
  await expect(top).toContainText("Aufgabe"); // kind
  await expect.poll(() => shownCount(page)).toBe(before + 1);
  const [newest] = await allEvents(api);
  expect(newest!.title, "the UI shows exactly what the server stored").toBe(completed);
  expect(newest!.kind).toBe("task");
});

test("filter by agent and by severity narrow the feed to exactly the server's matches", async ({ page, api }) => {
  const events = await allEvents(api);
  const agents = await api.get("/agents?limit=200");
  const names = new Map((agents.body.items as Array<{ id: string; name: string }>).map((agent) => [agent.id, agent.name]));
  const failing = events.find((event) => event.agentId && ["warning", "error"].includes(event.severity));
  expect(failing, "seed has an agent with a warning or error").toBeDefined();
  const agentId = failing!.agentId!;
  const agentName = names.get(agentId)!;
  const byAgent = events.filter((event) => event.agentId === agentId);
  const byAgentAndSeverity = byAgent.filter((event) => event.severity === failing!.severity);
  expect(byAgent.length).toBeGreaterThan(byAgentAndSeverity.length);
  const allErrors = events.filter((event) => event.severity === failing!.severity);

  await open(page, "/activity");
  await expect.poll(() => shownCount(page)).toBe(events.length);
  await page.getByRole("combobox", { name: "Agent", exact: true }).selectOption({ label: agentName });
  await expect.poll(() => shownCount(page)).toBe(byAgent.length);
  await expect(page.getByText(`Agent: ${agentName}`)).toBeVisible(); // removable filter chip

  const severityLabel = { warning: "Warnung", error: "Fehler", critical: "Kritisch", info: "Info" }[failing!.severity]!;
  await page.getByRole("combobox", { name: "Schweregrad", exact: true }).selectOption({ label: severityLabel });
  await expect.poll(() => shownCount(page)).toBe(byAgentAndSeverity.length);
  // every visible row carries that severity tag and the agent
  const rows = feed(page).getByRole("listitem");
  await expect(rows).toHaveCount(byAgentAndSeverity.length);
  for (const row of await rows.all()) {
    await expect(row).toContainText(severityLabel);
    await expect(row).toContainText(agentName);
  }

  // removing the agent chip keeps the severity filter
  await page.getByRole("button", { name: `Filter entfernen: Agent: ${agentName}` }).click();
  await expect.poll(() => shownCount(page)).toBe(allErrors.length);

  // reset brings everything back
  await page.getByRole("button", { name: "Filter zurücksetzen" }).first().click();
  await expect.poll(() => shownCount(page)).toBe(events.length);
});

test("the search narrows to one flow, an unmatched search shows the empty state with a reset", async ({ page, api }) => {
  const events = await allEvents(api);
  const sample = events.find((event) => event.kind === "tool_call")!;
  await open(page, "/activity");
  await page.getByRole("searchbox", { name: "Ereignisse suchen" }).fill(sample.correlationId);
  const matches = events.filter((event) => event.correlationId === sample.correlationId || event.title.includes(sample.correlationId));
  await expect.poll(() => shownCount(page)).toBe(matches.length);
  await page.getByRole("searchbox", { name: "Ereignisse suchen" }).fill("kein-treffer-xyz");
  await expect(page.getByText("Keine Ereignisse für diese Filter.")).toBeVisible();
  await page.getByRole("button", { name: "Filter zurücksetzen" }).last().click();
  await expect.poll(() => shownCount(page)).toBe(events.length);
});

test("the tree view nests Anfrage -> Aufgabe -> Agent -> Tool-Aufruf and branches collapse and expand", async ({ page, api }) => {
  const events = await allEvents(api);
  const byId = new Map(events.map((event) => [event.id, event]));
  // a complete chain of four levels, e.g. "Woche 43 gelesen" <- agent <- task <- user request
  const leaf = events.find((event) => event.kind === "tool_call" && event.parentId && byId.get(event.parentId)?.parentId && byId.get(byId.get(event.parentId)!.parentId!)?.parentId)!;
  const agentEvent = byId.get(leaf.parentId!)!;
  const taskEvent = byId.get(agentEvent.parentId!)!;
  const requestEvent = byId.get(taskEvent.parentId!)!;
  expect([requestEvent.kind, taskEvent.kind, agentEvent.kind, leaf.kind]).toEqual(["user_request", "task", "agent", "tool_call"]);

  await open(page, "/activity");
  await page.getByRole("radio", { name: "Baum" }).or(page.getByRole("button", { name: "Baum" })).first().click();
  // narrow to this task so the whole chain is on screen
  await page.getByRole("combobox", { name: "Aufgabe", exact: true }).selectOption(requestEvent.taskId!);
  const root = tree(page).getByRole("treeitem").filter({ hasText: requestEvent.title }).first();
  await expect(root).toHaveAttribute("aria-level", "1");
  const level = async (title: string): Promise<string | null> => tree(page).getByRole("treeitem").filter({ hasText: title }).first().getAttribute("aria-level");
  await expect.poll(() => level(taskEvent.title)).toBe("2");
  await expect.poll(() => level(agentEvent.title)).toBe("3");
  await expect.poll(() => level(leaf.title)).toBe("4");

  // collapse the root: the whole branch disappears and the row says how many events are hidden
  const items = tree(page).getByRole("treeitem");
  const expanded = await items.count();
  await root.getByRole("button", { name: /^Zweig zuklappen/ }).click();
  await expect(root).toHaveAttribute("aria-expanded", "false");
  await expect(items).toHaveCount(1);
  await expect(root).toContainText(/\+\d+/);

  // expand step by step: Task -> Agent -> Tool Call
  await root.getByRole("button", { name: /^Zweig aufklappen/ }).click();
  await expect(items).toHaveCount(expanded);
  const task = items.filter({ hasText: taskEvent.title }).first();
  await task.getByRole("button", { name: /^Zweig zuklappen/ }).click();
  await expect(items.filter({ hasText: leaf.title })).toHaveCount(0);
  await expect(items.filter({ hasText: agentEvent.title })).toHaveCount(0);
  await task.getByRole("button", { name: /^Zweig aufklappen/ }).click();
  const agentRow = items.filter({ hasText: agentEvent.title }).first();
  await expect(agentRow).toBeVisible();
  await agentRow.getByRole("button", { name: /^Zweig zuklappen/ }).click();
  await expect(items.filter({ hasText: leaf.title })).toHaveCount(0);
  await agentRow.getByRole("button", { name: /^Zweig aufklappen/ }).click();
  await expect(items.filter({ hasText: leaf.title }).first()).toBeVisible();

  // back to the flat list keeps the filter
  await page.getByRole("radio", { name: "Liste" }).or(page.getByRole("button", { name: "Liste" })).first().click();
  await expect(feed(page).getByRole("listitem").first()).toBeVisible();
});

test("pause freezes the list and counts what arrives, resume shows the new events", async ({ page, api }) => {
  await open(page, "/activity");
  const before = await startSyncScenario(api);
  await expect.poll(() => shownCount(page)).toBe(before + 1);
  const firstTitle = async (): Promise<string> => (await feed(page).getByRole("listitem").first().textContent()) ?? "";
  expect(await firstTitle()).toContain("Synchronisation GMX-Postfach gestartet");

  const toggle = pauseButton(page);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Pausiert", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("LIVE", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Automatisch scrollen" })).toBeDisabled();
  const frozenCount = await shownCount(page);
  const frozenTop = await firstTitle();

  // two more events arrive on the server while paused
  await advance(api, 15_000);
  await expect.poll(async () => (await allEvents(api)).length).toBe(before + 2);
  await advance(api, 25_000);
  await expect.poll(async () => (await allEvents(api)).length).toBe(before + 3);
  await expect(page.getByRole("button", { name: "Fortsetzen (2 neu)" })).toBeVisible();
  expect(await shownCount(page), "list is frozen").toBe(frozenCount);
  expect(await firstTitle(), "top row did not move").toBe(frozenTop);
  await expect(feed(page)).not.toContainText("Synchronisation Kalender gestartet");

  await page.getByRole("button", { name: "Fortsetzen (2 neu)" }).click();
  await expect(pauseButton(page)).toHaveText("Live pausieren");
  await expect(pauseButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => shownCount(page)).toBe(frozenCount + 2);
  await expect(feed(page).getByRole("listitem").first()).toContainText("Synchronisation GMX-Postfach abgeschlossen");
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();

  // resume without anything new says plain "Fortsetzen"
  await pauseButton(page).click();
  await expect(page.getByRole("button", { name: "Fortsetzen", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fortsetzen", exact: true }).click();
  await expect(pauseButton(page)).toHaveText("Live pausieren");
});

test("event detail shows every field, copies the correlation id and jumps to task and agent", async ({ page, api, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: API_ORIGIN });
  const events = await allEvents(api);
  const names = new Map(((await api.get("/agents?limit=200")).body.items as Array<{ id: string; name: string }>).map((agent) => [agent.id, agent.name]));
  const event = events.find((candidate) => candidate.kind === "tool_call" && candidate.agentId && candidate.taskId && candidate.status === "succeeded")!;
  await open(page, "/activity");
  await page.getByRole("searchbox", { name: "Ereignisse suchen" }).fill(event.title);
  await feed(page).getByRole("listitem").filter({ hasText: event.title }).first().getByRole("button").first().click();

  const drawer = page.getByRole("dialog", { name: "Ereignis" });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`event=${event.id}`));
  await expect(drawer.getByRole("heading", { name: event.title })).toBeVisible();
  for (const label of ["Zeitpunkt", "Dauer", "Agent", "Aufgabe", "Tool", "Adapter", "Modell", "Korrelations-ID", "Sequenz", "Ereignis-ID"]) {
    await expect(drawer.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(drawer).toContainText(names.get(event.agentId!)!);
  await expect(drawer.getByText(event.taskId!)).toBeVisible();
  await expect(drawer.getByText(event.correlationId)).toBeVisible();

  // copy correlation id
  await drawer.getByRole("button", { name: "Korrelations-ID kopieren" }).click();
  await expect(page.getByText("Kopiert", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(event.correlationId);

  // jump to the task
  await drawer.getByRole("button", { name: "Zur Aufgabe" }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/?\\?.*task=${event.taskId}`));
  const task = (await api.get(`/tasks/${event.taskId}`)).body.data as { title: string };
  await expect(page.getByRole("dialog", { name: "Aufgabe" }).getByRole("heading", { name: task.title })).toBeVisible();

  // and back, then to the agent
  await page.goBack();
  await page.goBack().catch(() => undefined);
  await open(page, `/activity?event=${event.id}`);
  await page.getByRole("dialog", { name: "Ereignis" }).getByRole("button", { name: "Zum Agenten" }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/?\\?.*agent=${event.agentId}`));
  await expect(page.getByRole("dialog", { name: names.get(event.agentId!)! })).toBeVisible();
});

test("'Nur diesen Ablauf zeigen' narrows the feed to one correlation id and switches to the tree", async ({ page, api }) => {
  const events = await allEvents(api);
  const sample = events.find((event) => event.parentId && events.filter((other) => other.correlationId === event.correlationId).length > 1)!;
  const flow = events.filter((event) => event.correlationId === sample.correlationId);
  await open(page, `/activity?event=${sample.id}`);
  await page.getByRole("dialog", { name: "Ereignis" }).getByRole("button", { name: "Nur diesen Ablauf zeigen" }).click();
  await expect(tree(page)).toBeVisible();
  await expect.poll(() => shownCount(page)).toBe(flow.length);
});

test.describe("raw JSON is a debug/owner view", () => {
  const signInAs = async (page: Page, role: DevRole): Promise<void> => {
    const session = await ApiClient.login(role);
    await page.context().clearCookies();
    await page.context().addCookies(session.cookieList());
  };

  test("the owner can show, hide and copy the raw JSON of an event", async ({ page, api, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: API_ORIGIN });
    expect((await api.get("/meta")).body.features.rawJsonView, "feature flag is off in this stack").toBe(false);
    const [event] = await allEvents(api);
    await open(page, `/activity?event=${event!.id}`);
    const drawer = page.getByRole("dialog", { name: "Ereignis" });
    await expect(drawer.getByRole("heading", { name: "Rohdaten (JSON)" })).toBeVisible();
    await expect(drawer.getByText("Nur für Administratoren und im Debug-Modus sichtbar.")).toBeVisible();
    await expect(drawer.locator("pre")).toHaveCount(0); // collapsed by default
    await drawer.getByRole("button", { name: "Anzeigen" }).click();
    const raw = drawer.getByLabel("Rohdaten (JSON)").and(drawer.locator("pre"));
    await expect(raw).toContainText(`"id": "${event!.id}"`);
    expect(JSON.parse((await raw.textContent())!)).toMatchObject({ id: event!.id, correlationId: event!.correlationId });
    await drawer.getByRole("button", { name: "JSON kopieren" }).click();
    expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toMatchObject({ id: event!.id });
    await drawer.getByRole("button", { name: "Ausblenden" }).click();
    await expect(drawer.locator("pre")).toHaveCount(0);
  });

  test("the rawJsonView feature flag of /meta opens the section for a viewer as well", async ({ page, api }) => {
    const [event] = await allEvents(api);
    await signInAs(page, "viewer");
    await page.route("**/api/v1/meta", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { features: Record<string, unknown> };
      await route.fulfill({ response, json: { ...body, features: { ...body.features, rawJsonView: true } } });
    });
    await open(page, `/activity?event=${event!.id}`);
    const drawer = page.getByRole("dialog", { name: "Ereignis" });
    await expect(drawer.getByRole("heading", { name: "Rohdaten (JSON)" })).toBeVisible();
    await drawer.getByRole("button", { name: "Anzeigen" }).click();
    expect(JSON.parse((await drawer.locator("pre").textContent())!)).toMatchObject({ id: event!.id });
  });

  for (const role of ["operator", "viewer"] as const) {
    test(`the ${role} sees the event but no raw JSON section`, async ({ page, api }) => {
      const [event] = await allEvents(api);
      await signInAs(page, role);
      await open(page, `/activity?event=${event!.id}`);
      expect(await page.evaluate(async () => ((await (await fetch("/api/v1/auth/session")).json()) as { data: { role: string } }).data.role), "the browser really runs as this role").toBe(role);
      const drawer = page.getByRole("dialog", { name: "Ereignis" });
      await expect(drawer.getByRole("heading", { name: event!.title })).toBeVisible();
      await expect(drawer.getByText("Korrelations-ID", { exact: true })).toBeVisible();
      await expect(drawer.getByRole("heading", { name: "Rohdaten (JSON)" })).toHaveCount(0);
      await expect(drawer.getByRole("button", { name: "Anzeigen" })).toHaveCount(0);
      await expect(drawer.locator("pre")).toHaveCount(0);
      expect(await drawer.textContent()).not.toContain('"sequence":');
    });
  }
});
