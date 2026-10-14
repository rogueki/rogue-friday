import type { AutomationAction, AutomationCondition, AutomationCreateRequest, AutomationTrigger, EscalationStep } from "@jarvis/sdk";
import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import type { MessageKey } from "@/i18n";

/** Wizard steps in the order of PLAN §35.1: Trigger → Conditions → Actions → Escalation, then review. */
export const WIZARD_STEPS = ["trigger", "conditions", "actions", "escalation", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export type TriggerType = AutomationTrigger["type"];
export type Operator = AutomationCondition["operator"];
export type ActionType = AutomationAction["type"];
export type ChannelId = EscalationStep["channel"];

export const TRIGGER_TYPES: readonly TriggerType[] = ["event", "schedule", "manual", "condition"];
export const OPERATORS: readonly Operator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "matches"];
export const ACTION_TYPES: readonly ActionType[] = ["notify", "create_task", "draft_message", "call", "run_agent", "set_priority", "webhook"];
export const CHANNELS: readonly ChannelId[] = ["dashboard", "telegram", "whatsapp", "sms", "phone", "email"];

/** Actions that deliver something to a person need a channel. */
export const CHANNEL_ACTIONS: ReadonlySet<ActionType> = new Set(["notify", "draft_message", "call"]);
/** Actions with external effect default to "requires approval" (PLAN §32: nothing risky runs on a pretty button). */
export const APPROVAL_BY_DEFAULT: ReadonlySet<ActionType> = new Set(["call", "webhook", "draft_message"]);

export const MAX_CONDITIONS = 12;
export const MAX_ACTIONS = 12;
export const MAX_ESCALATION = 6;
export const MAX_ESCALATION_MINUTES = 7 * 24 * 60;

export interface DraftCondition {
  key: string;
  field: string;
  operator: Operator;
  /** Raw text; parsed by `parseConditionValue`. */
  value: string;
}

export interface DraftAction {
  key: string;
  type: ActionType;
  channel: ChannelId | "";
  requiresApproval: boolean;
  /** Raw JSON object text (optional). */
  params: string;
}

export interface DraftEscalation {
  key: string;
  afterMinutes: string;
  channel: ChannelId;
  stopOnAcknowledge: boolean;
}

export interface WizardDraft {
  name: string;
  description: string;
  enabled: boolean;
  triggerType: TriggerType;
  event: string;
  schedule: string;
  timeZone: string;
  triggerNote: string;
  conditions: DraftCondition[];
  actions: DraftAction[];
  escalation: DraftEscalation[];
}

/** Errors by dotted path (`name`, `trigger.schedule`, `conditions.0.field` …); values are i18n keys. */
export type WizardErrors = Record<string, MessageKey>;

let counter = 0;
export const nextKey = (prefix: string): string => `${prefix}_${(counter += 1)}`;

export function emptyDraft(): WizardDraft {
  return {
    name: "",
    description: "",
    enabled: true,
    triggerType: "event",
    event: "",
    schedule: "0 9 * * 1-5",
    timeZone: "Europe/Berlin",
    triggerNote: "",
    conditions: [],
    actions: [],
    escalation: [],
  };
}

export function newAction(type: ActionType = "notify"): DraftAction {
  return { key: nextKey("a"), type, channel: CHANNEL_ACTIONS.has(type) ? (type === "call" ? "phone" : "dashboard") : "", requiresApproval: APPROVAL_BY_DEFAULT.has(type), params: "" };
}

export const newCondition = (): DraftCondition => ({ key: nextKey("c"), field: "", operator: "eq", value: "" });

export function newEscalation(previousMinutes = 0): DraftEscalation {
  return { key: nextKey("e"), afterMinutes: String(previousMinutes > 0 ? previousMinutes * 2 : 10), channel: "telegram", stopOnAcknowledge: true };
}

const stringify = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

export function draftFromAutomation(automation: Automation): WizardDraft {
  return {
    name: automation.name,
    description: automation.description ?? "",
    enabled: automation.enabled,
    triggerType: automation.trigger.type,
    event: automation.trigger.event ?? "",
    schedule: automation.trigger.schedule ?? "0 9 * * 1-5",
    timeZone: automation.trigger.timeZone ?? "Europe/Berlin",
    triggerNote: automation.trigger.description,
    conditions: automation.conditions.map((condition) => ({ key: nextKey("c"), field: condition.field, operator: condition.operator, value: stringify(condition.value) })),
    actions: automation.actions.map((action) => ({
      key: nextKey("a"),
      type: action.type,
      channel: action.channel ?? "",
      requiresApproval: action.requiresApproval,
      params: action.params && Object.keys(action.params).length > 0 ? JSON.stringify(action.params) : "",
    })),
    escalation: automation.escalation.map((step) => ({ key: nextKey("e"), afterMinutes: String(Math.max(1, Math.round(step.afterSeconds / 60))), channel: step.channel, stopOnAcknowledge: step.stopOnAcknowledge ?? true })),
  };
}

/** Cron expression with five fields; each field is `*`, a number, a range or a list, optionally with a `/step` (no names, no `?`). */
export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const part = /^(\*|\d+(-\d+)?)(\/\d+)?$/;
  return fields.every((field) => field.split(",").every((piece) => part.test(piece)));
}

/** Text -> JSON (number, boolean, array, object) with the plain string as fallback. */
export function parseConditionValue(raw: string, operator: Operator): unknown {
  const text = raw.trim();
  if (operator === "in" && !text.startsWith("[")) return text.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

function parseObject(raw: string): Record<string, unknown> | null {
  if (raw.trim() === "") return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function validateStep(step: WizardStep, draft: WizardDraft): WizardErrors {
  const errors: WizardErrors = {};
  if (step === "trigger") {
    if (draft.name.trim().length < 3) errors["name"] = "automations.error.name";
    if (draft.triggerType === "event" && draft.event.trim() === "") errors["trigger.event"] = "automations.error.event";
    if (draft.triggerType === "schedule") {
      if (!isValidCron(draft.schedule)) errors["trigger.schedule"] = "automations.error.cron";
      if (draft.timeZone.trim() === "") errors["trigger.timeZone"] = "automations.error.timeZone";
    }
    if (draft.triggerType === "condition" && draft.triggerNote.trim() === "") errors["trigger.note"] = "automations.error.conditionTrigger";
  }
  if (step === "conditions") {
    if (draft.conditions.length > MAX_CONDITIONS) errors["conditions"] = "automations.error.tooMany";
    draft.conditions.forEach((condition, index) => {
      if (condition.field.trim() === "") errors[`conditions.${index}.field`] = "automations.error.field";
      const value = condition.value.trim();
      if (value === "") errors[`conditions.${index}.value`] = "automations.error.value";
      else if (["gt", "gte", "lt", "lte"].includes(condition.operator) && !Number.isFinite(Number(value))) errors[`conditions.${index}.value`] = "automations.error.number";
      else if (condition.operator === "matches" && !isRegex(value)) errors[`conditions.${index}.value`] = "automations.error.regex";
    });
  }
  if (step === "actions") {
    if (draft.actions.length === 0) errors["actions"] = "automations.error.noAction";
    if (draft.actions.length > MAX_ACTIONS) errors["actions"] = "automations.error.tooMany";
    draft.actions.forEach((action, index) => {
      if (CHANNEL_ACTIONS.has(action.type) && action.channel === "") errors[`actions.${index}.channel`] = "automations.error.channel";
      const params = parseObject(action.params);
      if (params === null) errors[`actions.${index}.params`] = "automations.error.params";
      else if (action.type === "webhook" && typeof params["url"] !== "string") errors[`actions.${index}.params`] = "automations.error.webhookUrl";
    });
  }
  if (step === "escalation") {
    if (draft.escalation.length > MAX_ESCALATION) errors["escalation"] = "automations.error.tooMany";
    let previous = 0;
    draft.escalation.forEach((entry, index) => {
      const minutes = Number(entry.afterMinutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ESCALATION_MINUTES) errors[`escalation.${index}.after`] = "automations.error.minutes";
      else if (minutes <= previous) errors[`escalation.${index}.after`] = "automations.error.order";
      else previous = minutes;
    });
  }
  return errors;
}

/** First step that has errors, or null when the whole draft is valid. */
export function firstInvalidStep(draft: WizardDraft): WizardStep | null {
  for (const step of WIZARD_STEPS) {
    if (step !== "review" && Object.keys(validateStep(step, draft)).length > 0) return step;
  }
  return null;
}

/** Human-readable descriptions the contract requires on every trigger/condition/action/step (built with the UI's translator). */
export interface Describer {
  trigger: (draft: WizardDraft) => string;
  condition: (condition: DraftCondition) => string;
  action: (action: DraftAction) => string;
  escalation: (entry: DraftEscalation, minutes: number) => string;
}

export function toRequest(draft: WizardDraft, describe: Describer): AutomationCreateRequest {
  const triggerDescription = draft.triggerNote.trim() || describe.trigger(draft);
  const trigger: AutomationTrigger =
    draft.triggerType === "event"
      ? { type: "event", event: draft.event.trim(), description: triggerDescription }
      : draft.triggerType === "schedule"
        ? { type: "schedule", schedule: draft.schedule.trim().replace(/\s+/g, " "), timeZone: draft.timeZone.trim(), description: triggerDescription }
        : { type: draft.triggerType, description: triggerDescription };
  const conditions: AutomationCondition[] = draft.conditions.map((condition, index) => ({
    id: `cond_${index + 1}`,
    field: condition.field.trim(),
    operator: condition.operator,
    // The contract allows any JSON; the generated type is `{ [k: string]: unknown }` (known gap, see docs/PROJECT_STATUS.md).
    value: parseConditionValue(condition.value, condition.operator) as AutomationCondition["value"],
    description: describe.condition(condition),
  }));
  const actions: AutomationAction[] = draft.actions.map((action, index) => {
    const params = parseObject(action.params) ?? {};
    return {
      id: `act_${index + 1}`,
      type: action.type,
      ...(action.channel !== "" ? { channel: action.channel } : {}),
      ...(Object.keys(params).length > 0 ? { params } : {}),
      requiresApproval: action.requiresApproval,
      description: describe.action(action),
    };
  });
  const escalation: EscalationStep[] = draft.escalation.map((entry) => {
    const minutes = Number(entry.afterMinutes);
    return { afterSeconds: minutes * 60, channel: entry.channel, description: describe.escalation(entry, minutes), stopOnAcknowledge: entry.stopOnAcknowledge };
  });
  return {
    name: draft.name.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    enabled: draft.enabled,
    trigger,
    conditions,
    actions,
    escalation,
  };
}
