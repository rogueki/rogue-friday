import { createHash } from "node:crypto";
import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { stableUserId } from "../security/auth-service";
import type { CalendarAccount, CalendarEventInput, CalendarItem } from "../services/calendar-accounts";
import { calendarOperationKey, captureCalendarOutcome, flushCalendarMemory } from "../services/calendar-memory";
import { conflict, forbidden, validationFailed } from "../util/errors";

interface VoiceRequest { action: "create" | "update" | "delete"; calendarName?: string;
  targetTitle?: string; title?: string; start?: string; end?: string; timeZone?: string }
interface ConfirmRequest { request: VoiceRequest; token: string; accountId: string; calendarId: string;
  eventId: string; etag: string }
const ownerId = stableUserId("owner");
const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });
const fingerprint = (request: VoiceRequest, accountId: string, calendarId: string, eventId: string, etag: string) =>
  createHash("sha256").update(JSON.stringify([request, accountId, calendarId, eventId, etag])).digest("hex");

function assertVoice(ctx: Parameters<Handler>[0]): void {
  if (!ctx.voiceBridgeAuthorized || !ctx.runtime.auth.ownerPasswordConfigured())
    throw forbidden("Verbundene Kalender-Sprachaktionen erfordern den lokalen Voice-Dienst und ein Besitzerkonto.");
}
function chooseAccount(accounts: CalendarAccount[], defaultId: string | null, name?: string): CalendarAccount {
  const matching = name ? accounts.filter((account) => account.displayName.toLocaleLowerCase("de") === name.toLocaleLowerCase("de")) :
    accounts.filter((account) => account.id === defaultId);
  if (matching.length !== 1) throw conflict("Kalenderkonto ist nicht eindeutig. Bitte im Dashboard auswählen.");
  if (matching[0]!.kind !== "caldav") throw forbidden("ICS-Feeds sind nur lesbar.");
  return matching[0]!;
}
function eventInput(request: VoiceRequest, previous?: CalendarItem): CalendarEventInput {
  const start = request.start ?? previous?.event.start ?? "";
  const duration = previous ? Date.parse(previous.event.end) - Date.parse(previous.event.start) : 0;
  const end = request.end ?? (request.start && previous && duration > 0 ? new Date(Date.parse(start) + duration).toISOString() : previous?.event.end) ?? "";
  if (!request.title && !previous || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start))
    throw validationFailed("Terminzeit oder Titel ist ungültig.");
  return { title: request.title ?? previous!.event.title, start, end, allDay: false,
    description: previous?.event.description ?? "", location: previous?.event.location ?? "" };
}
async function findTarget(ctx: Parameters<Handler>[0], account: CalendarAccount, title: string) {
  const now = Date.now();
  const from = new Date(now - 30 * 86_400_000).toISOString();
  const to = new Date(now + 365 * 86_400_000).toISOString();
  const found: Array<{ calendarId: string; item: CalendarItem }> = [];
  for (const cal of account.calendars.filter((item) => item.selected && item.canWrite)) {
    const { items } = await ctx.runtime.calendarAccounts.events(account.id, cal.id, from, to);
    for (const item of items) if (item.event.title.toLocaleLowerCase("de") === title.toLocaleLowerCase("de")) found.push({ calendarId: cal.id, item });
  }
  if (found.length !== 1) throw conflict(found.length ? "Mehrere verbundene Termine tragen diesen Titel. Bitte im Dashboard bearbeiten." : "Kein eindeutiger verbundener Termin gefunden.");
  if (found[0]!.item.recurring) throw conflict("Terminserie braucht eine ausdrückliche Serienauswahl im Dashboard.");
  return found[0]!;
}

export const connectedCalendarVoiceHandlers: Partial<Record<OperationId, Handler>> = {
  async previewVoiceConnectedCalendar(ctx) {
    assertVoice(ctx);
    await flushCalendarMemory(ctx);
    const request = ctx.body as VoiceRequest;
    const listed = await ctx.runtime.calendarAccounts.list();
    const account = chooseAccount(listed.accounts, listed.defaultAccountId, request.calendarName);
    const target = request.action === "create" ? null : await findTarget(ctx, account, request.targetTitle ?? "");
    const calendarId = target?.calendarId ?? account.defaultCalendarId;
    const collection = account.calendars.find((item) => item.id === calendarId && item.selected && item.canWrite);
    if (!collection) throw forbidden("Kein beschreibbarer Standardkalender gewählt.");
    const event = request.action === "delete" ? {
      title: target!.item.event.title, start: target!.item.event.start, end: target!.item.event.end, allDay: target!.item.event.allDay,
    } : eventInput(request, target?.item);
    const eventId = target?.item.id ?? "";
    const etag = target?.item.etag ?? "";
    const { token, claims } = ctx.runtime.approvalTokens.issue({ approvalId: fingerprint(request, account.id, collection.id, eventId, etag),
      userId: ownerId, action: `calendar.connected.voice.${request.action}` });
    return { status: 200, body: single({ token, expiresAt: new Date(claims.expiresAt).toISOString(),
      accountId: account.id, accountName: account.displayName, calendarId: collection.id, calendarName: collection.name,
      eventId, etag, event }) };
  },
  async confirmVoiceConnectedCalendar(ctx) {
    assertVoice(ctx);
    await flushCalendarMemory(ctx);
    if (!ctx.idempotencyKey) throw validationFailed("Idempotency-Key fehlt.");
    const { request, token, accountId, calendarId, eventId, etag } = ctx.body as ConfirmRequest;
    const listed = await ctx.runtime.calendarAccounts.list();
    const account = chooseAccount(listed.accounts, listed.defaultAccountId, request.calendarName);
    if (account.id !== accountId) throw conflict("Kalenderkonto hat sich geändert.");
    const target = request.action === "create" ? null : await findTarget(ctx, account, request.targetTitle ?? "");
    if (request.action === "create" && (eventId || etag) || target &&
      (target.calendarId !== calendarId || target.item.id !== eventId || target.item.etag !== etag))
      throw conflict("Termin hat sich seit der Vorschau geändert.");
    const allowed = ctx.runtime.approvalTokens.consume(token, { approvalId: fingerprint(request, accountId, calendarId, eventId, etag),
      userId: ownerId, action: `calendar.connected.voice.${request.action}` });
    if (!allowed.ok) throw conflict("Sprachbestätigung ungültig oder abgelaufen.");
    const svc = ctx.runtime.calendarAccounts;
    const operationKey = calendarOperationKey(ownerId, accountId, calendarId, request.action, ctx.idempotencyKey);
    const result = request.action === "create" ? await svc.create(accountId, calendarId, eventInput(request),
      operationKey.slice(0, 32), operationKey, ownerId, "voice") :
      request.action === "update" ? await svc.update(accountId, calendarId, eventId, etag, eventInput(request, target!.item), "single", undefined, operationKey, ownerId, "voice") :
        await svc.deleteEvent(accountId, calendarId, eventId, etag, "single", undefined, operationKey, ownerId, "voice");
    const memoryPending = result.createdAt ? !(await captureCalendarOutcome(ctx, { operationKey, action: request.action,
      identityId: ownerId, channel: "voice", state: result.state, externalId: result.id, createdAt: result.createdAt })) : true;
    ctx.audit.action = `calendar.connected.voice_${request.action}`;
    ctx.audit.after = { accountId, calendarId, state: result.state };
    return { status: 200, body: single({ state: result.state, memoryPending, accountName: account.displayName, calendarName:
      account.calendars.find((item) => item.id === calendarId)?.name ?? "Kalender" }),
      headers: { "Idempotent-Replayed": "false" } };
  },
};
