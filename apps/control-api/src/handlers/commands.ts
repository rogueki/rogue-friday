import { PORT_SPEC } from "@friday/adapter-core";
import { CONTRACT_VERSION, type ActionResult, type CommandControlRequest, type CommandRequest, type CommandResponse } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { CommandHistoryStore } from "../db/stores";
import type { IntegrationEvent } from "../services/durable-memory";
import { controlLiveVoice, executeBuiltinIntent, matchBuiltinIntent } from "../services/command-intents";
import { parseTaskCreateIntent } from "../services/task-create-intent";
import { createId } from "@friday/observability";
import { validationFailed, ApiError } from "../util/errors";
import { portHandler } from "./ports";

const executeBase = portHandler("commands", "executeCommand", PORT_SPEC.commands.executeCommand);

async function executeTaskCreate(ctx: Parameters<Handler>[0], request: CommandRequest,
  body: NonNullable<ReturnType<typeof parseTaskCreateIntent>>): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const create = ctx.runtime.registry.getPort("tasks").createTask;
  if (!create) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht angelegt werden." });
  const action = { kind: "task.create" as const, body };
  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"),
      correlationId: ctx.correlationId, riskTier: 2, status: "rejected", requiresConfirmation: false,
      previewText: null, approvalId: null, result: { message: "Entwurf verworfen." } } satisfies CommandResponse };
  }
  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
    : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 2,
        type: "system_change", action: `Aufgabe anlegen: ${body.title}`, rationale: "Lokale Aufgabe aus bestaetigtem Befehl",
        preview: { kind: "text", title: "Neue Aufgabe", body: body.title }, impacts: [], execution: action });
  const base = { contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId,
    riskTier: 2 as const };
  let response: CommandResponse;
  if (!request.confirm) {
    response = { ...base, status: "requires_confirmation", requiresConfirmation: true,
      previewText: `Aufgabe „${body.title}“ mit Prioritaet ${body.priority} anlegen?`, previewId: requestKey,
      approvalId: null, result: null };
  } else if (policy.approval) {
    response = { ...base, status: "requires_approval", requiresConfirmation: false, previewText: null,
      approvalId: policy.approval.id, result: { message: "Aufgabe wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } };
  } else {
    const taskId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey,
      async (actionToRun, idempotencyKey) => (await create({ body: actionToRun.body }, { ...ctx.mutation, idempotencyKey })).data.id);
    response = { ...base, status: "executed", requiresConfirmation: false, previewText: null,
      approvalId: null, result: { message: "Aufgabe wurde angelegt.", taskId, targetRoute: `/tasks?task=${taskId}` } };
  }
  return { status: 200, body: response };
}

function captureCommand(ctx: Parameters<Handler>[0], eventId: string, eventType: "user_utterance" | "assistant_response",
  text: string, outcome: IntegrationEvent["outcome"], privateInput: boolean): void {
  if (!ctx.principal) return;
  ctx.runtime.durableMemory.capture({
    eventId, contractVersion: CONTRACT_VERSION, eventType,
    actor: eventType === "user_utterance" ? { type: "user", id: ctx.principal.userId, role: null }
      : { type: "assistant", id: "friday", role: null },
    identityId: ctx.principal.userId, channel: requestChannel(ctx), sessionId: null,
    dialogId: ctx.correlationId, correlationId: ctx.correlationId,
    source: "dashboard/command", occurredAt: new Date().toISOString(), outcome,
    captureEligibility: privateInput ? "private" : "eligible", redaction: "required", payload: { kind: "text", text },
  });
}

function requestChannel(ctx: Parameters<Handler>[0]): string {
  const source = (ctx.body as CommandRequest).source;
  return source === "voice" ? "dashboard_voice" : "dashboard";
}

async function controlCommand(ctx: Parameters<Handler>[0], action: "stop" | "pause" | "resume"): Promise<Awaited<ReturnType<Handler>>> {
  const request = ctx.body as CommandControlRequest;
  let voiceError: string | null = null;
  let controlledVoice = false;
  if (ctx.runtime.config.adapters.voice.provider === "friday-voice-http" && (request.scope === "all" || request.scope === "voice")) {
    voiceError = await controlLiveVoice(ctx, action);
    controlledVoice = voiceError === null;
    // Keep the command adapter's task controls for scope=all; voice-only is already handled by the live service.
    if (request.scope === "voice") {
      const body: ActionResult = { contractVersion: CONTRACT_VERSION, accepted: controlledVoice, status: controlledVoice ? "completed" : "rejected", correlationId: ctx.correlationId, message: voiceError ?? `Voice: ${action}` };
      return { status: 200, body };
    }
  }
  const method = action === "stop" ? "stopCommand" : action === "pause" ? "pauseCommand" : "resumeCommand";
  const result = await portHandler("commands", method, PORT_SPEC.commands[method])(ctx);
  if (!controlledVoice && voiceError === null) return result;
  const taskResult = result.body as ActionResult;
  const accepted = controlledVoice && taskResult.accepted;
  const body: ActionResult = {
    ...taskResult,
    accepted,
    status: accepted ? taskResult.status : "rejected",
    message: [controlledVoice ? "Voice gesteuert" : voiceError, taskResult.message].filter(Boolean).join("; "),
  };
  return { ...result, body };
}

/**
 * Commands are audited with their risk tier and outcome; the control-plane history stores sensitive texts redacted
 * (PLAN §43.5) and the audit trail never contains the command text of a sensitive command.
 */
export const commandHandlers: Partial<Record<OperationId, Handler>> = {
  async executeCommand(ctx) {
    const request = ctx.body as CommandRequest;
    const sensitive = CommandHistoryStore.isSensitive(request.text);
    const privateInput = sensitive || /(?:dieses gespräch nicht speichern|nicht merken|do not store|private mode)/i.test(request.text);
    captureCommand(ctx, `${ctx.correlationId}-u`, "user_utterance", request.text, "completed", privateInput);
    ctx.audit.action = "command.executed";
    let status = "failed";
    try {
      const taskCreate = parseTaskCreateIntent(request.text);
      const intent = request.confirm ? null : matchBuiltinIntent(request.text);
      const result = taskCreate ? await executeTaskCreate(ctx, request, taskCreate)
        : intent ? await executeBuiltinIntent(ctx, intent, () => executeBase(ctx)) : await executeBase(ctx);
      const response = result.body as CommandResponse;
      status = response.status;
      ctx.audit.context = {
        commandId: response.commandId,
        status: response.status,
        riskTier: response.riskTier,
        approvalId: response.approvalId,
        source: request.source,
        ...(intent ? { intent } : taskCreate ? { intent: "task_create" } : {}),
        redacted: sensitive,
        ...(sensitive ? {} : { text: request.text.slice(0, 200) }),
      };
      if (response.approvalId) ctx.audit.approvalId = response.approvalId;
      const answer = response.result?.message ?? response.previewText;
      if (answer) captureCommand(ctx, `${ctx.correlationId}-a`, "assistant_response", answer,
        response.status === "executed" ? "completed" : "uncertain", privateInput);
      return result;
    } finally {
      ctx.runtime.stores.commands.record({
        id: ctx.correlationId.replace(/^corr_/, "cmdh_"),
        correlationId: ctx.correlationId,
        actor: ctx.actor.id,
        text: request.text,
        origin: request.source,
        status,
        createdAt: new Date().toISOString(),
      });
    }
  },

  async stopCommand(ctx) {
    ctx.audit.action = "command.stopped";
    return controlCommand(ctx, "stop");
  },

  async pauseCommand(ctx) {
    ctx.audit.action = "command.paused";
    return controlCommand(ctx, "pause");
  },

  async resumeCommand(ctx) {
    ctx.audit.action = "command.resumed";
    return controlCommand(ctx, "resume");
  },
};
