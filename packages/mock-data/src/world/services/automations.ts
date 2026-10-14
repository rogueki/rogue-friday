import type {
  Automation,
  AutomationCondition,
  AutomationCreateRequest,
  AutomationRun,
  AutomationTestRequest,
  AutomationUpdateRequest,
} from "@jarvis/sdk";
import { isValidCron, nextCronRun } from "../../core/cron";
import { notFound, validationFailed } from "../../core/errors";
import { asBool, clone, compareAsc, compareDesc, matchesQuery, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { pageOf, type Query } from "./shared";

export type AutomationListQuery = Query<"listAutomations">;
export type AutomationRunQuery = Query<"listAutomationRuns">;

function readPath(sample: Record<string, unknown>, field: string): unknown {
  if (field in sample) return sample[field];
  return field.split(".").reduce<unknown>((current, part) => (current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined), sample);
}

export function evaluateCondition(condition: AutomationCondition, actual: unknown): boolean {
  const expected = condition.value as unknown;
  switch (condition.operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "contains":
      return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase());
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "matches":
      try {
        return new RegExp(String(expected), "i").test(String(actual ?? ""));
      } catch {
        return false;
      }
  }
}

export class AutomationService {
  constructor(private readonly w: MockWorld) {}

  find(id: string): Automation {
    const automation = this.w.state.automations.find((candidate) => candidate.id === id);
    if (!automation) throw notFound("Automation", id);
    return automation;
  }

  list(query: AutomationListQuery = {}): Page<Automation> {
    return this.w.read("listAutomations", () => {
      const enabled = asBool(query.enabled);
      const items = this.w.state.automations
        .filter((automation) => (enabled === undefined ? true : automation.enabled === enabled))
        .filter((automation) => matchesQuery(`${automation.name} ${automation.description ?? ""}`, query.q))
        .sort((a, b) => compareAsc(a.name, b.name) || compareAsc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  get(id: string): Automation {
    return this.w.read("getAutomation", () => clone(this.find(id)));
  }

  create(body: AutomationCreateRequest, ctx?: OpContext): Automation {
    return this.w.run("createAutomation", ctx, body, () => {
      this.w.validate("AutomationCreateRequest", body);
      this.assertTrigger(body.trigger);
      const now = this.w.nowIso();
      const automation: Automation = {
        id: this.w.id("auto"),
        version: 1,
        createdAt: now,
        updatedAt: now,
        source: this.w.source("automations"),
        name: body.name,
        ...(body.description ? { description: body.description } : {}),
        enabled: body.enabled ?? true,
        paused: false,
        trigger: body.trigger,
        conditions: body.conditions,
        actions: body.actions,
        escalation: body.escalation ?? [],
        nextRunAt: null,
        lastRunAt: null,
        lastSuccess: null,
        lastError: null,
        runCount: 0,
      };
      automation.nextRunAt = this.computeNextRun(automation);
      this.w.state.automations.push(automation);
      this.publish(automation, ctx, "automation.created", null);
      return clone(automation);
    });
  }

  update(id: string, body: AutomationUpdateRequest, ctx?: OpContext): Automation {
    return this.w.run("updateAutomation", ctx, { id, body }, () => {
      this.w.validate("AutomationUpdateRequest", body);
      const automation = this.find(id);
      this.w.assertVersion(automation, ctx, "Automation");
      if (body.trigger) this.assertTrigger(body.trigger);
      const before = { enabled: automation.enabled, paused: automation.paused, name: automation.name };
      if (body.name !== undefined) automation.name = body.name;
      if (body.description !== undefined) automation.description = body.description;
      if (body.enabled !== undefined) automation.enabled = body.enabled;
      if (body.paused !== undefined) automation.paused = body.paused;
      if (body.trigger) automation.trigger = body.trigger;
      if (body.conditions) automation.conditions = body.conditions;
      if (body.actions) automation.actions = body.actions;
      if (body.escalation) automation.escalation = body.escalation;
      automation.nextRunAt = this.computeNextRun(automation);
      this.w.bump(automation);
      this.publish(automation, ctx, "automation.updated", before);
      return clone(automation);
    });
  }

  enable(id: string, ctx?: OpContext): Automation {
    return this.w.run("enableAutomation", ctx, { id }, () => this.toggle(id, true, ctx));
  }

  disable(id: string, ctx?: OpContext): Automation {
    return this.w.run("disableAutomation", ctx, { id }, () => this.toggle(id, false, ctx));
  }

  listRuns(id: string, query: AutomationRunQuery = {}): Page<AutomationRun> {
    return this.w.read("listAutomationRuns", () => {
      this.find(id);
      const items = this.w.state.automationRuns.filter((run) => run.automationId === id).sort((a, b) => compareDesc(a.triggeredAt, b.triggeredAt) || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  /**
   * Dry run (default) or real run against sample data. A dry run only explains what would happen: why it
   * fired, which conditions held, which actions it would take. Nothing is executed or sent.
   */
  test(id: string, body: AutomationTestRequest = {}, ctx?: OpContext): AutomationRun {
    return this.w.run("testAutomation", ctx, { id, body }, () => {
      this.w.validate("AutomationTestRequest", body);
      const automation = this.find(id);
      const dryRun = body.dryRun ?? true;
      const correlationId = this.w.correlationId(ctx);
      const startedAt = this.w.nowIso();
      const sample = body.sampleData;
      const conditionsEvaluated = automation.conditions.map((condition) => {
        if (!sample) return { conditionId: condition.id, met: true, detail: `${condition.description}: ohne Beispieldaten als erfüllt angenommen (Mock)` };
        const actual = readPath(sample, condition.field);
        const met = evaluateCondition(condition, actual);
        return { conditionId: condition.id, met, detail: `${condition.description}: ${met ? "erfüllt" : "nicht erfüllt"} (Wert: ${JSON.stringify(actual ?? null)})` };
      });
      const allMet = conditionsEvaluated.every((entry) => entry.met);
      const run: AutomationRun = {
        id: this.w.id("run"),
        version: 1,
        createdAt: startedAt,
        updatedAt: startedAt,
        source: this.w.source("automations"),
        automationId: automation.id,
        automationVersion: automation.version,
        status: "running",
        dryRun,
        triggeredAt: startedAt,
        finishedAt: null,
        triggerReason: `Manueller ${dryRun ? "Trockenlauf" : "Test"} – Auslöser wäre: ${automation.trigger.description}`,
        conditionsEvaluated,
        actionsExecuted: [],
        result: "",
        correlationId,
      };
      this.w.emitFor("automations", "jarvis.automation.run_started", run, `automation/${automation.id}`, correlationId);

      const executedAt = this.w.nowIso();
      run.actionsExecuted = automation.actions.map((action) => {
        if (!allMet) return { actionId: action.id, status: "skipped" as const, executedAt, resultSummary: "Übersprungen, weil nicht alle Bedingungen erfüllt waren." };
        if (dryRun) return { actionId: action.id, status: "simulated" as const, executedAt, resultSummary: `Würde ausführen: ${action.description}${action.requiresApproval ? " (mit Freigabe)" : ""}` };
        if (action.requiresApproval) {
          const approval = this.w.approvals.raise({
            type: "send_message",
            action: `Automation „${automation.name}“: ${action.description}`,
            riskTier: 2,
            rationale: `Die Automation „${automation.name}“ möchte diese Aktion ausführen und benötigt Ihre Freigabe.`,
            preview: { kind: "text", title: action.description, body: `Aktion ${action.type} der Automation ${automation.name}` },
            correlationId,
          });
          return { actionId: action.id, status: "skipped" as const, executedAt, resultSummary: `Wartet auf Freigabe (${approval.id}).` };
        }
        if (action.type === "notify") {
          this.w.notifications.raise({ priority: "P3", category: "automation", title: `Automation „${automation.name}“: ${action.description}`, body: "Aktion wurde bei einem Testlauf ausgelöst.", chain: ["dashboard"], correlationId });
        } else if (action.type === "create_task") {
          this.w.tasks.spawn({ title: String((action.params as Record<string, unknown> | undefined)?.title ?? `Aufgabe aus Automation ${automation.name}`), status: "todo", correlationId });
        }
        return { actionId: action.id, status: "succeeded" as const, executedAt, resultSummary: `${action.description}: ausgeführt` };
      });
      const metCount = conditionsEvaluated.filter((entry) => entry.met).length;
      run.status = dryRun ? "dry_run" : allMet ? "succeeded" : "skipped";
      run.finishedAt = this.w.nowIso();
      run.result = !allMet
        ? `Nicht ausgeführt: ${metCount} von ${conditionsEvaluated.length} Bedingungen erfüllt.`
        : dryRun
          ? `Trockenlauf: ${metCount} von ${conditionsEvaluated.length} Bedingungen erfüllt, ${run.actionsExecuted.length} Aktion(en) simuliert. Es wurde nichts ausgeführt.`
          : `${run.actionsExecuted.filter((entry) => entry.status === "succeeded").length} Aktion(en) ausgeführt.`;
      run.updatedAt = run.finishedAt;
      this.w.state.automationRuns.push(run);
      this.w.emitFor("automations", "jarvis.automation.run_finished", run, `automation/${automation.id}`, correlationId);

      if (!dryRun) {
        automation.lastRunAt = run.finishedAt;
        automation.runCount += 1;
        if (run.status === "succeeded") automation.lastSuccess = { at: run.finishedAt, runId: run.id };
        this.w.bump(automation);
        this.w.emitFor("automations", "jarvis.automation.updated", automation, `automation/${automation.id}`, correlationId);
      }
      this.w.recordAudit({
        category: "user_action",
        action: dryRun ? "automation.dry_run" : "automation.test_run",
        correlationId,
        adapterId: "mock-automations",
        actor: this.w.actorOf(ctx),
        context: { automationId: automation.id, runId: run.id, conditionsMet: `${metCount}/${conditionsEvaluated.length}` },
      });
      return clone(run);
    });
  }

  /** Pause or resume all automations (`/commands/pause|resume` with scope automations). */
  setAllPaused(paused: boolean, ctx?: OpContext): number {
    let changed = 0;
    for (const automation of this.w.state.automations) {
      if (automation.paused === paused) continue;
      automation.paused = paused;
      automation.nextRunAt = this.computeNextRun(automation);
      this.w.bump(automation);
      this.w.emitFor("automations", "jarvis.automation.updated", automation, `automation/${automation.id}`, ctx?.correlationId);
      changed++;
    }
    return changed;
  }

  private toggle(id: string, enabled: boolean, ctx?: OpContext): Automation {
    const automation = this.find(id);
    this.w.assertVersion(automation, ctx, "Automation");
    const before = { enabled: automation.enabled };
    automation.enabled = enabled;
    automation.nextRunAt = this.computeNextRun(automation);
    this.w.bump(automation);
    this.publish(automation, ctx, enabled ? "automation.enabled" : "automation.disabled", before);
    return clone(automation);
  }

  private computeNextRun(automation: Automation): string | null {
    if (!automation.enabled || automation.paused) return null;
    if (automation.trigger.type !== "schedule" || !automation.trigger.schedule) return null;
    return nextCronRun(automation.trigger.schedule, this.w.nowMs(), automation.trigger.timeZone);
  }

  private assertTrigger(trigger: Automation["trigger"]): void {
    if (trigger.type === "schedule" && (!trigger.schedule || !isValidCron(trigger.schedule))) {
      throw validationFailed("Der Zeitplan ist kein gültiger Cron-Ausdruck (5 Felder).", [{ path: "trigger.schedule", message: "ungültiger Cron-Ausdruck" }]);
    }
    if (trigger.type === "event" && !trigger.event) {
      throw validationFailed("Ereignis-Trigger benötigen ein Ereignis.", [{ path: "trigger.event", message: "erforderlich" }]);
    }
  }

  private publish(automation: Automation, ctx: OpContext | undefined, action: string, before: Record<string, unknown> | null): void {
    const correlationId = this.w.correlationId(ctx);
    this.w.emitFor("automations", "jarvis.automation.updated", automation, `automation/${automation.id}`, correlationId);
    this.w.recordAudit({
      category: "user_action",
      action,
      correlationId,
      adapterId: "mock-automations",
      actor: this.w.actorOf(ctx),
      before,
      after: { enabled: automation.enabled, paused: automation.paused, version: automation.version },
    });
  }
}
