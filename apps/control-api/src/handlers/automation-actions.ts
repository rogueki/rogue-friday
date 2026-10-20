import { CONTRACT_VERSION, type Automation, type AutomationCreateRequest, type AutomationPauseAllRequest, type AutomationRun, type AutomationTestRequest, type AutomationUpdateRequest } from "@friday/sdk";
import type { MutationContext } from "@friday/adapter-core";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { Runtime } from "../runtime/types";
import type { NativeExecutableAction } from "../services/native-approval-requests";
import { ApiError, conflict, validationFailed } from "../util/errors";

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

export type AutomationResult =
  | { kind: "automation"; operation: "create" | "update" | "enable" | "disable"; automation: Automation }
  | { kind: "automation.test"; run: AutomationRun }
  | { kind: "automation.pauseAll"; result: { results: unknown[]; pausedCount: number; unchangedCount: number; failedCount: number } };

export interface AutomationDispatch {
  /** Stable receipt id: the automation id, the run id, or the number of paused automations. */
  receipt: string;
  result: AutomationResult;
}

/**
 * Runs one stored automation action against the port with the pipeline's idempotency key. Shared by the direct API
 * handlers, the command path and the approval decision: every caller stages and confirms the identical action first.
 */
export async function dispatchAutomationAction(runtime: Runtime, action: NativeExecutableAction,
  call: MutationContext): Promise<AutomationDispatch> {
  const automations = runtime.registry.getPort("automations");
  switch (action.kind) {
    case "automation.create": {
      if (!automations.createAutomation) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Automationen koennen derzeit nicht angelegt werden." });
      const created = await automations.createAutomation({ body: action.body }, call);
      return { receipt: created.data.id, result: { kind: "automation", operation: "create", automation: created.data } };
    }
    case "automation.update": {
      if (!automations.updateAutomation) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Automationen koennen derzeit nicht geaendert werden." });
      const updated = await automations.updateAutomation({ id: action.id, body: action.body },
        { ...call, ifMatchVersion: action.version });
      return { receipt: updated.data.id, result: { kind: "automation", operation: "update", automation: updated.data } };
    }
    case "automation.enable":
    case "automation.disable": {
      const method = action.kind === "automation.enable" ? automations.enableAutomation : automations.disableAutomation;
      if (!method) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: `Automationen koennen derzeit nicht ${action.kind === "automation.enable" ? "aktiviert" : "deaktiviert"} werden.` });
      const toggled = await method({ id: action.id }, { ...call, ifMatchVersion: action.version });
      return { receipt: toggled.data.id, result: { kind: "automation", operation: action.kind === "automation.enable" ? "enable" : "disable",
        automation: toggled.data } };
    }
    case "automation.test": {
      if (!automations.testAutomation) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Automationen koennen derzeit nicht getestet werden." });
      const run = await automations.testAutomation({ id: action.id, body: action.body }, call);
      return { receipt: run.data.id, result: { kind: "automation.test", run: run.data } };
    }
    case "automation.pauseAll": {
      if (!automations.pauseAllAutomations) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Automationen koennen derzeit nicht pausiert werden." });
      const outcome = await automations.pauseAllAutomations({ body: action.body }, call);
      return { receipt: String(outcome.data.pausedCount), result: { kind: "automation.pauseAll", result: outcome.data } };
    }
  }
  throw conflict("Aktion ist nicht ausfuehrbar.");
}

interface AutomationWrite {
  action: NativeExecutableAction;
  actionText: string;
  previewTitle: string;
  previewText: string;
}

/**
 * Stages the exact write as a draft, binds confirmation to the unchanged action and either hands it to the tier-2
 * approval flow or lets the caller execute it once. Throws for every non-executable stage.
 */
function enforceAutomationWrite(ctx: RequestContext, ownerId: string, subject: string,
  waitMessage: string, write: AutomationWrite): string {
  const confirmedPreviewId = ctx.headers["x-action-preview-id"];
  if (confirmedPreviewId !== undefined && !PREVIEW_ID.test(confirmedPreviewId)) {
    throw validationFailed("Die Vorschaukennung ist ungueltig.", [{ path: "X-Action-Preview-Id", message: "ungueltig" }]);
  }
  if (!confirmedPreviewId) {
    const previewId = ctx.correlationId;
    ctx.runtime.nativeApprovals.propose({ ownerId, requestKey: previewId, correlationId: ctx.correlationId,
      riskTier: 2, type: "system_change", action: write.actionText,
      rationale: `${subject} aus bestaetigter API-Anfrage`, preview: { kind: "text", title: write.previewTitle,
        body: JSON.stringify(write.action) }, impacts: [], execution: write.action });
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: `${subject} zuerst mit unveraenderter Vorschau bestaetigen.`,
      details: { stage: "preview", previewId, previewText: write.previewText } });
  }
  const policy = ctx.runtime.nativeApprovals.confirm(ownerId, confirmedPreviewId, write.action);
  if (policy.approval) {
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: waitMessage,
      details: { stage: "approval", approvalId: policy.approval.id,
        targetRoute: `/approvals?approval=${policy.approval.id}` } });
  }
  return confirmedPreviewId;
}

/** The write for a confirm-only repeat: the request body re-binds against the stored draft, so a tampered repeat mismatches. */
function confirmWrite(ctx: RequestContext, ownerId: string, previewId: string,
  expected: { kind: NativeExecutableAction["kind"]; id?: string }, body?: unknown): AutomationWrite {
  const stored = ctx.runtime.nativeApprovals.readAction(ownerId, previewId);
  if (!stored || stored.kind !== expected.kind ||
      (expected.id !== undefined && (!("id" in stored) || stored.id !== expected.id))) {
    throw conflict("Der Entwurf passt nicht zur Aktion.");
  }
  const action = body === undefined ? stored : { ...stored, body } as NativeExecutableAction;
  return { action, actionText: "", previewTitle: "", previewText: "" };
}

/** If-Match (when present) must match the live version before anything is staged; the draft then carries the version. */
function stagedVersion(ctx: RequestContext, current: { id: string; version: number }): number {
  const header = ctx.mutation.ifMatchVersion;
  if (header !== undefined && header !== current.version) {
    throw conflict(`Automation ${current.id} wurde zwischenzeitlich geändert (erwartet Version ${header}, aktuell ${current.version}).`,
      { expectedVersion: header, currentVersion: current.version, id: current.id });
  }
  return header ?? current.version;
}

/** Mirrors the port rules for triggers so an invalid definition fails before any preview is staged. */
function assertTrigger(trigger: Automation["trigger"]): void {
  if (trigger.type === "schedule" && (!trigger.schedule || !/^\S+( +\S+){4}$/.test(trigger.schedule.trim()))) {
    throw validationFailed("Der Zeitplan ist kein gültiger Cron-Ausdruck (5 Felder).", [{ path: "trigger.schedule", message: "ungültiger Cron-Ausdruck" }]);
  }
  if (trigger.type === "event" && !trigger.event) {
    throw validationFailed("Ereignis-Trigger benötigen ein Ereignis.", [{ path: "trigger.event", message: "erforderlich" }]);
  }
}

function stagedCall(ctx: RequestContext, idempotencyKey: string): MutationContext {
  return { ...ctx.mutation, idempotencyKey };
}

/** Direct API automation writes share the same saved draft, approval decision and port receipt as command writes. */
export const automationActionHandlers: Partial<Record<OperationId, Handler>> = {
  async createAutomation(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("automations");
    if (!port.createAutomation || !ctx.runtime.capabilities().modules.automations.create) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Automationen koennen derzeit nicht angelegt werden." });
    }
    const body = ctx.body as AutomationCreateRequest;
    const write = ctx.headers["x-action-preview-id"]
      ? confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: "automation.create" }, body)
      : ((): AutomationWrite => {
          assertTrigger(body.trigger);
          return { action: { kind: "automation.create", body }, actionText: `Automation anlegen: ${body.name}`,
            previewTitle: "Neue Automation", previewText: `Automation „${body.name}“ anlegen?` };
        })();
    const previewId = enforceAutomationWrite(ctx, ownerId, "Automation", "Automation wartet auf Freigabe.", write);
    const automationId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) =>
        (await dispatchAutomationAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey))).receipt);
    const automation = await port.getAutomation({ id: automationId }, ctx.call);
    ctx.audit.action = "automation.created";
    ctx.audit.after = { id: automationId };
    return { status: 201, body: single(automation.data), headers: { Location: `/api/v1/automations/${automationId}` } };
  },

  async updateAutomation(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("automations");
    if (!port.updateAutomation || !ctx.runtime.capabilities().modules.automations.update) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Automationen koennen derzeit nicht geaendert werden." });
    }
    const id = ctx.pathParams.id as string;
    const body = ctx.body as AutomationUpdateRequest;
    let write: AutomationWrite;
    if (ctx.headers["x-action-preview-id"]) {
      write = confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: "automation.update", id }, body);
    } else {
      // An unknown, stale or invalidly defined target fails before any preview is staged.
      const current = (await port.getAutomation({ id }, ctx.call)).data;
      const version = stagedVersion(ctx, current);
      if (body.trigger) assertTrigger(body.trigger);
      write = { action: { kind: "automation.update", id, version, body },
        actionText: `Automation aktualisieren: ${current.name}`,
        previewTitle: "Automation aktualisieren", previewText: `Automation „${current.name}“ aktualisieren?` };
    }
    const previewId = enforceAutomationWrite(ctx, ownerId, "Automation", "Automation wartet auf Freigabe.", write);
    const automationId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) =>
        (await dispatchAutomationAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey))).receipt);
    const automation = await port.getAutomation({ id: automationId }, ctx.call);
    ctx.audit.action = "automation.updated";
    ctx.audit.after = { id: automationId, version: automation.data.version };
    return { status: 200, body: single(automation.data) };
  },

  async enableAutomation(ctx) {
    return toggleAutomation(ctx, true);
  },

  async disableAutomation(ctx) {
    return toggleAutomation(ctx, false);
  },

  async testAutomation(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("automations");
    if (!port.testAutomation || !ctx.runtime.capabilities().modules.automations.test) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Automationen koennen derzeit nicht getestet werden." });
    }
    const id = ctx.pathParams.id as string;
    const body = (ctx.body ?? {}) as AutomationTestRequest;
    let write: AutomationWrite;
    if (ctx.headers["x-action-preview-id"]) {
      write = confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: "automation.test", id }, body);
    } else {
      // An unknown automation fails before any preview is staged.
      const current = (await port.getAutomation({ id }, ctx.call)).data;
      const dryRun = body.dryRun ?? true;
      write = { action: { kind: "automation.test", id, body },
        actionText: `Automation ${dryRun ? "trocken testen" : "testen"}: ${current.name}`,
        previewTitle: dryRun ? "Automation trocken testen" : "Automation testen",
        previewText: dryRun
          ? `Trockenlauf der Automation „${current.name}“? Bedingungen werden geprüft, nichts wird ausgeführt.`
          : `Automation „${current.name}“ wirklich testen? Der Lauf führt die Aktionen aus und löst Aufgaben, Benachrichtigungen und Freigaben aus.` };
    }
    const previewId = enforceAutomationWrite(ctx, ownerId, "Automation", "Automation-Test wartet auf Freigabe.", write);
    const fresh: { result: AutomationDispatch["result"] | null } = { result: null };
    await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) => {
        const dispatched = await dispatchAutomationAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey));
        fresh.result = dispatched.result;
        return dispatched.receipt;
      });
    const stored = ctx.runtime.nativeApprovals.readAction(ownerId, previewId);
    if (stored?.kind !== "automation.test") throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
    const run = fresh.result?.kind === "automation.test" ? fresh.result.run
      : (await port.listAutomationRuns({ id, limit: 50 }, ctx.call)).items[0]!;
    ctx.audit.action = (body.dryRun ?? true) ? "automation.dry_run" : "automation.test_run";
    ctx.audit.after = { runId: run.id };
    return { status: 200, body: single(run) };
  },

  async pauseAllAutomations(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("automations");
    if (!port.pauseAllAutomations || !ctx.runtime.capabilities().modules.automations.pauseAll) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Automationen koennen derzeit nicht pausiert werden." });
    }
    const body = (ctx.body ?? {}) as AutomationPauseAllRequest;
    let write: AutomationWrite;
    if (ctx.headers["x-action-preview-id"]) {
      write = confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: "automation.pauseAll" }, body);
    } else {
      const automations = (await port.listAutomations({ limit: 200 }, ctx.call)).items;
      const affected = automations.filter((automation) => automation.enabled && !automation.paused);
      write = { action: { kind: "automation.pauseAll", body },
        actionText: "Alle Automationen pausieren",
        previewTitle: "Alle Automationen pausieren",
        previewText: affected.length > 0
          ? `Alle ${affected.length} aktiven Automationen pausieren?${body.reason ? ` Grund: ${body.reason}` : ""}`
          : "Alle Automationen pausieren? Es sind keine aktiven Automationen betroffen." };
      ctx.audit.context = body.reason ? { reason: body.reason } : {};
    }
    ctx.audit.severity = "warning";
    const previewId = enforceAutomationWrite(ctx, ownerId, "Alle Automationen",
      "Alle Automationen warten auf Freigabe.", write);
    const fresh: { result: AutomationDispatch["result"] | null } = { result: null };
    await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) => {
        const dispatched = await dispatchAutomationAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey));
        fresh.result = dispatched.result;
        return dispatched.receipt;
      });
    ctx.audit.action = "automation.paused_all";
    if (fresh.result?.kind === "automation.pauseAll") {
      ctx.audit.after = { paused: fresh.result.result.pausedCount, unchanged: fresh.result.result.unchangedCount,
        failed: fresh.result.result.failedCount };
      return { status: 200, body: single(fresh.result.result) };
    }
    // Replay of a completed confirmation: the outcome is derived state, so answer the current per-automation result.
    const stored = ctx.runtime.nativeApprovals.readAction(ownerId, previewId);
    if (stored?.kind !== "automation.pauseAll") throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
    const items = (await port.listAutomations({ limit: 200 }, ctx.call)).items;
    const results = items.map((automation) => ({
      automationId: automation.id, name: automation.name, version: automation.version,
      ...(!automation.enabled ? { outcome: "skipped" as const, message: "Automation ist deaktiviert." }
        : automation.paused ? { outcome: "already_paused" as const } : { outcome: "paused" as const }),
    }));
    ctx.audit.after = { paused: 0, unchanged: results.length, failed: 0, replayed: true };
    return { status: 200, body: single({ results, pausedCount: 0, unchangedCount: results.length, failedCount: 0 }) };
  },
};

async function toggleAutomation(ctx: RequestContext, enable: boolean): Promise<{ status: number; body: unknown }> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const capability = enable ? "enable" : "disable";
  const port = ctx.runtime.registry.getPort("automations");
  const method = enable ? port.enableAutomation : port.disableAutomation;
  if (!method || !ctx.runtime.capabilities().modules.automations[capability]) {
    throw new ApiError({ code: "CAPABILITY_MISSING",
      message: `Automationen koennen derzeit nicht ${enable ? "aktiviert" : "deaktiviert"} werden.` });
  }
  const id = ctx.pathParams.id as string;
  const verb = enable ? "aktivieren" : "deaktivieren";
  let write: AutomationWrite;
  if (ctx.headers["x-action-preview-id"]) {
    write = confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: enable ? "automation.enable" : "automation.disable", id });
  } else {
    // An unknown or stale automation fails before any preview is staged.
    const current = (await port.getAutomation({ id }, ctx.call)).data;
    const version = stagedVersion(ctx, current);
    const redundant = enable === current.enabled;
    write = { action: { kind: enable ? "automation.enable" : "automation.disable", id, version },
      actionText: `Automation ${verb}: ${current.name}`,
      previewTitle: `Automation ${verb}`,
      previewText: redundant
        ? `Automation „${current.name}“ ist bereits ${enable ? "aktiviert" : "deaktiviert"} — trotzdem erneut ${verb}?`
        : `Automation „${current.name}“ ${verb}?` };
  }
  const previewId = enforceAutomationWrite(ctx, ownerId, "Automation", "Automation wartet auf Freigabe.", write);
  const automationId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
    async (savedAction, idempotencyKey) =>
      (await dispatchAutomationAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey))).receipt);
  const automation = await port.getAutomation({ id: automationId }, ctx.call);
  ctx.audit.action = enable ? "automation.enabled" : "automation.disabled";
  ctx.audit.after = { id: automationId, enabled: automation.data.enabled };
  return { status: 200, body: single(automation.data) };
}
