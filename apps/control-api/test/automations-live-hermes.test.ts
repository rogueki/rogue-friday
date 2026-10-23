import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

/**
 * Acceptance for DASH-17.04 against a running Hermes installation. The suite skips itself when no dashboard answers on
 * the configured URL, so CI and machines without Hermes stay green; the evidence is produced on the operator host.
 *
 * Run with: FRIDAY_HERMES_DASHBOARD=http://127.0.0.1:43791 pnpm exec vitest run apps/control-api/test/automations-live-hermes.test.ts
 */
const DASHBOARD = process.env.FRIDAY_HERMES_DASHBOARD ?? "http://127.0.0.1:43791";
const PASSWORD = "Automation-Live-2026!";

const adaptersYaml = `allowlist:
  hermes-automations: "@friday/adapter-hermes"
  mock-tasks: "@friday/adapter-mock"
  mock-activity: "@friday/adapter-mock"
  mock-agents: "@friday/adapter-mock"
  mock-memory: "@friday/adapter-mock"
  mock-approvals: "@friday/adapter-mock"
  mock-communication: "@friday/adapter-mock"
  mock-calendar: "@friday/adapter-mock"
  mock-research: "@friday/adapter-mock"
  mock-files: "@friday/adapter-mock"
  mock-notifications: "@friday/adapter-mock"
  mock-notes: "@friday/adapter-mock"
  mock-system: "@friday/adapter-mock"
  mock-voice: "@friday/adapter-mock"
adapters:
  automations:
    provider: hermes-automations
    enabled: true
    timeoutMs: 10000
    config:
      dashboardBaseUrl: ${DASHBOARD}
      dashboardAuth: scrape
`;

async function hermesReachable(): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/health", DASHBOARD), { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

const reachable = await hermesReachable();

/**
 * Every automation write is staged as a preview first: the first call answers 403 with the preview id, the repeat with
 * `x-action-preview-id` executes the unchanged action. That double step is part of the acceptance, not a workaround.
 */
async function confirmed(
  client: ReturnType<TestApi["client"]>,
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
) {
  const staged = await client.request(method, path, { body });
  if (staged.statusCode !== 403) return staged;
  const previewId = staged.json()?.error?.details?.previewId;
  expect(previewId, JSON.stringify(staged.body)).toBeTruthy();
  return client.request(method, path, { body, headers: { "x-action-preview-id": String(previewId) } });
}

async function disableTier2(client: ReturnType<TestApi["client"]>): Promise<void> {
  const settings = (await client.get("/api/v1/settings")).json().data;
  const patched = await client.patch(
    "/api/v1/settings",
    { approvals: { ...settings.approvals, confirmTier2: false } },
    { headers: { "if-match": String(settings.version) } },
  );
  expect(patched.statusCode, JSON.stringify(patched.body)).toBe(200);
}

describe.skipIf(!reachable)("automations against a running Hermes", () => {
  let api: TestApi;
  let owner: ReturnType<TestApi["client"]>;
  let automationId: string | undefined;

  beforeAll(async () => {
    api = await startTestApi({ dataMode: "live", authMode: "local", adaptersYaml, ownerPassword: PASSWORD });
    owner = api.client();
    expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
    await disableTier2(owner);
  });

  afterAll(async () => {
    if (automationId) {
      await owner.post(`/api/v1/automations/${automationId}/disable`, {});
    }
    await api.close();
  });

  it("creates, triggers, tracks, pauses and re-finds a real automation after a restart", async () => {
    const created = await confirmed(owner, "POST", "/api/v1/automations", {
      name: "F.R.I.D.A.Y. Abnahme",
      enabled: true,
      trigger: { type: "schedule", schedule: "0 4 * * *", description: "Taeglich 04:00" },
      conditions: [],
      actions: [
        {
          id: "act_probe",
          type: "run_agent",
          requiresApproval: false,
          description: "Traegt nur einen Vermerk ein",
          // Ein Skriptlauf beweist die Kette ohne Modellaufruf: Hermes fuehrt das Skript ohne Agenten aus.
          params: { script: "friday-acceptance.sh", mode: "script" },
        },
      ],
    });
    expect(created.statusCode, JSON.stringify(created.body)).toBeLessThan(300);
    const automation = created.json().data;
    automationId = automation.id;
    expect(automation.source.adapterId).toBe("hermes-automations");
    expect(automation.enabled).toBe(true);

    const run = await confirmed(owner, "POST", `/api/v1/automations/${automationId}/test`, { dryRun: false });
    expect(run.statusCode, JSON.stringify(run.body)).toBeLessThan(300);
    const executed = run.json().data;
    expect(executed.dryRun).toBe(false);
    expect(["succeeded", "running", "failed"]).toContain(executed.status);

    const runs = await owner.get(`/api/v1/automations/${automationId}/runs?limit=5`);
    expect(runs.statusCode).toBe(200);
    // Genau ein Lauf je Ausloesung: der Adapter plant selbst nichts nach und wiederholt den Trigger nicht.
    expect(runs.json().items).toHaveLength(1);
    expect(runs.json().items[0].automationId).toBe(automationId);

    const paused = await confirmed(owner, "POST", `/api/v1/automations/${automationId}/disable`, {});
    expect(paused.statusCode, JSON.stringify(paused.body)).toBeLessThan(300);
    expect(paused.json().data.enabled).toBe(false);

    // Restart: a fresh API process must find the same automation through the adapter's id mapping.
    await api.close();
    api = await startTestApi({ dataMode: "live", authMode: "local", adaptersYaml, ownerPassword: PASSWORD });
    owner = api.client();
    expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
    const afterRestart = await owner.get(`/api/v1/automations/${automationId}`);
    expect(afterRestart.statusCode, JSON.stringify(afterRestart.body)).toBe(200);
    expect(afterRestart.json().data.id).toBe(automationId);
    expect(afterRestart.json().data.paused).toBe(true);
  }, 120_000);

  it("keeps the schedule expression byte-identical and reports a failing action as a failed run", async () => {
    await disableTier2(owner);
    const created = await confirmed(owner, "POST", "/api/v1/automations", {
      name: "F.R.I.D.A.Y. Fehlerfall",
      enabled: true,
      // 02:30 ist die Stunde, die bei Zeitumstellung doppelt bzw. gar nicht existiert. Der Ausdruck wird unveraendert
      // durchgereicht; die Auswertung liegt bei Hermes, F.R.I.D.A.Y. verschiebt nichts.
      trigger: { type: "schedule", schedule: "30 2 * * *", description: "Taeglich 02:30" },
      conditions: [],
      actions: [
        {
          id: "act_fail",
          type: "run_agent",
          requiresApproval: false,
          description: "Skript bricht mit Exitcode 3 ab",
          params: { script: "friday-acceptance-fail.sh", mode: "script" },
        },
      ],
    });
    expect(created.statusCode, JSON.stringify(created.body)).toBeLessThan(300);
    const failing = created.json().data;
    expect(failing.trigger.schedule).toBe("30 2 * * *");

    const run = await confirmed(owner, "POST", `/api/v1/automations/${failing.id}/test`, { dryRun: false });
    expect(run.statusCode, JSON.stringify(run.body)).toBeLessThan(300);
    expect(run.json().data.status).toBe("failed");

    const disabled = await confirmed(owner, "POST", `/api/v1/automations/${failing.id}/disable`, {});
    expect(disabled.statusCode, JSON.stringify(disabled.body)).toBeLessThan(300);
    expect(disabled.json().data.enabled).toBe(false);
    // Der Contract bietet kein Loeschen: die deaktivierte Automation bleibt sichtbar und wird ausserhalb von
    // F.R.I.D.A.Y. in Hermes entfernt (siehe dash-17-04-acceptance.md).
    const stillThere = await owner.get(`/api/v1/automations/${failing.id}`);
    expect(stillThere.statusCode).toBe(200);
  }, 120_000);

});