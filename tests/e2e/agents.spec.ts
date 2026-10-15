import { test, expect, open } from "./support/fixtures";
import type { ApiClient } from "./support/api";
import type { Page } from "@playwright/test";

/**
 * PLAN §31 Agents, §51.5: list, detail tabs, pause -> resume, stop with confirmation, assign a task, open the activity
 * of one agent, and capability-gated actions. Every UI action is verified against the Control API.
 */
interface Agent {
  id: string;
  version: number;
  name: string;
  role: string;
  status: string;
  currentTaskId: string | null;
  capabilities: string[];
}
interface Task {
  id: string;
  version: number;
  title: string;
  status: string;
  agentId: string | null;
  agentName?: string | null;
}

const RESEARCH = "Recherche-Agent"; // seed: working, owns tasks and tool calls
const IDLE_AGENT = "Kalender-Agent"; // seed: idle

const agentCard = (page: Page, name: string) => page.getByRole("article", { name: `Agent: ${name}` });
const drawerOf = (page: Page, name: string) => page.getByRole("dialog", { name });

async function agentByName(api: ApiClient, name: string): Promise<Agent> {
  const found = ((await api.get("/agents?limit=200")).body.items as Agent[]).find((agent) => agent.name === name);
  if (!found) throw new Error(`Agent nicht gefunden: ${name}`);
  return found;
}
const statusOf = async (api: ApiClient, id: string): Promise<string> => (await api.get(`/agents/${id}`)).body.data.status;

/** Opens the page and the detail drawer of one agent through its card. */
async function openAgent(page: Page, name: string): Promise<ReturnType<typeof drawerOf>> {
  await open(page, "/agents");
  await agentCard(page, name).getByRole("button", { name, exact: true }).click();
  const drawer = drawerOf(page, name);
  await expect(drawer).toBeVisible();
  return drawer;
}

test("the list shows one card per agent with the PLAN §31.1 facts and status counts that match the API", async ({ page, api }) => {
  const agents = (await api.get("/agents?limit=200")).body.items as Agent[];
  expect(agents.length).toBeGreaterThanOrEqual(8);
  await open(page, "/agents");
  const list = page.getByRole("list", { name: "Agenten", exact: true });
  await expect(list.getByRole("article")).toHaveCount(agents.length);
  for (const agent of agents) await expect(agentCard(page, agent.name)).toHaveAttribute("data-status", agent.status);

  const research = agentCard(page, RESEARCH);
  await expect(research).toContainText("Modell");
  await expect(research).toContainText("Reasoning-Stufe");
  await expect(research).toContainText("Heartbeat");
  await expect(research).toContainText("Erfolgsquote");
  await expect(research).toContainText("Letzte Aktivität");
  await expect(research.getByLabel("Fähigkeiten")).toContainText("Websuche");

  // summary by status equals the server's grouping
  const summary = page.getByRole("list", { name: "Agenten nach Status" });
  const working = agents.filter((agent) => agent.status === "working").length;
  await expect(summary.getByRole("listitem").filter({ hasText: "Aktiv" })).toContainText(String(working));

  // status filter narrows the grid to exactly the server's matches
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption({ label: "Aktiv" });
  await expect(list.getByRole("article")).toHaveCount(working);
  // search by name
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption({ label: "Alle Status" });
  await page.getByRole("searchbox", { name: "Agenten suchen" }).fill("Kalender");
  await expect(list.getByRole("article")).toHaveCount(1);
  await expect(agentCard(page, IDLE_AGENT)).toBeVisible();
});

test("the detail drawer has the eight tabs of PLAN §31.2 and each renders its content", async ({ page, api }) => {
  const agent = await agentByName(api, RESEARCH);
  const drawer = await openAgent(page, RESEARCH);
  await expect(page).toHaveURL(new RegExp(`agent=${agent.id}`));
  const tabs = drawer.getByRole("tablist", { name: "Agentendetails" });
  await expect(tabs.getByRole("tab")).toHaveText([/^Übersicht/, /^Fähigkeiten/, /^Aktueller Task/, /^Verlauf/, /^Tools/, /^Leistung/, /^Fehler/, /^Konfiguration/]);

  // overview (default)
  await expect(drawer.getByText(agent.role, { exact: true })).toBeVisible();
  await expect(drawer.getByText("Reasoning-Stufe")).toBeVisible();

  await tabs.getByRole("tab", { name: /^Fähigkeiten/ }).click();
  const capabilities = drawer.getByRole("list", { name: "Fähigkeiten" });
  for (const capability of agent.capabilities) await expect(capabilities).toContainText(capability);
  await expect(page).toHaveURL(/tab=capabilities/);

  await tabs.getByRole("tab", { name: "Aktueller Task" }).click();
  const task = (await api.get(`/tasks/${agent.currentTaskId}`)).body.data as Task;
  await expect(drawer.getByText(task.title)).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Task öffnen" })).toBeVisible();

  await tabs.getByRole("tab", { name: "Verlauf" }).click();
  await expect(drawer.getByRole("region", { name: "Zuletzt bearbeitete Aufgaben" })).toBeVisible();
  await expect(drawer.getByRole("region", { name: "Letzte Aktivität" }).getByRole("button").first()).toBeVisible();

  await tabs.getByRole("tab", { name: /^Tools/ }).click();
  await expect(drawer.getByRole("region", { name: "Aktive Tools" })).toBeVisible();
  await expect(drawer.getByRole("region", { name: "Zuletzt genutzte Tools" })).toContainText(/\d+ Aufrufe|Keine Tool-Aufrufe/);

  await tabs.getByRole("tab", { name: "Leistung" }).click();
  await expect(drawer.getByText("Erfolgsquote")).toBeVisible();

  await tabs.getByRole("tab", { name: "Fehler" }).click();
  await expect(drawer.getByRole("region", { name: "Fehler im Verlauf" })).toBeVisible();

  await tabs.getByRole("tab", { name: "Konfiguration" }).click();
  await expect(drawer.getByText("Nur Ansicht. Geändert wird die Konfiguration im Agent-Adapter.")).toBeVisible();

  // closing removes the deep link
  await drawer.getByRole("button", { name: "Schließen" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/agent=/);
});

test("pause -> status paused (API confirms) -> resume -> working again", async ({ page, api }) => {
  const agent = await agentByName(api, RESEARCH);
  expect(agent.status).toBe("working");
  const drawer = await openAgent(page, RESEARCH);
  const actions = drawer.getByRole("group", { name: "Aktionen" });
  await expect(actions.getByRole("button", { name: /^Fortsetzen/ }), "resume makes no sense while working").toBeDisabled();

  const pause = page.waitForRequest((request) => request.url().endsWith(`/agents/${agent.id}/pause`) && request.method() === "POST");
  await actions.getByRole("button", { name: "Pausieren" }).click();
  expect((await pause).headers()["idempotency-key"]).toBeTruthy();
  await expect(page.getByText("Agent pausiert").first()).toBeVisible();
  await expect.poll(() => statusOf(api, agent.id)).toBe("paused");
  await expect(agentCard(page, RESEARCH)).toHaveAttribute("data-status", "paused");
  await expect(drawer.locator(".ag-card__status, .tk-drawer__sub").getByText("Pausiert").first()).toBeVisible();
  await expect(actions.getByRole("button", { name: /^Pausieren/ })).toBeDisabled();

  await actions.getByRole("button", { name: "Fortsetzen" }).click();
  await expect(page.getByText("Agent fortgesetzt").first()).toBeVisible();
  await expect.poll(() => statusOf(api, agent.id)).toBe("working");
  await expect(agentCard(page, RESEARCH)).toHaveAttribute("data-status", "working");
});

test("stop asks for confirmation: backing out changes nothing, confirming stops the agent", async ({ page, api }) => {
  const agent = await agentByName(api, RESEARCH);
  const drawer = await openAgent(page, RESEARCH);
  await drawer.getByRole("group", { name: "Aktionen" }).getByRole("button", { name: "Stoppen" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Agent stoppen?" });
  await expect(confirm).toContainText(`${RESEARCH} beendet die laufende Arbeit.`);
  await expect(confirm).toContainText("Verlauf und Ergebnisse bleiben erhalten.");

  await confirm.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirm).toBeHidden();
  expect(await statusOf(api, agent.id), "nothing happened").toBe("working");

  await drawer.getByRole("group", { name: "Aktionen" }).getByRole("button", { name: "Stoppen" }).click();
  await page.getByRole("alertdialog", { name: "Agent stoppen?" }).getByRole("button", { name: "Agent stoppen" }).click();
  await expect(page.getByText("Agent gestoppt").first()).toBeVisible();
  await expect.poll(() => statusOf(api, agent.id)).not.toBe("working");
  const stopped = await statusOf(api, agent.id);
  await expect(agentCard(page, RESEARCH)).toHaveAttribute("data-status", stopped);
  // history stays: the agent's activity is still listed
  expect(((await api.get(`/activity?agentId=${agent.id}&limit=5`)).body.items as unknown[]).length).toBeGreaterThan(0);
});

test("assign task: the chosen open task gets the agent via POST /tasks/{id}/assign", async ({ page, api }) => {
  const tasks = (await api.get("/tasks?limit=200")).body.items as Task[];
  const target = tasks.find((task) => task.status === "todo" && !task.agentId)!;
  expect(target, "seed has an unassigned todo task").toBeDefined();
  const agent = await agentByName(api, IDLE_AGENT);
  const drawer = await openAgent(page, IDLE_AGENT);

  await drawer.getByRole("button", { name: "Aufgabe zuweisen" }).click();
  const dialog = page.getByRole("dialog", { name: "Aufgabe zuweisen" });
  const confirm = dialog.getByRole("button", { name: "Zuweisen" });
  await expect(confirm, "no task chosen yet").toBeDisabled();
  await dialog.getByRole("combobox", { name: "Aufgabe" }).selectOption(target.id);
  await expect(confirm).toBeEnabled();
  const sent = page.waitForRequest((request) => request.url().endsWith(`/tasks/${target.id}/assign`) && request.method() === "POST");
  await confirm.click();
  const request = await sent;
  expect(request.postDataJSON()).toMatchObject({ agentId: agent.id });
  expect((await request.allHeaders())["if-match"], "carries the task version the user saw").toBe(String(target.version));
  await expect(dialog).toBeHidden();

  await expect.poll(async () => ((await api.get(`/tasks/${target.id}`)).body.data as Task).agentId).toBe(agent.id);
  // the agent's own task list reflects it
  await drawer.getByRole("tab", { name: "Verlauf" }).click();
  await expect(drawer.getByRole("region", { name: "Zuletzt bearbeitete Aufgaben" })).toContainText(target.title);
});

test("open activity jumps to the live feed filtered by that agent", async ({ page, api }) => {
  const agent = await agentByName(api, RESEARCH);
  const drawer = await openAgent(page, RESEARCH);
  await drawer.getByRole("button", { name: "Aktivität öffnen" }).click();
  await expect(page).toHaveURL(/\/activity\/?(\?|$)/);
  await expect(page.getByRole("heading", { name: "Live-Aktivität", level: 1 }).or(page.getByRole("main").getByRole("heading").first())).toBeVisible();

  const filterBar = page.getByRole("combobox", { name: "Agent", exact: true });
  await expect(filterBar).toHaveValue(agent.id);
  const expected = (await api.get(`/activity?agentId=${agent.id}&limit=200`)).body.items as Array<{ agentId: string }>;
  expect(expected.length).toBeGreaterThan(0);
  await expect(page.getByText(`${expected.length} Ereignisse angezeigt`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Ereignisse" }).getByText(RESEARCH).first()).toBeVisible();
});

test("a missing capability disables the matching action with its reason, other actions stay usable", async ({ page, api }) => {
  for (const capability of ["pause", "stop"]) {
    const result = await api.control({ action: "capability_toggle", module: "agents", capability, enabled: false });
    expect(result.status).toBe(200);
  }
  const caps = (await api.get("/capabilities")).body.modules.agents;
  expect(caps).toMatchObject({ pause: false, stop: false, resume: true, assignTask: true });

  const drawer = await openAgent(page, RESEARCH);
  const actions = drawer.getByRole("group", { name: "Aktionen" });
  const pause = actions.getByRole("button", { name: /^Pausieren/ });
  const stop = actions.getByRole("button", { name: /^Stoppen/ });
  await expect(pause).toBeDisabled();
  await expect(stop).toBeDisabled();
  await expect(pause, "disabled but never silent: the reason is in the accessible name and the tooltip").toHaveAccessibleName(/Pausieren \(.+\)/);
  await expect(pause).toHaveAttribute("title", /.+/);
  await expect(actions.getByRole("button", { name: "Aufgabe zuweisen" })).toBeEnabled();
  await expect(actions.getByRole("button", { name: "Aktivität öffnen" })).toBeEnabled();

  // even a click on the disabled button reaches no endpoint
  let posted = false;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/agents\//.test(request.url())) posted = true;
  });
  await pause.click({ force: true });
  expect(posted).toBe(false);
  expect(await statusOf(api, (await agentByName(api, RESEARCH)).id)).toBe("working");

  // the API refuses the operation too (defence in depth)
  const refused = await api.post(`/agents/${(await agentByName(api, RESEARCH)).id}/pause`, {});
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(refused.status).toBeLessThan(500);
});

test("actions that do not fit the agent's status are disabled with the reason", async ({ page, api }) => {
  const idle = await agentByName(api, IDLE_AGENT);
  expect(idle.status).toBe("idle");
  const drawer = await openAgent(page, IDLE_AGENT);
  const actions = drawer.getByRole("group", { name: "Aktionen" });
  for (const name of ["Pausieren", "Fortsetzen", "Stoppen"]) {
    const button = actions.getByRole("button", { name: new RegExp(`^${name}`) });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleName(new RegExp(`${name} \\(Im aktuellen Status des Agenten nicht möglich\\.\\)`));
  }
});
