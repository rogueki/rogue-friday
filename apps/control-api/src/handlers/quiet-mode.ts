import { CONTRACT_VERSION, type QuietModeRequest, type QuietModeResponse, type QuietModeState } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";

const response = (data: QuietModeState): QuietModeResponse => ({
  contractVersion: CONTRACT_VERSION,
  data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() },
});

export const quietModeHandlers: Partial<Record<OperationId, Handler>> = {
  async getQuietMode(ctx) {
    return { status: 200, body: response(ctx.runtime.quietMode.state()) };
  },
  async setQuietMode(ctx) {
    const { until } = ctx.body as QuietModeRequest;
    const data = ctx.runtime.quietMode.set(until);
    ctx.audit.action = "notifications.quiet_mode_set";
    ctx.audit.after = { until: data.until };
    return { status: 200, body: response(data) };
  },
  async clearQuietMode(ctx) {
    const data = ctx.runtime.quietMode.clear();
    ctx.audit.action = "notifications.quiet_mode_cleared";
    return { status: 200, body: response(data) };
  },
};
