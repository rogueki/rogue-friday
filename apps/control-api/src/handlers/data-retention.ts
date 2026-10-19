import { CONTRACT_VERSION, type DataRetentionActionRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";

const envelope = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data,
  freshness: { state: "fresh", asOf: new Date().toISOString() } });

export const dataRetentionHandlers: Partial<Record<OperationId, Handler>> = {
  async getDataRetentionStatus(ctx) {
    return { status: 200, body: envelope(ctx.runtime.retention.status()) };
  },
  async performDataRetentionAction(ctx) {
    const { action } = ctx.body as DataRetentionActionRequest;
    if (action === "preview") return { status: 200, body: envelope({ action, ...ctx.runtime.retention.dryRun() }) };
    if (action === "activate") {
      ctx.runtime.retention.enableAutomatic();
      ctx.audit.action = "system.retention_activated";
      return { status: 200, body: envelope({ action, ...ctx.runtime.retention.dryRun(), automaticEnabled: true }) };
    }
    if (action === "deactivate") {
      ctx.runtime.retention.disableAutomatic();
      ctx.audit.action = "system.retention_deactivated";
      return { status: 200, body: envelope({ action, ...ctx.runtime.retention.dryRun(), automaticEnabled: false }) };
    }
    const result = ctx.runtime.retention.run();
    ctx.audit.action = "system.retention_run";
    ctx.audit.after = { ...result.removed };
    return { status: 200, body: envelope({ action, ...result }) };
  },
};
