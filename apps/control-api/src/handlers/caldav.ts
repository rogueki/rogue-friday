import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { CalDavCreateInput, CalDavEventInput } from "../services/caldav-create";

const single = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh", asOf: new Date().toISOString() } });

export const caldavHandlers: Partial<Record<OperationId, Handler>> = {
  async previewCalDavEvent(ctx) {
    const data = ctx.runtime.caldavCreate.preview(ctx.body as CalDavEventInput, ctx.principal!.userId, ctx.idempotencyKey ?? "");
    return { status: 200, body: single(data) };
  },
  async createCalendarEvent(ctx) {
    const outcome = await ctx.runtime.caldavCreate.create(ctx.body as CalDavCreateInput, ctx.principal!.userId, ctx.idempotencyKey ?? "", ctx.call);
    ctx.audit.action = "calendar.caldav_create";
    ctx.audit.severity = "warning";
    ctx.audit.after = { state: outcome.state, replayed: outcome.replayed };
    return { status: 200, body: single(outcome), headers: { "Idempotent-Replayed": String(outcome.replayed) } };
  },
};
