import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { voiceIntegrationStatus } from "../services/integration-status";

const envelope = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh", asOf: new Date().toISOString() } });

export const integrationHandlers: Partial<Record<OperationId, Handler>> = {
  async getVoiceIntegrationStatus(ctx) {
    return { status: 200, body: envelope(await voiceIntegrationStatus(ctx.runtime, ctx.call)) };
  },
};
