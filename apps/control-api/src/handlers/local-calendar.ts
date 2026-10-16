import { createHash } from "node:crypto";
import { isAdapterError } from "@friday/adapter-core";
import { CONTRACT_VERSION, type CalendarEvent, type CalendarEventListResponse } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { LocalCalendarService, type LocalEventInput } from "../services/local-calendar";
import { ApiError, validationFailed } from "../util/errors";

const single = (data: CalendarEvent) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });
interface CalendarCursor { localOffset: number; remoteCursor: string | null; remoteDone: boolean; filter: string }
const cursorPrefix = "friday-calendar:";
const filterHash = (query: Record<string, unknown>) => createHash("sha256").update(JSON.stringify([query.from ?? null, query.to ?? null, query.q ?? null])).digest("hex").slice(0, 16);

function decodeCursor(value: unknown, filter: string): CalendarCursor {
  if (value === undefined) return { localOffset: 0, remoteCursor: null, remoteDone: false, filter };
  if (typeof value !== "string" || !value.startsWith(cursorPrefix) || value.length > 4096) throw validationFailed("Kalender-Cursor ist ungueltig.");
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(cursorPrefix.length), "base64url").toString("utf8")) as CalendarCursor;
    if (parsed.filter !== filter || !Number.isSafeInteger(parsed.localOffset) || parsed.localOffset < 0 || parsed.localOffset > 1_000_000 ||
      (parsed.remoteCursor !== null && (typeof parsed.remoteCursor !== "string" || parsed.remoteCursor.length > 2000)) || typeof parsed.remoteDone !== "boolean") throw new Error("cursor");
    return parsed;
  } catch { throw validationFailed("Kalender-Cursor ist ungueltig oder gehoert zu einer anderen Abfrage."); }
}

const encodeCursor = (cursor: CalendarCursor) => `${cursorPrefix}${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
const unavailable = (error: unknown) => {
  const code = isAdapterError(error) || error instanceof ApiError ? error.code : null;
  return code === "ADAPTER_UNAVAILABLE" || code === "ADAPTER_TIMEOUT" || code === "CAPABILITY_MISSING";
};

export const localCalendarHandlers: Partial<Record<OperationId, Handler>> = {
  async createLocalCalendarEvent(ctx) {
    const data = new LocalCalendarService(ctx.runtime.db).create(ctx.body as LocalEventInput, ctx.principal!.userId);
    ctx.audit.action = "calendar.local_create";
    ctx.audit.after = { id: data.id, version: data.version };
    return { status: 201, body: single(data), headers: { "Idempotent-Replayed": "false" } };
  },
  async updateLocalCalendarEvent(ctx) {
    const data = new LocalCalendarService(ctx.runtime.db).update(ctx.pathParams.id!, ctx.body as LocalEventInput, ctx.principal!.userId, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "calendar.local_update";
    ctx.audit.after = { id: data.id, version: data.version };
    return { status: 200, body: single(data) };
  },
  async deleteLocalCalendarEvent(ctx) {
    const service = new LocalCalendarService(ctx.runtime.db);
    const data = service.get(ctx.pathParams.id!);
    service.delete(data.id, ctx.principal!.userId, ctx.mutation.ifMatchVersion);
    ctx.audit.action = "calendar.local_delete";
    ctx.audit.before = { id: data.id, version: data.version };
    return { status: 200, body: single(data) };
  },
};

export function localCalendarReads(listRemote: Handler, getRemote: Handler): Partial<Record<OperationId, Handler>> {
  return {
    async listCalendarEvents(ctx) {
      const limit = Math.min(Number(ctx.query.limit ?? 200), 200);
      if (!Number.isSafeInteger(limit) || limit < 1) throw validationFailed("Kalender-Limit ist ungueltig.");
      const cursor = decodeCursor(ctx.query.cursor, filterHash(ctx.query));
      const local = new LocalCalendarService(ctx.runtime.db).list(ctx.query.from as string | undefined, ctx.query.to as string | undefined, ctx.query.q as string | undefined, limit + 1, cursor.localOffset);
      let remote: CalendarEventListResponse | null = null;
      if (!cursor.remoteDone) {
        try {
          remote = (await listRemote({ ...ctx, query: { ...ctx.query, cursor: cursor.remoteCursor ?? undefined, limit } })).body as CalendarEventListResponse;
        } catch (error) {
          if (!unavailable(error)) throw error;
          // The local calendar remains usable when an optional external adapter is offline.
        }
      }
      const merged = [...local.map((item) => ({ item, local: true })), ...(remote?.items ?? []).map((item) => ({ item, local: false }))]
        .sort((a, b) => a.item.start.localeCompare(b.item.start) || a.item.id.localeCompare(b.item.id)).slice(0, limit);
      const items = merged.map((entry) => entry.item);
      const localUsed = merged.filter((entry) => entry.local).length;
      const remoteUsed = merged.length - localUsed;
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
      const remoteRemains = Boolean(remote && (remote.items.length > remoteUsed || remote.pageInfo.hasNextPage));
      if (remoteRemains && (remoteUsed > 0 || remote?.items.length === 0) && nextRemoteCursor === null) throw new ApiError({ code: "INTERNAL", message: "Externer Kalender lieferte keinen gueltigen Folgeseiten-Cursor." });
      const hasNextPage = localRemains || remoteRemains;
      const nextCursor = hasNextPage ? encodeCursor({ localOffset: cursor.localOffset + localUsed, remoteCursor: nextRemoteCursor, remoteDone: !remoteRemains, filter: cursor.filter }) : null;
      const localSource = local[0]?.source ?? { adapterId: "friday-local-calendar", system: "friday-local", lastSyncedAt: new Date().toISOString() };
      const sources = [localSource, ...(remote?.sources ?? [])];
      const body: CalendarEventListResponse = {
        contractVersion: CONTRACT_VERSION, items, sources,
        freshness: { state: remote?.freshness.state ?? "fresh", asOf: new Date().toISOString() },
        pageInfo: { nextCursor, hasNextPage },
      };
      return { status: 200, body };
    },
    async getCalendarEvent(ctx) {
      if (ctx.pathParams.id && new LocalCalendarService(ctx.runtime.db).has(ctx.pathParams.id)) return { status: 200, body: single(new LocalCalendarService(ctx.runtime.db).get(ctx.pathParams.id)) };
      return getRemote(ctx);
    },
  };
}
