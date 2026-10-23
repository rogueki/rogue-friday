import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdapterError, PORT_SPEC, validatePortResult } from "@friday/adapter-core";
import { HermesAutomationsAdapter } from "../src";
import { createHermesFake, type HermesFake } from "./fake/server";
import { start, type Harness } from "./helpers";

let fake: HermesFake;
let harness: Harness<HermesAutomationsAdapter> | undefined;

async function open(config: Record<string, unknown> = {}) {
  harness = await start(
    new HermesAutomationsAdapter(),
    {
      apiBaseUrl: fake.apiUrl,
      dashboardBaseUrl: fake.dashboardUrl,
      timeoutMs: 800,
      maxAttempts: 2,
      retryBaseDelayMs: 5,
      pollIntervalMs: 0,
      ...config,
    },
    {},
  );
  return harness;
}

async function rejection(promise: Promise<unknown>): Promise<AdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return error as AdapterError;
  }
  throw new Error("expected a rejection");
}

beforeEach(async () => {
  fake = await createHermesFake();
});

afterEach(async () => {
  await harness?.stop();
  harness = undefined;
  await fake.close();
});

describe("automations on Hermes cron", () => {
  it("lists contract-valid automations with trigger, actions and paused state", async () => {
    const { adapter, call } = await open();
    const scheduled = fake.state.createCronJob({
      name: "Wochenreport",
      prompt: "Fasse die Woche zusammen",
      skills: ["reporting"],
      enabled: true,
      state: "scheduled",
      paused_reason: null,
      deliver: "telegram",
    });
    fake.state.createCronJob({ name: "Skriptjob", script: "backup.sh", no_agent: true });

    const page = await adapter.listAutomations({}, call());
    validatePortResult(PORT_SPEC.automations.listAutomations, page, { what: "listAutomations" });
    expect(page.items).toHaveLength(2);

    const report = page.items.find((automation) => automation.name === "Wochenreport")!;
    expect(report.id).toMatch(/^auto_[0-9A-Za-z]{26}$/);
    expect(report.source).toMatchObject({ adapterId: "hermes-automations", system: "hermes", externalId: scheduled.id });
    expect(report.enabled).toBe(true);
    expect(report.paused).toBe(false);
    expect(report.trigger).toMatchObject({ type: "schedule", schedule: "0 3 * * *" });
    expect(report.actions.map((action) => action.type)).toEqual(["run_agent", "notify"]);
    expect(report.actions[1]).toMatchObject({ type: "notify", channel: "telegram" });
    expect(report.conditions).toEqual([]);
    expect(report.escalation).toEqual([]);

    const script = page.items.find((automation) => automation.name === "Skriptjob")!;
    expect(script.enabled).toBe(false);
    expect(script.paused).toBe(true);
    expect(script.actions[0]).toMatchObject({ type: "run_agent", params: { script: "backup.sh", mode: "script" } });
  });

  it("filters by enabled and search term, and reports unknown ids as NOT_FOUND", async () => {
    const { adapter, call } = await open();
    fake.state.createCronJob({ name: "Nachtlauf", enabled: true, state: "scheduled" });
    fake.state.createCronJob({ name: "Archivpruefung" });

    const enabled = await adapter.listAutomations({ enabled: true }, call());
    expect(enabled.items.map((automation) => automation.name)).toEqual(["Nachtlauf"]);

    const search = await adapter.listAutomations({ q: "archiv" }, call());
    expect(search.items.map((automation) => automation.name)).toEqual(["Archivpruefung"]);

    const error = await rejection(adapter.getAutomation({ id: "auto_00000000000000000000000000" }, call()));
    expect(error.code).toBe("NOT_FOUND");
  });

  it("reads one automation and its run history after a trigger", async () => {
    const { adapter, call } = await open();
    const job = fake.state.createCronJob({ name: "Morgenbriefing", prompt: "Berichte", enabled: true, state: "scheduled" });
    const page = await adapter.listAutomations({}, call());
    const id = page.items[0]!.id;

    const single = await adapter.getAutomation({ id }, call());
    validatePortResult(PORT_SPEC.automations.getAutomation, single, { what: "getAutomation" });
    expect(single.data.id).toBe(id);

    fake.state.triggerCronJob(job.id);
    const runs = await adapter.listAutomationRuns({ id, limit: 10 }, call());
    validatePortResult(PORT_SPEC.automations.listAutomationRuns, runs, { what: "listAutomationRuns" });
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({ automationId: id, status: "succeeded", dryRun: false });
    expect(runs.items[0]!.actionsExecuted).toHaveLength(1);
    expect(runs.items[0]!.correlationId).toMatch(/^corr_[0-9A-Za-z]{26}$/);
  });

  it("creates a Hermes job and activates it only when the request asks for it", async () => {
    const { adapter, mutation } = await open();
    const created = await adapter.createAutomation(
      {
        body: {
          name: "Abendcheck",
          enabled: true,
          trigger: { type: "schedule", schedule: "0 21 * * *", description: "Taeglich 21 Uhr" },
          conditions: [],
          actions: [
            {
              id: "act_run",
              type: "run_agent",
              requiresApproval: false,
              description: "Agent berichtet",
              params: { prompt: "Berichte den Tagesstand" },
            },
          ],
        },
      },
      mutation({ idempotencyKey: "create-1" }),
    );
    validatePortResult(PORT_SPEC.automations.createAutomation, created, { what: "createAutomation" });
    expect(created.data.name).toBe("Abendcheck");
    expect(created.data.enabled).toBe(true);
    const job = [...fake.state.cronJobs.values()][0]!;
    expect(job).toMatchObject({ name: "Abendcheck", schedule: { expr: "0 21 * * *" }, deliver: "local" });
    expect(job.prompt).toBe("Berichte den Tagesstand");
  });

  it("runs a test execution and reports it as a real, non-dry run", async () => {
    const { adapter, call, mutation } = await open();
    const job = fake.state.createCronJob({ name: "Testlauf", script: "check.sh", no_agent: true, enabled: true, state: "scheduled" });
    const id = (await adapter.listAutomations({}, call())).items[0]!.id;

    const run = await adapter.testAutomation({ id, body: { dryRun: false } }, mutation({ idempotencyKey: "test-1" }));
    validatePortResult(PORT_SPEC.automations.testAutomation, run, { what: "testAutomation" });
    expect(run.data.dryRun).toBe(false);
    expect(run.data.status).toBe("succeeded");
    expect(run.data.triggerReason).toContain("Manueller Testlauf");
    expect(fake.state.cronJobs.get(job.id)!.repeat.completed).toBe(1);
  });

  it("pauses and resumes through the cron endpoints and honours If-Match", async () => {
    const { adapter, call, mutation } = await open();
    fake.state.createCronJob({ name: "Pausierbar", enabled: true, state: "scheduled" });
    const id = (await adapter.listAutomations({}, call())).items[0]!.id;

    const disabled = await adapter.disableAutomation({ id }, mutation({ idempotencyKey: "off-1" }));
    validatePortResult(PORT_SPEC.automations.disableAutomation, disabled, { what: "disableAutomation" });
    expect(disabled.data.paused).toBe(true);
    expect(disabled.data.enabled).toBe(false);

    const enabled = await adapter.enableAutomation({ id }, mutation({ idempotencyKey: "on-1" }));
    expect(enabled.data.enabled).toBe(true);
    expect(enabled.data.paused).toBe(false);

    const stale = await rejection(
      adapter.updateAutomation(
        { id, body: { name: "Anders" } },
        mutation({ idempotencyKey: "upd-1", ifMatchVersion: enabled.data.version + 5 }),
      ),
    );
    expect(stale.code).toBe("CONFLICT");

    const updated = await adapter.updateAutomation(
      { id, body: { name: "Umbenannt" } },
      mutation({ idempotencyKey: "upd-2", ifMatchVersion: enabled.data.version }),
    );
    expect(updated.data.name).toBe("Umbenannt");
  });

  it("reports upstream failures as adapter errors instead of inventing automations", async () => {
    const { adapter, call } = await open();
    fake.state.cronJobs.clear();
    const page = await adapter.listAutomations({}, call());
    expect(page.items).toEqual([]);
    expect(page.pageInfo.hasNextPage).toBe(false);
  });
});