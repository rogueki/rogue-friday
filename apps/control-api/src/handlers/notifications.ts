import { CONTRACT_VERSION, type Notification, type NotificationActionRequest, type NotificationSnoozeRequest, type Priority } from "@friday/sdk";
import { PORT_SPEC, isAdapterError } from "@friday/adapter-core";
import type { Handler, HandlerResult, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import { portHandler } from "./ports";

const listBase = portHandler("notifications", "listNotifications", PORT_SPEC.notifications.listNotifications);
const acknowledgeBase = portHandler("notifications", "acknowledgeNotification", PORT_SPEC.notifications.acknowledgeNotification);
const snoozeBase = portHandler("notifications", "snoozeNotification", PORT_SPEC.notifications.snoozeNotification);
const resolveBase = portHandler("notifications", "resolveNotification", PORT_SPEC.notifications.resolveNotification);

function freshness(ctx: RequestContext) {
  return { state: "fresh" as const, asOf: new Date(ctx.runtime.nowMs()).toISOString() };
}

function single(ctx: RequestContext, notification: Notification): HandlerResult {
  return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: notification, freshness: freshness(ctx) } };
}

function asList<T extends string>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? value as T[] : undefined;
}

/**
 * Live installations have no notifications adapter: alerts raised by Friday itself (approvals, failed or waiting tasks,
 * unreachable services) live in the native store. They are listed next to whatever a notifications adapter provides and
 * stand alone when no such adapter exists, so the alerts page works in every data mode.
 */
export const notificationHandlers: Partial<Record<OperationId, Handler>> = {
  async listNotifications(ctx) {
    const native = ctx.runtime.nativeNotifications.list({
      priority: asList<Priority>(ctx.query.priority),
      status: asList<Notification["status"]>(ctx.query.status),
      category: typeof ctx.query.category === "string" ? ctx.query.category : undefined,
    });
    let base: HandlerResult;
    try { base = await listBase(ctx); }
    catch (error) {
      // A configured adapter that is down stays an outage (503); only a missing adapter makes the native store the source.
      if (!isAdapterError(error) || error.code !== "CAPABILITY_MISSING") throw error;
      return { status: 200, body: { contractVersion: CONTRACT_VERSION, items: native,
        pageInfo: { nextCursor: null, hasNextPage: false, totalCount: native.length },
        freshness: freshness(ctx), sources: native.length ? [native[0]!.source] : [] } };
    }
    if (!native.length) return base;
    const body = base.body as { items: Notification[]; pageInfo: { totalCount?: number }; sources: Notification["source"][] };
    return { ...base, body: { ...body, items: [...native, ...body.items],
      pageInfo: { ...body.pageInfo, totalCount: (body.pageInfo.totalCount ?? body.items.length) + native.length },
      sources: [native[0]!.source, ...body.sources] } };
  },
  async acknowledgeNotification(ctx) {
    const id = String(ctx.pathParams.id);
    if (!ctx.runtime.nativeNotifications.has(id)) return acknowledgeBase(ctx);
    return single(ctx, ctx.runtime.nativeNotifications.acknowledge(id, ctx.body as NotificationActionRequest | undefined, ctx.mutation.ifMatchVersion));
  },
  async snoozeNotification(ctx) {
    const id = String(ctx.pathParams.id);
    if (!ctx.runtime.nativeNotifications.has(id)) return snoozeBase(ctx);
    return single(ctx, ctx.runtime.nativeNotifications.snooze(id, (ctx.body ?? {}) as NotificationSnoozeRequest, ctx.mutation.ifMatchVersion));
  },
  async resolveNotification(ctx) {
    const id = String(ctx.pathParams.id);
    if (!ctx.runtime.nativeNotifications.has(id)) return resolveBase(ctx);
    return single(ctx, ctx.runtime.nativeNotifications.resolve(id, ctx.body as NotificationActionRequest | undefined, ctx.mutation.ifMatchVersion));
  },
};
