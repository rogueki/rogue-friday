import { createHash } from "node:crypto";
import { isAdapterError } from "@friday/adapter-core";
import { CONTRACT_VERSION, type CalendarEvent, type CalendarEventListResponse } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { LocalCalendarService, type LocalEventInput } from "../services/local-calendar";
import { ApiError, validationFailed } from "../util/errors";

const single = (data: CalendarEvent, nowMs: number) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date(nowMs).toISOString() } });
interface CalendarCursor { localOffset: number; connectedOffset: number; remoteCursor: string | null; remoteDone: boolean; filter: string }
const cursorPrefix = "friday-calendar:";
const filterHash = (query: Record<string, unknown>) => createHash("sha256").update(JSON.stringify([query.from ?? null, query.to ?? null, query.q ?? null])).digest("hex").slice(0, 16);

function decodeCursor(value: unknown, filter: string): CalendarCursor {
  if (value === undefined) return { localOffset: 0, connectedOffset: 0, remoteCursor: null, remoteDone: false, filter };
  if (typeof value !== "string" || !value.startsWith(cursorPrefix) || value.length > 4096) throw validationFailed("Kalender-Cursor ist ungueltig.");
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(cursorPrefix.length), "base64url").toString("utf8")) as CalendarCursor;
    parsed.connectedOffset ??= 0;
    if (parsed.filter !== filter || !Number.isSafeInteger(parsed.localOffset) || parsed.localOffset < 0 || parsed.localOffset > 1_000_000 ||
      !Number.isSafeInteger(parsed.connectedOffset) || parsed.connectedOffset < 0 || parsed.connectedOffset > 1_000_000 ||
      (parsed.remoteCursor !== null && (typeof parsed.remoteCursor !== "string" || parsed.remoteCursor.length > 2000)) || typeof parsed.remoteDone !== "boolean") throw new Error("cursor");
    return parsed;
  } catch { throw validationFailed("Kalender-Cursor ist ungueltig oder gehoert zu einer anderen Abfrage."); }
}

const encodeCursor = (cursor: CalendarCursor) => `${cursorPrefix}${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
const unavailable = (error: unknown) => {
  const code = isAdapterError(error) || error instanceof ApiError ? error.code : null;
  return code === "ADAPTER_UNAVAILABLE" || code === "ADAPTER_TIMEOUT" || code === "CAPABILITY_MISSING";
};

async function connectedEvents(ctx: Parameters<Handler>[0], from?: string, to?: string): Promise<{ items: CalendarEvent[]; failed: boolean }> {
  const nowMs = ctx.runtime.nowMs();
  const start = from ?? new Date(nowMs - 30 * 86_400_000).toISOString();
  const end = to ?? new Date(nowMs + 365 * 86_400_000).toISOString();
  let accounts: Awaited<ReturnType<typeof ctx.runtime.calendarAccounts.list>>;
  try { accounts = await ctx.runtime.calendarAccounts.list(); }
  catch { return { items: [], failed: true }; }
  const selected = accounts.accounts.flatMap((account) => account.kind === "ics" ? [{ accountId: account.id, calendarId: "ics", syncMinutes: account.syncMinutes }] :
    account.calendars.filter((calendar) => calendar.selected && calendar.canRead).map((calendar) => ({ accountId: account.id, calendarId: calendar.id, syncMinutes: account.syncMinutes })));
  if (selected.length > 50) return { items: [], failed: true };
  const fetched = await Promise.allSettled(selected.map((entry) => ctx.runtime.calendarAccounts.events(entry.accountId, entry.calendarId, start, end, entry.syncMinutes)));
  const items = fetched.flatMap((result) => result.status === "fulfilled" ? result.value.items.map((entry) => entry.event) : []);
  return { items: items.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
    failed: fetched.some((result) => result.status === "rejected") };
}

export const localCalendarHandlers: Partial<Record<OperationId, Handler>> = {
  async createLocalCalendarEvent(ctx) {
    const data = new LocalCalendarService(ctx.runtime.db).create(ctx.body as LocalEventInput, ctx.principal!.userId);
    ctx.audit.action = "calendar.local_create";
    ctx.audit.after = { id: data.id, version: data.version };
    return { status: 201, body: single(data, ctx.runtime.nowMs()), headers: { "Idempotent-Replayed": "false" } };
  },
  async updateLocalCalendarEvent(ctx) {
    const data = new LocalCalendarService(ctx.runtime.db).update(ctx.pathParams.id!, ctx.body as LocalEventInput, ctx.principal!.userId, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "calendar.local_update";
    ctx.audit.after = { id: data.id, version: data.version };
    return { status: 200, body: single(data, ctx.runtime.nowMs()) };
  },
  async deleteLocalCalendarEvent(ctx) {
    const service = new LocalCalendarService(ctx.runtime.db);
    const data = service.get(ctx.pathParams.id!);
    service.delete(data.id, ctx.principal!.userId, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "calendar.local_delete";
    ctx.audit.before = { id: data.id, version: data.version };
    return { status: 200, body: single(data, ctx.runtime.nowMs()) };
  },
};

export function localCalendarReads(listRemote: Handler, getRemote: Handler): Partial<Record<OperationId, Handler>> {
  return {
    async listCalendarEvents(ctx) {
      const limit = Math.min(Number(ctx.query.limit ?? 200), 200);
      if (!Number.isSafeInteger(limit) || limit < 1) throw validationFailed("Kalender-Limit ist ungueltig.");
      const cursor = decodeCursor(ctx.query.cursor, filterHash(ctx.query));
      const local = new LocalCalendarService(ctx.runtime.db).list(ctx.query.from as string | undefined, ctx.query.to as string | undefined, ctx.query.q as string | undefined, limit + 1, cursor.localOffset);
      const connected = await connectedEvents(ctx, ctx.query.from as string | undefined, ctx.query.to as string | undefined);
      const queryText = typeof ctx.query.q === "string" ? ctx.query.q.toLocaleLowerCase("de") : null;
      const matchingConnected = queryText ? connected.items.filter((item) => item.title.toLocaleLowerCase("de").includes(queryText)) : connected.items;
      const connectedPage = matchingConnected.slice(cursor.connectedOffset, cursor.connectedOffset + limit + 1);
      let remote: CalendarEventListResponse | null = null;
      if (!cursor.remoteDone) {
        try {
          remote = (await listRemote({ ...ctx, query: { ...ctx.query, cursor: cursor.remoteCursor ?? undefined, limit } })).body as CalendarEventListResponse;
        } catch (error) {
          if (!unavailable(error)) throw error;
          // The local calendar remains usable when an optional external adapter is offline.
        }
      }
      const merged = [...local.map((item) => ({ item, source: "local" })),
        ...connectedPage.map((item) => ({ item, source: "connected" })),
        ...(remote?.items ?? []).map((item) => ({ item, source: "remote" }))]
        .sort((a, b) => a.item.start.localeCompare(b.item.start) || a.item.id.localeCompare(b.item.id)).slice(0, limit);
      const items = merged.map((entry) => entry.item);
      const localUsed = merged.filter((entry) => entry.source === "local").length;
      const connectedUsed = merged.filter((entry) => entry.source === "connected").length;
      const remoteUsed = merged.filter((entry) => entry.source === "remote").length;
      let nextRemoteCursor = cursor.remoteCursor;
      if (remote && remoteUsed > 0) {
        if (remoteUsed === remote.items.length) nextRemoteCursor = remote.pageInfo.nextCursor;
        else {
          const consumed = (await listRemote({ ...ctx, query: { ...ctx.query, cursor: cursor.remoteCursor ?? undefined, limit: remoteUsed } })).body as CalendarEventListResponse;
          nextRemoteCursor = consumed.pageInfo.nextCursor;
        }
      }
      if (remote && remote.items.length === 0 && remote.pageInfo.hasNextPage) nextRemoteCursor = remote.pageInfo.nextCursor;
      const localRemains = local.length > localUsed;
      const connectedRemains = matchingConnected.length > cursor.connectedOffset + connectedUsed;
      const remoteRemains = Boolean(remote && (remote.items.length > remoteUsed || remote.pageInfo.hasNextPage));
      if (remoteRemains && (remoteUsed > 0 || remote?.items.length === 0) && nextRemoteCursor === null) throw new ApiError({ code: "INTERNAL", message: "Externer Kalender lieferte keinen gueltigen Folgeseiten-Cursor." });
      const hasNextPage = localRemains || connectedRemains || remoteRemains;
      const nextCursor = hasNextPage ? encodeCursor({ localOffset: cursor.localOffset + localUsed,
        connectedOffset: cursor.connectedOffset + connectedUsed, remoteCursor: nextRemoteCursor, remoteDone: !remoteRemains, filter: cursor.filter }) : null;
      const asOf = new Date(ctx.runtime.nowMs()).toISOString();
      const localSource = local[0]?.source ?? { adapterId: "friday-local-calendar", system: "friday-local", lastSyncedAt: asOf };
      const sources = [localSource, ...(connected.items.length ? [{ adapterId: "friday-calendar-account", system: "friday-connected", lastSyncedAt: connected.items[0]!.source.lastSyncedAt }] : []), ...(remote?.sources ?? [])];
      const body: CalendarEventListResponse = {
        contractVersion: CONTRACT_VERSION, items, sources,
        freshness: { state: connected.failed ? "stale" : remote?.freshness.state ?? "fresh", asOf },
        pageInfo: { nextCursor, hasNextPage },
      };
      return { status: 200, body };
    },
    async getCalendarEvent(ctx) {
      if (ctx.pathParams.id && new LocalCalendarService(ctx.runtime.db).has(ctx.pathParams.id)) return { status: 200, body: single(new LocalCalendarService(ctx.runtime.db).get(ctx.pathParams.id), ctx.runtime.nowMs()) };
      const cached = ctx.pathParams.id ? ctx.runtime.calendarAccounts.getCachedEvent(ctx.pathParams.id) : undefined;
      if (cached) return { status: 200, body: single(cached, ctx.runtime.nowMs()) };
      if (ctx.pathParams.id?.startsWith("cal_")) {
        const nowMs = ctx.runtime.nowMs();
        const connected = await connectedEvents(ctx, new Date(nowMs - 365 * 86_400_000).toISOString(), new Date(nowMs + 730 * 86_400_000).toISOString());
        const item = connected.items.find((event) => event.id === ctx.pathParams.id);
        if (item) return { status: 200, body: single(item, ctx.runtime.nowMs()) };
      }
      return getRemote(ctx);
    },
  };
}
