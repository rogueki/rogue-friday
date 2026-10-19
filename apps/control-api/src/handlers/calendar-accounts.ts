import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { CalendarAccountInput, CalendarEventInput } from "../services/calendar-accounts";
import { calendarOperationKey, captureCalendarOutcome, flushCalendarMemory } from "../services/calendar-memory";
import { validationFailed } from "../util/errors";

type Action = { action: string; accountId?: string; calendarId?: string; account?: CalendarAccountInput;
  password?: string; expectedRevision?: number | null; selectedIds?: string[]; defaultCalendarId?: string | null;
  from?: string; to?: string; eventId?: string; etag?: string; event?: CalendarEventInput;
  scope?: "single" | "series" | "occurrence"; recurrenceId?: string };
const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });
function required<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null || value === "") throw validationFailed(`${name} fehlt.`);
  return value;
}
export const calendarAccountHandlers: Partial<Record<OperationId, Handler>> = {
  async listCalendarAccounts(ctx) { await flushCalendarMemory(ctx); return { status: 200, body: single(await ctx.runtime.calendarAccounts.list()) }; },
  async actOnCalendarAccount(ctx) {
    await flushCalendarMemory(ctx);
    const a = ctx.body as Action;
    const svc = ctx.runtime.calendarAccounts;
    const id = () => required(a.accountId, "accountId");
    const cal = () => required(a.calendarId, "calendarId");
    const rev = () => required(a.expectedRevision, "expectedRevision");
    let data: unknown;
    switch (a.action) {
      case "upsert":
        data = await svc.upsert(required(a.account, "account"), a.password, a.expectedRevision ?? null); break;
      case "delete": data = await svc.remove(id(), rev()); break;
      case "discover": data = await svc.discover(id(), rev()); break;
      case "select": data = await svc.select(id(), required(a.selectedIds, "selectedIds"), a.defaultCalendarId ?? null, rev()); break;
      case "default": data = await svc.setDefault(id(), rev()); break;
      case "check": data = await svc.check(id(), cal()); break;
      case "events": data = await svc.events(id(), cal(), required(a.from, "from"), required(a.to, "to")); break;
      case "create": {
        const key = required(ctx.idempotencyKey, "Idempotency-Key");
        const operationKey = calendarOperationKey(ctx.principal!.userId, id(), cal(), "create", key);
        const uid = operationKey.slice(0, 32);
        const result = await svc.create(id(), cal(), required(a.event, "event"), uid, operationKey, ctx.principal!.userId, "dashboard");
        const memoryPending = result.createdAt ? !(await captureCalendarOutcome(ctx, { operationKey, action: "create",
          identityId: ctx.principal!.userId, channel: "dashboard", state: result.state, externalId: result.id, createdAt: result.createdAt })) : true;
        data = { ...result, memoryPending }; break;
      }
      case "update": {
        const operationKey = calendarOperationKey(ctx.principal!.userId, id(), cal(), "update", required(ctx.idempotencyKey, "Idempotency-Key"));
        const result = await svc.update(id(), cal(), required(a.eventId, "eventId"), required(a.etag, "etag"), required(a.event, "event"), a.scope ?? "single", a.scope === "occurrence" ? required(a.recurrenceId, "recurrenceId") : undefined, operationKey, ctx.principal!.userId, "dashboard");
        const memoryPending = result.createdAt ? !(await captureCalendarOutcome(ctx, { operationKey, action: "update",
          identityId: ctx.principal!.userId, channel: "dashboard", state: result.state, externalId: result.id, createdAt: result.createdAt })) : true;
        data = { ...result, memoryPending }; break;
      }
      case "delete-event": {
        const operationKey = calendarOperationKey(ctx.principal!.userId, id(), cal(), "delete", required(ctx.idempotencyKey, "Idempotency-Key"));
        const result = await svc.deleteEvent(id(), cal(), required(a.eventId, "eventId"), required(a.etag, "etag"), a.scope ?? "single", a.scope === "occurrence" ? required(a.recurrenceId, "recurrenceId") : undefined, operationKey, ctx.principal!.userId, "dashboard");
        const memoryPending = result.createdAt ? !(await captureCalendarOutcome(ctx, { operationKey, action: "delete",
          identityId: ctx.principal!.userId, channel: "dashboard", state: result.state, externalId: result.id, createdAt: result.createdAt })) : true;
        data = { ...result, memoryPending }; break;
      }
      default: throw validationFailed("Unbekannte Kalenderaktion.");
    }
    ctx.audit.action = `calendar.account_${a.action}`;
    ctx.audit.after = { accountId: a.accountId ?? null, calendarId: a.calendarId ?? null,
      state: typeof data === "object" && data !== null && "state" in data ? data.state : "completed" };
    return { status: 200, body: single(data) };
  },
};
