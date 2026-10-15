import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import { describe, expect, it } from "vitest";
import { draftFromAutomation, emptyDraft, firstInvalidStep, isValidCron, newAction, newCondition, newEscalation, parseConditionValue, toRequest, validateStep, type Describer } from "./wizardModel";

const describer: Describer = {
  trigger: () => "Trigger",
  condition: (condition) => `${condition.field} ${condition.operator}`,
  action: (action) => action.type,
  escalation: (_entry, minutes) => `nach ${minutes} Min.`,
};

describe("cron validation", () => {
  it("accepts five-field expressions and rejects the rest", () => {
    expect(isValidCron("0 7 * * 1-5")).toBe(true);
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 9,17 * * *")).toBe(true);
    expect(isValidCron("0 7 * *")).toBe(false);
    expect(isValidCron("every day")).toBe(false);
    expect(isValidCron("0 7 * * MON")).toBe(false);
  });
});

describe("wizard validation", () => {
  it("requires a name and the trigger's own field", () => {
    const draft = emptyDraft();
    expect(validateStep("trigger", draft)).toMatchObject({ name: "automations.error.name", "trigger.event": "automations.error.event" });
    expect(validateStep("trigger", { ...draft, name: "Test", event: "friday.task.updated" })).toEqual({});
    expect(validateStep("trigger", { ...draft, name: "Test", triggerType: "schedule", schedule: "nope" })).toMatchObject({ "trigger.schedule": "automations.error.cron" });
    expect(validateStep("trigger", { ...draft, name: "Test", triggerType: "manual" })).toEqual({});
  });

  it("validates conditions by operator", () => {
    const base = { ...emptyDraft(), conditions: [{ ...newCondition(), field: "thread.priority", operator: "gt" as const, value: "abc" }] };
    expect(validateStep("conditions", base)).toEqual({ "conditions.0.value": "automations.error.number" });
    expect(validateStep("conditions", { ...base, conditions: [{ ...newCondition(), field: "x", operator: "matches", value: "([" }] })).toEqual({ "conditions.0.value": "automations.error.regex" });
    expect(validateStep("conditions", { ...base, conditions: [{ ...newCondition(), field: "", value: "1" }] })).toEqual({ "conditions.0.field": "automations.error.field" });
    expect(validateStep("conditions", { ...base, conditions: [] })).toEqual({});
  });

  it("needs at least one action, channels for deliveries and a url for webhooks", () => {
    expect(validateStep("actions", emptyDraft())).toEqual({ actions: "automations.error.noAction" });
    const call = newAction("call");
    expect(call.requiresApproval).toBe(true);
    expect(call.channel).toBe("phone");
    expect(validateStep("actions", { ...emptyDraft(), actions: [{ ...newAction("notify"), channel: "" }] })).toEqual({ "actions.0.channel": "automations.error.channel" });
    expect(validateStep("actions", { ...emptyDraft(), actions: [{ ...newAction("webhook"), params: '{"method":"POST"}' }] })).toEqual({ "actions.0.params": "automations.error.webhookUrl" });
    expect(validateStep("actions", { ...emptyDraft(), actions: [{ ...newAction("webhook"), params: "[1]" }] })).toEqual({ "actions.0.params": "automations.error.params" });
    expect(validateStep("actions", { ...emptyDraft(), actions: [{ ...newAction("run_agent"), params: '{"agent":"x"}' }] })).toEqual({});
  });

  it("escalation steps must be positive and strictly increasing", () => {
    const first = { ...newEscalation(), afterMinutes: "10" };
    const second = { ...newEscalation(10), afterMinutes: "10" };
    expect(validateStep("escalation", { ...emptyDraft(), escalation: [first, second] })).toEqual({ "escalation.1.after": "automations.error.order" });
    expect(validateStep("escalation", { ...emptyDraft(), escalation: [{ ...first, afterMinutes: "0" }] })).toEqual({ "escalation.0.after": "automations.error.minutes" });
    expect(validateStep("escalation", { ...emptyDraft(), escalation: [first, { ...second, afterMinutes: "30" }] })).toEqual({});
  });

  it("finds the first invalid step", () => {
    expect(firstInvalidStep(emptyDraft())).toBe("trigger");
    expect(firstInvalidStep({ ...emptyDraft(), name: "Test", event: "friday.task.updated" })).toBe("actions");
    expect(firstInvalidStep({ ...emptyDraft(), name: "Test", event: "friday.task.updated", actions: [newAction("notify")] })).toBeNull();
  });
});

describe("request building", () => {
  it("parses condition values", () => {
    expect(parseConditionValue("P1", "eq")).toBe("P1");
    expect(parseConditionValue("3", "gt")).toBe(3);
    expect(parseConditionValue("a, b", "in")).toEqual(["a", "b"]);
    expect(parseConditionValue('["a"]', "in")).toEqual(["a"]);
    expect(parseConditionValue("true", "eq")).toBe(true);
  });

  it("builds a contract request with ids, seconds and descriptions", () => {
    const draft = {
      ...emptyDraft(),
      name: " Mail eskalieren ",
      event: "friday.communication.thread_updated",
      conditions: [{ ...newCondition(), field: "thread.priority", value: "P1" }],
      actions: [{ ...newAction("notify"), channel: "telegram" as const }],
      escalation: [{ ...newEscalation(), afterMinutes: "10", channel: "phone" as const }],
    };
    const request = toRequest(draft, describer);
    expect(request).toMatchObject({
      name: "Mail eskalieren",
      enabled: true,
      trigger: { type: "event", event: "friday.communication.thread_updated", description: "Trigger" },
      conditions: [{ id: "cond_1", field: "thread.priority", operator: "eq", value: "P1", description: "thread.priority eq" }],
      actions: [{ id: "act_1", type: "notify", channel: "telegram", requiresApproval: false }],
      escalation: [{ afterSeconds: 600, channel: "phone", stopOnAcknowledge: true, description: "nach 10 Min." }],
    });
  });

  it("round-trips an existing automation into a draft", () => {
    const automation = {
      name: "Backup",
      description: "d",
      enabled: false,
      trigger: { type: "schedule", schedule: "0 22 * * *", timeZone: "Europe/Berlin", description: "Täglich" },
      conditions: [{ id: "cond_1", field: "a", operator: "in", value: ["x", "y"], description: "" }],
      actions: [{ id: "act_1", type: "run_agent", params: { agent: "A" }, requiresApproval: false, description: "" }],
      escalation: [{ afterSeconds: 1800, channel: "telegram", description: "", stopOnAcknowledge: true }],
    } as unknown as Automation;
    const draft = draftFromAutomation(automation);
    expect(draft).toMatchObject({ name: "Backup", enabled: false, triggerType: "schedule", schedule: "0 22 * * *", triggerNote: "Täglich" });
    expect(draft.escalation[0]?.afterMinutes).toBe("30");
    expect(draft.actions[0]?.params).toBe('{"agent":"A"}');
    expect(firstInvalidStep(draft)).toBeNull();
  });
});
