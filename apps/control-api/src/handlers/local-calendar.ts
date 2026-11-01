import { createHash } from "node:crypto";
import { isAdapterError } from "@friday/adapter-core";
import { CONTRACT_VERSION, type CalendarBriefingListResponse, type CalendarConflict, type CalendarConflictListResponse, type CalendarEvent, type CalendarEventListResponse } from "@friday/sdk";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import { checkedLocalEvent, LocalCalendarService, type LocalEventInput } from "../services/local-calendar";
import type { NativeExecutableAction } from "../services/native-approval-requests";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";

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
  // Mock calendars are served by the mock adapter; the optional WSL account bridge is absent in this mode.
  if (ctx.runtime.config.dataMode === "mock") return { items: [], failed: false };
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

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;

interface CalendarWrite {
  action: NativeExecutableAction;
  actionText: string;
  previewTitle: string;
  previewText: string;
}

/**
 * Stages the exact write as a draft, binds confirmation to the unchanged action and either hands it to the tier-2
 * approval flow or lets the caller execute it once with a saved receipt. Throws for every non-executable stage.
 */
function enforceCalendarWrite(ctx: RequestContext, ownerId: string, write: CalendarWrite): string {
  const confirmedPreviewId = ctx.headers["x-action-preview-id"];
  if (confirmedPreviewId !== undefined && !PREVIEW_ID.test(confirmedPreviewId)) {
    throw validationFailed("Die Vorschaukennung ist ungueltig.", [{ path: "X-Action-Preview-Id", message: "ungueltig" }]);
  }
  if (!confirmedPreviewId) {
    const previewId = ctx.correlationId;
    ctx.runtime.nativeApprovals.propose({ ownerId, requestKey: previewId, correlationId: ctx.correlationId,
      riskTier: 2, type: "system_change", action: write.actionText,
      rationale: "Termin aus bestaetigter API-Anfrage", preview: { kind: "text", title: write.previewTitle,
        body: JSON.stringify(write.action) }, impacts: [], execution: write.action });
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Termin zuerst mit unveraenderter Vorschau bestaetigen.",
      details: { stage: "preview", previewId, previewText: write.previewText } });
  }
  const policy = ctx.runtime.nativeApprovals.confirm(ownerId, confirmedPreviewId, write.action);
  if (policy.approval) {
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Termin wartet auf Freigabe.",
      details: { stage: "approval", approvalId: policy.approval.id,
        targetRoute: `/approvals?approval=${policy.approval.id}` } });
  }
  return confirmedPreviewId;
}

/** Dispatches the stored calendar write once; a deleted event answers with the snapshot stored in the draft. */
async function executeCalendarWrite(ctx: RequestContext, ownerId: string, previewId: string): Promise<CalendarEvent> {
  let deleted: CalendarEvent | null = null;
  const id = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId, async (savedAction) => {
    const calendar = new LocalCalendarService(ctx.runtime.db);
    if (savedAction.kind === "calendar.create") return calendar.create(savedAction.body, ownerId).id;
    if (savedAction.kind === "calendar.update") return calendar.update(savedAction.id, savedAction.body, ownerId, savedAction.version).id;
    if (savedAction.kind === "calendar.delete") {
      deleted = calendar.get(savedAction.id);
      calendar.delete(savedAction.id, ownerId, savedAction.version);
      return savedAction.id;
    }
    throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
  });
  if (deleted) return deleted;
  const stored = ctx.runtime.nativeApprovals.readAction(ownerId, previewId);
  if (stored?.kind === "calendar.delete") return stored.snapshot;
  return new LocalCalendarService(ctx.runtime.db).get(id);
}

/** If-Match is the precondition of the draft; a changed or header-less repeat never matches the staged action. */
function requiredVersion(ctx: RequestContext): number {
  const version = ctx.mutation.ifMatchVersion;
  if (version === undefined || !Number.isSafeInteger(version) || version < 1) {
    throw validationFailed("If-Match mit Terminversion ist erforderlich.");
  }
  return version;
}

/** The draft carries a full snapshot so a deleted event still answers a replayed confirmation truthfully. */
type CalendarDeleteAction = Extract<NativeExecutableAction, { kind: "calendar.delete" }>;

function deleteAction(id: string, event: CalendarEvent): CalendarDeleteAction {
  return { kind: "calendar.delete", id, version: event.version, snapshot: event };
}

/** Direct API calendar writes share the same saved draft, approval decision, and receipt as command writes. */
export const localCalendarHandlers: Partial<Record<OperationId, Handler>> = {
  async createLocalCalendarEvent(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    // An invalid body fails before any preview is staged; the stored action carries the normalized values.
    const body = checkedLocalEvent(ctx.body as LocalEventInput);
    const write: CalendarWrite = {
      action: { kind: "calendar.create", body }, actionText: `Termin eintragen: ${body.title}`,
      previewTitle: "Neuer Termin", previewText: `Termin „${body.title}“ eintragen?` };
    const previewId = enforceCalendarWrite(ctx, ownerId, write);
    const data = await executeCalendarWrite(ctx, ownerId, previewId);
    ctx.audit.action = "calendar.local_create";
    ctx.audit.after = { id: data.id, version: data.version };
    return { status: 201, body: single(data, ctx.runtime.nowMs()) };
  },
  async updateLocalCalendarEvent(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const calendar = new LocalCalendarService(ctx.runtime.db);
    const id = ctx.pathParams.id!;
    const body = checkedLocalEvent(ctx.body as LocalEventInput);
    const version = requiredVersion(ctx);
    let actionText = "Termin aktualisieren";
    let previewText = "";
    if (!ctx.headers["x-action-preview-id"]) {
      // An unknown or stale target fails before any preview is staged.
      const current = calendar.get(id);
      if (current.version !== version) throw conflict("Der Termin wurde inzwischen geaendert. Bitte neu laden.");
      actionText = `Termin aktualisieren: ${current.title}`;
      previewText = `Termin „${current.title}“ aktualisieren?`;
    }
    const write: CalendarWrite = {
      action: { kind: "calendar.update", id, version, body }, actionText,
      previewTitle: "Termin aktualisieren", previewText };
    const previewId = enforceCalendarWrite(ctx, ownerId, write);
    const data = await executeCalendarWrite(ctx, ownerId, previewId);
    ctx.audit.action = "calendar.local_update";
    ctx.audit.after = { id: data.id, version: data.version };
    return { status: 200, body: single(data, ctx.runtime.nowMs()) };
  },
  async deleteLocalCalendarEvent(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const calendar = new LocalCalendarService(ctx.runtime.db);
    const id = ctx.pathParams.id!;
    requiredVersion(ctx);
    const current = calendar.has(id) ? calendar.get(id) : null;
    if (!ctx.headers["x-action-preview-id"]) {
      // An unknown or stale target fails before any preview is staged.
      if (!current) throw notFound("Termin", id);
      if (current.version !== ctx.mutation.ifMatchVersion) throw conflict("Der Termin wurde inzwischen geaendert. Bitte neu laden.");
    }
    // A replayed confirmation after completion finds the event gone; the stored draft still proves the exact action.
    const action = current ? deleteAction(id, current) : ctx.runtime.nativeApprovals.readAction(ownerId, ctx.headers["x-action-preview-id"] as string);
    if (!action || action.kind !== "calendar.delete" || action.id !== id) throw conflict("Der Entwurf passt nicht zur Aktion.");
    const write: CalendarWrite = {
      action, actionText: current ? `Termin loeschen: ${current.title}` : "Termin loeschen",
      previewTitle: "Termin loeschen", previewText: current ? `Termin „${current.title}“ loeschen?` : "" };
    const previewId = enforceCalendarWrite(ctx, ownerId, write);
    const data = await executeCalendarWrite(ctx, ownerId, previewId);
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

const conflictAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const conflictId = (first: string, second: string) => {
  const digest = createHash("sha256").update(`${first}|${second}`).digest();
  let id = "conf_";
  for (const byte of digest.subarray(0, 26)) id += conflictAlphabet[byte % 62]!;
  return id;
};

const localCalendarSource = (lastSyncedAt: string) => ({ adapterId: "friday-local-calendar", system: "friday-local", lastSyncedAt });

export function localCalendarFallbacks(listConflicts: Handler, listBriefings: Handler): Partial<Record<OperationId, Handler>> {
  return {
    async listCalendarConflicts(ctx) {
      try {
        return await listConflicts(ctx);
      } catch (error) {
        if (!unavailable(error)) throw error;
      }
      const nowMs = ctx.runtime.nowMs();
      const nowIso = new Date(nowMs).toISOString();
      const fromIso = nowIso;
      const toIso = new Date(nowMs + 30 * 86_400_000).toISOString();
      const local = new LocalCalendarService(ctx.runtime.db).list(fromIso, toIso, undefined, 201, 0);
      const connected = (await connectedEvents(ctx, fromIso, toIso)).items;
      const events = [...local, ...connected]
        .filter((event) => event.allDay !== true && event.status !== "cancelled" && /^cal_[0-9A-Za-z]{26}$/.test(event.id))
        .map((event) => ({ event, start: new Date(event.start).toISOString(), end: new Date(event.end).toISOString() }))
        .sort((a, b) => a.start.localeCompare(b.start) || a.event.id.localeCompare(b.event.id));
      const items: CalendarConflict[] = [];
      for (let i = 0; i < events.length && items.length < 50; i++) {
        const a = events[i]!;
        for (let j = i + 1; j < events.length && items.length < 50; j++) {
          const b = events[j]!;
          if (b.start >= a.end) break;
          items.push({
            id: conflictId(a.event.id, b.event.id),
            version: 1,
            createdAt: nowIso,
            updatedAt: nowIso,
            detectedAt: nowIso,
            source: localCalendarSource(nowIso),
            eventIds: [a.event.id, b.event.id],
            kind: "overlap",
            severity: "warning",
            description: `„${a.event.title}“ überschneidet sich mit „${b.event.title}“.`,
          });
        }
      }
      const body: CalendarConflictListResponse = {
        contractVersion: CONTRACT_VERSION,
        items,
        pageInfo: { nextCursor: null, hasNextPage: false },
        freshness: { state: "fresh", asOf: nowIso },
        sources: [localCalendarSource(nowIso)],
      };
      return { status: 200, body };
    },
    async listCalendarBriefings(ctx) {
      try {
        return await listBriefings(ctx);
      } catch (error) {
        if (!unavailable(error)) throw error;
      }
      const nowIso = new Date(ctx.runtime.nowMs()).toISOString();
      const body: CalendarBriefingListResponse = {
        contractVersion: CONTRACT_VERSION,
        items: [],
        pageInfo: { nextCursor: null, hasNextPage: false },
        freshness: { state: "fresh", asOf: nowIso },
        sources: [localCalendarSource(nowIso)],
      };
      return { status: 200, body };
    },
  };
}
