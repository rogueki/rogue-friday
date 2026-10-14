import { mkdirSync } from "node:fs";
import { totalmem } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { API_ORIGIN, CONTROL_ORIGIN, OWNER_PASSWORD, OWNER_USERNAME } from "./constants";

/**
 * Proof that the real adapters (Hermes, voice-http, system-local) work end to end behind the built Control API in hybrid
 * mode: fake upstreams -> adapters -> Control API -> web UI. Outages are simulated by closing the fake service ports.
 * Screenshots go to JARVIS_EVIDENCE_DIR (PNG; docs/evidence/integration/ keeps WebP copies, see its README).
 */
const evidenceDir = resolve(process.env.JARVIS_EVIDENCE_DIR ?? join("test-results", "integration", "evidence"));
mkdirSync(evidenceDir, { recursive: true });

const HERMES_TASK_TITLES = [
  "Quartalsbericht für Brandt Logistik entwerfen",
  "Angebot Nr. 2041 prüfen",
  "Kalender der nächsten Woche abgleichen",
  "Rechnungen September ablegen",
  "Rückfrage zur Lieferzeit klären",
  "Newsletter-Entwurf sichten",
  "Backup-Skript dokumentieren",
];

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

async function control(path: string): Promise<void> {
  const response = await fetch(`${CONTROL_ORIGIN}${path}`, { method: "POST" });
  expect(response.status, `${path} -> ${response.status}`).toBe(200);
}

async function api<T = any>(path: string): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped JSON read by the assertions
  const response = await page.request.get(`${API_ORIGIN}/api/v1${path}`);
  return { status: response.status(), body: (await response.json()) as T };
}

async function shot(name: string): Promise<void> {
  await page.waitForTimeout(600); // let the last transition and the orb settle
  await page.screenshot({ path: join(evidenceDir, `${name}.png`) });
}

async function mainText(): Promise<string> {
  return page.locator("main").innerText();
}

/** Opens `path` and reloads every few seconds until the page text matches (outage/recovery propagate via health polling). */
async function openUntil(path: string, pattern: RegExp, timeoutMs = 60_000): Promise<string> {
  let text = "";
  await expect
    .poll(
      async () => {
        await page.goto(path);
        await page.locator("main").waitFor();
        await page.waitForTimeout(2500);
        text = await mainText();
        return pattern.test(text);
      },
      { timeout: timeoutMs, intervals: [500], message: `${path} should match ${String(pattern)}` },
    )
    .toBe(true);
  return text;
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "de-DE", timezoneId: "Europe/Berlin" });
  page = await context.newPage();
  await page.goto("/login");
  await page.waitForSelector("input[type=password]", { timeout: 60_000 });
  await page.locator("input").first().fill(OWNER_USERNAME);
  await page.locator("input[type=password]").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
});

test.afterAll(async () => {
  // Leave the fakes as found, also when an assertion failed half way through an outage.
  await Promise.allSettled([control("/services/voice/start"), control("/services/hermes/start")]);
  await context.close();
});

test("overview: Hermes work items, real host metrics and voice status", async () => {
  await page.goto("/");
  await expect(page.getByText("Hybrid-Modus").first()).toBeVisible();
  await expect(page.locator("main")).toContainText("Rückfrage zur Lieferzeit klären"); // blocked Hermes task in the live feed (a scrolling list, so not asserted as visible)
  const text = await mainText();
  expect(text).toMatch(/Sprache\s*\n?\s*Bereit/);
  expect(text).toMatch(/Agenten\s*\n?\s*1 aktiv/);
  expect(text).toMatch(/Modelle\s*\n?\s*2 verbunden/);

  const overview = (await api("/overview")).body.data;
  expect(overview.jarvis.dataMode).toBe("hybrid");
  expect(overview.runningTasks[0].source).toMatchObject({ adapterId: "hermes-tasks", system: "hermes" });
  expect(overview.activeAgents[0].source).toMatchObject({ adapterId: "hermes-agents", system: "hermes" });
  expect(overview.voice.source.adapterId).toBe("jarvis-voice-http");
  expect(overview.voice.wakeWord.phrase).toBe("Hey Friday");
  expect(overview.systemSummary.cpuPercent).toBeGreaterThanOrEqual(0);
  expect(overview.systemSummary.ramPercent).toBeGreaterThan(0);
  await shot("01-overview");
});

test("tasks: the Hermes Kanban tasks with source hermes", async () => {
  await page.goto("/tasks");
  await expect(page.getByText("7 Treffer")).toBeVisible();
  for (const title of HERMES_TASK_TITLES) await expect(page.getByText(title).first()).toBeVisible();
  expect(await mainText()).toMatch(/Quelle:\s*\n?\s*hermes/);
  const tasks = (await api("/tasks")).body;
  expect(tasks.items).toHaveLength(HERMES_TASK_TITLES.length);
  expect(tasks.items.every((task: { source: { system: string } }) => task.source.system === "hermes")).toBe(true);
  await shot("02-tasks");
});

test("agents: the Hermes profiles", async () => {
  await page.goto("/agents");
  await expect(page.getByText("3 Treffer")).toBeVisible();
  for (const name of ["Hermes", "Kira", "Milo"]) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Quartalsbericht für Brandt Logistik entwerfen").first()).toBeVisible(); // Kira's running task
  expect(await mainText()).toMatch(/Quelle:\s*\n?\s*hermes/);
  await shot("03-agents");
});

test("voice: fake voice service state and the wake phrase", async () => {
  await page.goto("/voice");
  await expect(page.getByText("„Hey Friday“").first()).toBeVisible();
  const text = await mainText();
  expect(text).toMatch(/Modus:\s*Bereit/);
  expect(text).toContain("qwen3-router");
  expect(text).not.toMatch(/nicht verbunden/i);
  await shot("04-voice");
});

test("system: services online, real host metrics, models", async () => {
  await page.goto("/system");
  const text = await openUntil("/system", /Voice-Dienst[\s\S]*Online/);
  for (const service of ["Qwen lokal (llama-server)", "Hermes API", "Hermes Dashboard", "Voice-Dienst"]) {
    expect(text, service).toContain(service);
  }
  expect(text).toMatch(/15 Adapter\s*\n?\s*\|?\s*15 online/);
  expect(text).toMatch(/Qwen \(lokal, llama\.cpp\)[\s\S]*Verbunden/);
  expect(text).toMatch(/Hermes \(API-Server\)[\s\S]*Verbunden/);

  const services = (await api("/system/services")).body.items as Array<{ name: string; status: string }>;
  expect(services.filter((service) => service.name !== "Control API").map((service) => service.status)).toEqual(["online", "online", "online", "online"]);
  const providers = (await api("/system/models")).body.items as Array<{ models: string[] }>;
  expect(providers.flatMap((provider) => provider.models).sort()).toEqual(["jarvis", "qwen3-router"]);
  const metrics = (await api("/system/metrics")).body.data;
  expect(Math.abs(metrics.ram.totalBytes - totalmem()) / totalmem()).toBeLessThan(0.02); // the host's real memory, not a mock number
  expect(metrics.cpu.cores).toBeGreaterThan(0);
  await shot("05-system");
});

test("outage: stopping the voice service marks exactly the voice module offline", async () => {
  await control("/services/voice/stop");

  const voice = await openUntil("/voice", /nicht verbunden/i);
  expect(voice).not.toContain("„Hey Friday“");
  await shot("06-voice-offline");

  const system = await openUntil("/system", /Voice-Dienst[\s\S]*Offline/);
  expect(system).toMatch(/14 online/);
  expect(system).toMatch(/1 offline/);
  expect(system).toMatch(/Hermes API[^|]*[\s\S]{0,200}Online/);
  const adapters = (await api("/adapters")).body.items as Array<{ manifest: { id: string }; health: { status: string } }>;
  expect(adapters.filter((adapter) => adapter.health.status !== "online").map((adapter) => adapter.manifest.id)).toEqual(["jarvis-voice-http"]);
  await shot("07-system-voice-offline");

  // everything else keeps working
  expect((await api("/voice/status")).status).toBe(503);
  await page.goto("/tasks");
  await expect(page.getByText("7 Treffer")).toBeVisible();
  await shot("08-tasks-voice-offline");
  await page.goto("/agents");
  await expect(page.getByText("3 Treffer")).toBeVisible();
  expect((await api("/tasks")).status).toBe(200);
  expect((await api("/memory")).status).toBe(200);
  await page.goto("/");
  await expect(page.locator("main")).toContainText("Rückfrage zur Lieferzeit klären");
  expect(await mainText()).toMatch(/Sprache\s*\n?\s*Nicht verbunden/);
  await shot("09-overview-voice-offline");
});

test("recovery: restarting the voice service brings the module back", async () => {
  await control("/services/voice/start");
  const voice = await openUntil("/voice", /„Hey Friday“/, 90_000);
  expect(voice).not.toMatch(/nicht verbunden/i);
  await shot("10-voice-recovered");
  const system = await openUntil("/system", /15 online/);
  expect(system).toMatch(/0 offline/);
  await shot("11-system-recovered");
});

test("outage: stopping Hermes marks tasks, activity and agents offline while voice and system keep working", async () => {
  await control("/services/hermes/stop");

  const tasks = await openUntil("/tasks", /nicht verbunden|nicht erreichbar|nicht verfügbar/i);
  expect(tasks).not.toContain("Angebot Nr. 2041 prüfen");
  await shot("12-tasks-hermes-offline");
  await openUntil("/agents", /nicht verbunden|nicht erreichbar|nicht verfügbar/i);
  await shot("13-agents-hermes-offline");

  const system = await openUntil("/system", /Hermes API[\s\S]*Offline/);
  expect(system).toMatch(/3 offline/);
  expect(system).toMatch(/Qwen lokal \(llama-server\)[\s\S]{0,200}Online/);
  const adapters = (await api("/adapters")).body.items as Array<{ manifest: { id: string }; health: { status: string } }>;
  expect(adapters.filter((adapter) => adapter.health.status !== "online").map((adapter) => adapter.manifest.id).sort()).toEqual(["hermes-activity", "hermes-agents", "hermes-tasks"]);
  await shot("14-system-hermes-offline");

  expect((await api("/voice/status")).status).toBe(200);
  expect((await api("/system/services")).status).toBe(200);
  expect((await api("/memory")).status).toBe(200);
  expect((await api("/tasks")).status).toBe(503);
  await page.goto("/voice");
  await expect(page.getByText("„Hey Friday“").first()).toBeVisible();
  await shot("15-voice-while-hermes-offline");
});

test("recovery: restarting Hermes brings tasks and agents back", async () => {
  await control("/services/hermes/start");
  const tasks = await openUntil("/tasks", /7 Treffer/, 90_000);
  expect(tasks).toContain("Angebot Nr. 2041 prüfen");
  await shot("16-tasks-recovered");
  await openUntil("/agents", /3 Treffer/);
  const system = await openUntil("/system", /15 online/);
  expect(system).toMatch(/0 offline/);
  await shot("17-system-recovered");
});
