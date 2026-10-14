import type {
  Automation,
  AutomationAction,
  AutomationCondition,
  AutomationRun,
  AutomationTrigger,
  AutomationVersion,
  EscalationStep,
} from "@jarvis/sdk";
import { nextCronRun } from "../core/cron";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import type { AutomationKey, Story } from "./story";

/** The contract declares `value` as any JSON but the generated type is narrower; this keeps the cast in one place. */
export const conditionValue = (value: unknown): AutomationCondition["value"] => value as AutomationCondition["value"];

interface AutomationSpec {
  key: AutomationKey;
  name: string;
  description: string;
  enabled: boolean;
  paused?: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  escalation: EscalationStep[];
  runCount: number;
  lastRunAgoMs: number | null;
  lastErrorAgoMs?: number;
  lastErrorMessage?: string;
}

const SPECS: AutomationSpec[] = [
  {
    key: "wichtigeMail",
    name: "Wichtige Mail eskalieren",
    description: "Neue P1-Mail → Telegram, nach 10 Minuten ohne Bestätigung Anruf.",
    enabled: true,
    trigger: { type: "event", event: "jarvis.communication.thread_updated", description: "Neuer E-Mail-Thread mit Priorität P1" },
    conditions: [
      { id: "cond_1", field: "thread.priority", operator: "eq", value: conditionValue("P1"), description: "Priorität ist P1" },
      { id: "cond_2", field: "thread.channelKind", operator: "eq", value: conditionValue("email"), description: "Kanal ist E-Mail" },
    ],
    actions: [
      { id: "act_1", type: "set_priority", params: { priority: "P1" }, requiresApproval: false, description: "Priorität auf P1 setzen" },
      { id: "act_2", type: "notify", channel: "telegram", requiresApproval: false, description: "Telegram-Nachricht senden" },
    ],
    escalation: [{ afterSeconds: 600, channel: "phone", description: "Anruf nach 10 Minuten ohne Bestätigung", stopOnAcknowledge: true }],
    runCount: 23,
    lastRunAgoMs: 26 * MIN,
  },
  {
    key: "morgenBriefing",
    name: "Morgenbriefing erstellen",
    description: "Werktags um 07:00 Uhr: Termine, offene Freigaben und wichtige Mails zusammenfassen.",
    enabled: true,
    trigger: { type: "schedule", schedule: "0 7 * * 1-5", timeZone: "Europe/Berlin", description: "Montag bis Freitag um 07:00 Uhr" },
    conditions: [],
    actions: [
      { id: "act_1", type: "run_agent", params: { agent: "Task-Agent", prompt: "Morgenbriefing" }, requiresApproval: false, description: "Task-Agent erstellt das Briefing" },
      { id: "act_2", type: "notify", channel: "dashboard", requiresApproval: false, description: "Briefing im Dashboard anzeigen" },
    ],
    escalation: [],
    runCount: 112,
    lastRunAgoMs: 3 * HOUR + 15 * MIN,
  },
  {
    key: "backupCheck",
    name: "Backup-Verifikation",
    description: "Täglich um 22:00 Uhr Prüfsummen der Sicherungen kontrollieren; bei Abweichung benachrichtigen.",
    enabled: true,
    trigger: { type: "schedule", schedule: "0 22 * * *", timeZone: "Europe/Berlin", description: "Täglich um 22:00 Uhr" },
    conditions: [],
    actions: [
      { id: "act_1", type: "run_agent", params: { agent: "System-Agent", prompt: "Backup prüfen" }, requiresApproval: false, description: "System-Agent prüft die Sicherung" },
    ],
    escalation: [{ afterSeconds: 1800, channel: "telegram", description: "Telegram, falls Fehler unquittiert bleibt", stopOnAcknowledge: true }],
    runCount: 58,
    lastRunAgoMs: 14 * HOUR + 15 * MIN,
  },
  {
    key: "terminKonflikt",
    name: "Terminkonflikte melden",
    description: "Bei neu erkanntem Konflikt Benachrichtigung auslösen und Aufgabe zur Lösung anlegen.",
    enabled: true,
    trigger: { type: "event", event: "jarvis.calendar.conflict_detected", description: "Konflikt im Kalender erkannt" },
    conditions: [{ id: "cond_1", field: "conflict.severity", operator: "in", value: conditionValue(["warning", "error", "critical"]), description: "Schweregrad mindestens Warnung" }],
    actions: [
      { id: "act_1", type: "notify", channel: "dashboard", requiresApproval: false, description: "Hinweis im Dashboard" },
      { id: "act_2", type: "create_task", params: { title: "Terminkonflikt lösen" }, requiresApproval: false, description: "Aufgabe für den Kalender-Agent anlegen" },
    ],
    escalation: [],
    runCount: 9,
    lastRunAgoMs: 2 * HOUR,
    lastErrorAgoMs: 3 * DAY,
    lastErrorMessage: "Aufgabe konnte nicht angelegt werden: Task-Adapter nicht erreichbar.",
  },
  {
    key: "rechnungen",
    name: "Rechnungseingang prüfen",
    description: "Neue Rechnungs-Mails automatisch einlesen und Prüfaufgabe erzeugen (derzeit deaktiviert).",
    enabled: false,
    trigger: { type: "event", event: "jarvis.communication.thread_updated", description: "Neuer Thread mit Betreff 'Rechnung'" },
    conditions: [{ id: "cond_1", field: "thread.subject", operator: "contains", value: conditionValue("Rechnung"), description: "Betreff enthält 'Rechnung'" }],
    actions: [
      { id: "act_1", type: "create_task", params: { title: "Rechnung prüfen" }, requiresApproval: false, description: "Prüfaufgabe anlegen" },
      { id: "act_2", type: "draft_message", channel: "email", requiresApproval: true, description: "Eingangsbestätigung als Entwurf" },
    ],
    escalation: [],
    runCount: 5,
    lastRunAgoMs: 9 * DAY,
  },
  {
    key: "nachtruhe",
    name: "Nachtruhe aktivieren",
    description: "Ab 22:00 Uhr nur noch P0-Benachrichtigungen zustellen.",
    enabled: true,
    paused: true,
    trigger: { type: "schedule", schedule: "0 22 * * *", timeZone: "Europe/Berlin", description: "Täglich um 22:00 Uhr" },
    conditions: [],
    actions: [{ id: "act_1", type: "webhook", params: { target: "quiet-hours" }, requiresApproval: false, description: "Ruhezeit-Profil aktivieren" }],
    escalation: [],
    runCount: 40,
    lastRunAgoMs: 14 * HOUR + 15 * MIN,
  },
];

export interface AutomationSeed {
  automations: Automation[];
  runs: AutomationRun[];
}

export function buildAutomations(ctx: SeedContext, story: Story): AutomationSeed {
  const automations: Automation[] = [];
  const runs: AutomationRun[] = [];
  for (const spec of SPECS) {
    const automationId = story.automations[spec.key];
    const version = ctx.rng.int(2, 5);
    const runIds: { success?: string; error?: string } = {};
    const specRuns = Math.min(4, spec.runCount);
    for (let i = 0; i < specRuns; i++) {
      const failed = spec.lastErrorAgoMs !== undefined && i === specRuns - 1;
      const agoMs =
        failed && spec.lastErrorAgoMs !== undefined
          ? spec.lastErrorAgoMs
          : (spec.lastRunAgoMs ?? DAY) + i * (spec.trigger.type === "schedule" ? DAY : 7 * HOUR);
      const run = buildRun(ctx, spec, automationId, version, agoMs, failed);
      runs.push(run);
      if (failed) runIds.error = run.id;
      else if (!runIds.success) runIds.success = run.id;
    }
    const lastRun = spec.lastRunAgoMs !== null ? ctx.at(-spec.lastRunAgoMs) : null;
    automations.push({
      id: automationId,
      version,
      createdAt: ctx.at(-60 * DAY),
      updatedAt: ctx.at(-ctx.rng.int(1, 20) * DAY),
      source: ctx.src("automations"),
      name: spec.name,
      description: spec.description,
      enabled: spec.enabled,
      paused: spec.paused ?? false,
      trigger: spec.trigger,
      conditions: spec.conditions,
      actions: spec.actions,
      escalation: spec.escalation,
      nextRunAt:
        spec.enabled && !spec.paused && spec.trigger.type === "schedule" && spec.trigger.schedule
          ? nextCronRun(spec.trigger.schedule, ctx.now, spec.trigger.timeZone)
          : null,
      lastRunAt: lastRun,
      lastSuccess: runIds.success && lastRun ? { at: ctx.at(-(spec.lastRunAgoMs ?? 0)), runId: runIds.success } : null,
      lastError:
        runIds.error && spec.lastErrorAgoMs !== undefined
          ? { at: ctx.at(-spec.lastErrorAgoMs), message: spec.lastErrorMessage ?? "Ausführung fehlgeschlagen.", runId: runIds.error }
          : null,
      runCount: spec.runCount,
    });
  }
  return { automations, runs };
}

function buildRun(
  ctx: SeedContext,
  spec: AutomationSpec,
  automationId: string,
  automationVersion: number,
  agoMs: number,
  failed: boolean,
): AutomationRun {
  const triggeredAt = ctx.at(-agoMs);
  const finishedAt = ctx.at(-agoMs + 4_000);
  return {
    id: ctx.id("run"),
    version: 1,
    createdAt: triggeredAt,
    updatedAt: finishedAt,
    source: ctx.src("automations"),
    automationId,
    automationVersion,
    status: failed ? "failed" : "succeeded",
    dryRun: false,
    triggeredAt,
    finishedAt,
    triggerReason: spec.trigger.type === "schedule" ? `Zeitplan erreicht (${spec.trigger.description})` : `Ereignis ${spec.trigger.event ?? "unbekannt"} empfangen`,
    conditionsEvaluated: spec.conditions.map((condition) => ({ conditionId: condition.id, met: true, detail: `${condition.description}: erfüllt` })),
    actionsExecuted: spec.actions.map((action, index) => ({
      actionId: action.id,
      status: failed && index === spec.actions.length - 1 ? "failed" : "succeeded",
      executedAt: ctx.at(-agoMs + 1_500 * (index + 1)),
      resultSummary: failed && index === spec.actions.length - 1 ? (spec.lastErrorMessage ?? "Fehlgeschlagen") : `${action.description}: ausgeführt`,
    })),
    result: failed ? "Ausführung teilweise fehlgeschlagen." : "Alle Aktionen erfolgreich ausgeführt.",
    ...(failed
      ? {
          error: {
            code: "ADAPTER_UNAVAILABLE" as const,
            message: spec.lastErrorMessage ?? "Adapter nicht erreichbar.",
            severity: "error" as const,
            retryable: true,
            correlationId: ctx.id("corr"),
            details: {},
          },
        }
      : {}),
    correlationId: ctx.id("corr"),
  };
}

export function buildBulkAutomations(ctx: SeedContext, count: number): AutomationSeed {
  const automations: Automation[] = [];
  const runs: AutomationRun[] = [];
  for (let i = 0; i < count; i++) {
    const id = ctx.id("auto");
    const schedule = i % 2 === 0;
    automations.push({
      id,
      version: 1,
      createdAt: ctx.at(-30 * DAY),
      updatedAt: ctx.at(-DAY),
      source: ctx.src("automations"),
      name: `Automation ${i + 1}: ${schedule ? "Regelmäßige Prüfung" : "Ereignisbasierte Benachrichtigung"}`,
      enabled: ctx.rng.chance(0.8),
      paused: false,
      trigger: schedule
        ? { type: "schedule", schedule: `${ctx.rng.int(0, 59)} ${ctx.rng.int(6, 20)} * * *`, timeZone: "Europe/Berlin", description: "Täglich" }
        : { type: "event", event: "jarvis.notification.created", description: "Neue Benachrichtigung" },
      conditions: [],
      actions: [{ id: "act_1", type: "notify", channel: "dashboard", requiresApproval: false, description: "Dashboard-Hinweis" }],
      escalation: [],
      nextRunAt: null,
      lastRunAt: null,
      lastSuccess: null,
      lastError: null,
      runCount: 0,
    });
  }
  return { automations, runs };
}

/** Definition part of an automation, as stored in the version history. */
export function automationSnapshot(automation: Automation): AutomationVersion["snapshot"] {
  return {
    name: automation.name,
    ...(automation.description !== undefined ? { description: automation.description } : {}),
    enabled: automation.enabled,
    paused: automation.paused,
    trigger: structuredClone(automation.trigger),
    conditions: structuredClone(automation.conditions),
    actions: structuredClone(automation.actions),
    escalation: structuredClone(automation.escalation),
  };
}

/**
 * Seed history: every automation starts with the version it was created in (all seeded automations are at version 1).
 * The mock world appends one entry per later definition change.
 */
export function buildAutomationVersions(ctx: SeedContext, automations: readonly Automation[]): Record<string, AutomationVersion[]> {
  const history: Record<string, AutomationVersion[]> = {};
  for (const automation of automations) {
    history[automation.id] = Array.from({ length: automation.version }, (_, index) => {
      const version = index + 1;
      return {
        automationId: automation.id,
        version,
        createdAt: version === 1 ? automation.createdAt : automation.updatedAt,
        changedBy: ctx.owner,
        summary: version === 1 ? "Automation angelegt." : "Definition angepasst.",
        current: version === automation.version,
        snapshot: automationSnapshot(automation),
        source: automation.source,
      };
    });
  }
  return history;
}
