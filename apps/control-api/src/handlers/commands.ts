import { PORT_SPEC } from "@jarvis/adapter-core";
import type { CommandRequest, CommandResponse } from "@jarvis/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { CommandHistoryStore } from "../db/stores";
import { executeBuiltinIntent, matchBuiltinIntent } from "../services/command-intents";
import { portHandler } from "./ports";

const executeBase = portHandler("commands", "executeCommand", PORT_SPEC.commands.executeCommand);

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
      const result = intent ? { status: 200, body: await executeBuiltinIntent(ctx, intent) } : await executeBase(ctx);
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
    return portHandler("commands", "stopCommand", PORT_SPEC.commands.stopCommand)(ctx);
  },

  async pauseCommand(ctx) {
    ctx.audit.action = "command.paused";
    return portHandler("commands", "pauseCommand", PORT_SPEC.commands.pauseCommand)(ctx);
  },

  async resumeCommand(ctx) {
    ctx.audit.action = "command.resumed";
    return portHandler("commands", "resumeCommand", PORT_SPEC.commands.resumeCommand)(ctx);
  },
};
