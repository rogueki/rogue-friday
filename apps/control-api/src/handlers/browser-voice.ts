import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";

export const browserVoiceHandlers: Partial<Record<OperationId, Handler>> = {
  async getBrowserAudioAvailability(ctx) {
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, available: await ctx.runtime.hub.browserAudioAvailable() } };
  },
};
