import { PORT_SPEC } from "@friday/adapter-core";
import { CONTRACT_VERSION, type ActionResult, type CommandControlRequest, type CommandRequest, type CommandResponse } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { CommandHistoryStore } from "../db/stores";
import { controlLiveVoice, executeBuiltinIntent, matchBuiltinIntent } from "../services/command-intents";
import { portHandler } from "./ports";

const executeBase = portHandler("commands", "executeCommand", PORT_SPEC.commands.executeCommand);

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
    ctx.audit.action = "command.executed";
    let status = "failed";
    try {
      const intent = request.confirm ? null : matchBuiltinIntent(request.text);
      const result = intent ? await executeBuiltinIntent(ctx, intent, () => executeBase(ctx)) : await executeBase(ctx);
      const response = result.body as CommandResponse;
      status = response.status;
      ctx.audit.context = {
        commandId: response.commandId,
        status: response.status,
        riskTier: response.riskTier,
        approvalId: response.approvalId,
        source: request.source,
        ...(intent ? { intent } : {}),
        redacted: sensitive,
        ...(sensitive ? {} : { text: request.text.slice(0, 200) }),
      };
      if (response.approvalId) ctx.audit.approvalId = response.approvalId;
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
