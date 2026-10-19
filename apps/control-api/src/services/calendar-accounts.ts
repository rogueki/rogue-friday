import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inspectCalendarDocument, parseEventEntries } from "@friday/adapter-calendar-placeholder";
import type { CalendarEvent } from "@friday/sdk";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { invokeCodingRunner, type RunnerInvoker } from "./coding-runs";

export interface CalendarCollection {
  id: string; name: string; color: string | null; timeZone: string | null;
  canRead: boolean; canWrite: boolean; selected: boolean;
}
export interface CalendarAccount {
  id: string; kind: "caldav" | "ics"; displayName: string; baseUrl: string; username: string;
  syncMinutes: number; revision: number; calendars: CalendarCollection[];
  defaultCalendarId: string | null; secretState: { password: boolean };
}
export interface CalendarAccountInput {
  id?: string; kind: "caldav" | "ics"; displayName: string; baseUrl: string; username: string;
  syncMinutes: number;
}
export interface CalendarEventInput {
  title: string; start: string; end: string; allDay?: boolean;
  description?: string; location?: string; rrule?: string;
}
export interface CalendarItem {
  id: string; etag: string; calendarId: string; recurring: boolean; hasExceptions: boolean;
  masterStart: string; masterEnd: string; recurrenceId: string | null; event: CalendarEvent;
}

const unavailable = () => new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Kalenderdienst in Friday-Ubuntu ist nicht erreichbar." });

export class CalendarAccountsService {
  private readonly eventCache = new Map<string, { expires: number; value: { items: CalendarItem[]; readOnly: boolean } }>();
  private readonly eventById = new Map<string, CalendarEvent>();
  constructor(private readonly dataDir: string, private readonly invoke: RunnerInvoker = invokeCodingRunner) {}

  getCachedEvent(id: string): CalendarEvent | undefined { return this.eventById.get(id); }
  private invalidateEvents(): void { this.eventCache.clear(); this.eventById.clear(); }

  private target(): { script: string; distro: string; user: string } {
    let root = resolve(this.dataDir);
    for (let depth = 0; depth < 5 && !existsSync(join(root, "config", "install-state.json")); depth += 1) root = resolve(root, "..");
    if (!existsSync(join(root, "config", "install-state.json"))) throw unavailable();
    let state: { distro_name?: string; linux_user?: string };
    try { state = JSON.parse(readFileSync(join(root, "config", "install-state.json"), "utf8").replace(/^\uFEFF/, "")) as typeof state; }
    catch { throw unavailable(); }
    if (!state.distro_name || !state.linux_user || !/^[a-zA-Z0-9_.-]+$/.test(state.distro_name) || !/^[a-zA-Z0-9_-]+$/.test(state.linux_user)) throw unavailable();
    const match = root.match(/^([a-zA-Z]):\\(.*)$/);
    if (!match) throw unavailable();
    return { distro: state.distro_name, user: state.linux_user,
      script: `/mnt/${match[1]?.toLowerCase()}/${match[2]?.replaceAll("\\", "/")}/installer/wsl/calendar_accounts.py` };
  }

  private async run<T>(request: Record<string, unknown>, write = false): Promise<T> {
    const { script, distro, user } = this.target();
    let result: Record<string, unknown>;
    try { result = await this.invoke(script, distro, user, [], JSON.stringify(request), write ? 35_000 : 20_000, 2_500_000); }
    catch (error) {
      const message = String(error);
      if (message.includes("revision_conflict")) throw conflict("Kalenderkonto wurde inzwischen geändert. Bitte neu laden.");
      if (message.includes("etag_conflict")) throw conflict("Termin wurde beim Anbieter geändert. Bitte neu laden.");
      if (message.includes("read_only")) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Kalender ist nur lesbar." });
      if (message.includes("etag_required")) throw validationFailed("Aktueller ETag für die Änderung fehlt.");
      if (message.includes("account_not_found") || message.includes("calendar_not_selected")) throw validationFailed("Kalenderkonto oder Kalender nicht gefunden.");
      if (message.includes("auth_failed")) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Kalender-Anmeldung oder Berechtigung abgelaufen." });
      if (message.includes("unsupported_series")) throw validationFailed("Terminserie mit Ausnahmen kann hier nicht sicher geändert werden.");
      if (message.includes("scope_required")) throw validationFailed("Terminserie erfordert eine ausdrückliche Serienauswahl.");
      if (message.includes("unsupported_occurrence")) throw validationFailed("Einzelne Serienvorkommen werden noch nicht sicher unterstützt.");
      if (message.includes("operation_conflict")) throw conflict("Idempotency-Key wurde bereits für andere Termindaten verwendet.");
      if (message.includes("operation_key_required") || message.includes("unsupported_timezone")) throw validationFailed("Kalenderaktion oder Zeitzone ist ungültig.");
      if (/missing_secret|private_host|cross_origin|response_too_large|read_failed|calendar_unavailable/.test(message)) throw unavailable();
      if (/invalid_(event|range|date|rrule|title|url)/.test(message)) throw validationFailed("Kalendereingabe ist ungültig.");
      if (write) return { state: "uncertain", id: null, etag: null, createdAt: null } as T;
      throw unavailable();
    }
    if (result.error) {
      if (result.error === "revision_conflict") throw conflict("Kalenderkonto wurde inzwischen geändert. Bitte neu laden.");
      if (result.error === "etag_conflict") throw conflict("Termin wurde beim Anbieter geändert. Bitte neu laden.");
      if (result.error === "read_only") throw new ApiError({ code: "CAPABILITY_MISSING", message: "Kalender ist nur lesbar." });
      if (result.error === "etag_required") throw validationFailed("Aktueller ETag für die Änderung fehlt.");
      if (result.error === "unsupported_series") throw validationFailed("Terminserie mit Ausnahmen kann hier nicht sicher geändert werden.");
      if (result.error === "scope_required") throw validationFailed("Terminserie erfordert eine ausdrückliche Serienauswahl.");
      if (result.error === "unsupported_occurrence") throw validationFailed("Einzelne Serienvorkommen werden noch nicht sicher unterstützt.");
      if (result.error === "operation_conflict") throw conflict("Idempotency-Key wurde bereits für andere Termindaten verwendet.");
      if (result.error === "operation_key_required" || result.error === "unsupported_timezone") throw validationFailed("Kalenderaktion oder Zeitzone ist ungültig.");
      if (typeof result.error === "string" && result.error.startsWith("invalid_")) throw validationFailed("Kalendereingabe ist ungültig.");
      throw unavailable();
    }
    return result as T;
  }

  list() { return this.run<{ revision: number; defaultAccountId: string | null; accounts: CalendarAccount[] }>({ action: "list" }); }
  pendingMemory() { return this.run<{ events: Array<{ operationKey: string; state: string; result: { id: string | null }; createdAt: string;
    meta: { action: string; identityId: string | null; channel: string } }> }>({ action: "pending-memory" }); }
  ackMemory(operationKey: string) { return this.run<{ acknowledged: boolean }>({ action: "ack-memory", operationKey }); }
  async upsert(account: CalendarAccountInput, password: string | undefined, expectedRevision: number | null) {
    const result = await this.run<CalendarAccount>({ action: "upsert", account, ...(password === undefined ? {} : { password }), expectedRevision });
    this.invalidateEvents(); return result;
  }
  async remove(accountId: string, expectedRevision: number) {
    const result = await this.run<{ deleted: boolean }>({ action: "delete", accountId, expectedRevision });
    this.invalidateEvents(); return result;
  }
  async discover(accountId: string, expectedRevision: number) {
    const result = await this.run<CalendarAccount>({ action: "discover", accountId, expectedRevision });
    this.invalidateEvents(); return result;
  }
  async select(accountId: string, selectedIds: string[], defaultCalendarId: string | null, expectedRevision: number) {
    const result = await this.run<CalendarAccount>({ action: "select", accountId, selectedIds, defaultCalendarId, expectedRevision });
    this.invalidateEvents(); return result;
  }
  setDefault(accountId: string, expectedRevision: number) {
    return this.run<{ revision: number; defaultAccountId: string }>({ action: "default", accountId, expectedRevision });
  }
  check(accountId: string, calendarId: string) {
    return this.run<{ ok: boolean; canRead: boolean; canWrite: boolean }>({ action: "check", accountId, calendarId });
  }
  async events(accountId: string, calendarId: string, from: string, to: string, cacheMinutes = 0): Promise<{ items: CalendarItem[]; readOnly: boolean }> {
    const key = JSON.stringify([accountId, calendarId, from, to]);
    const cached = this.eventCache.get(key);
    if (cacheMinutes > 0 && cached && cached.expires > Date.now()) return cached.value;
    const result = await this.run<{ items: Array<{ id: string; etag: string; calendarId: string; data: string }>; readOnly: boolean }>(
      { action: "events", accountId, calendarId, from, to });
    const fetchedAt = new Date().toISOString();
    const start = Date.parse(from), end = Date.parse(to);
    const items = result.items.flatMap((item) => {
      const metadata = item.calendarId === "ics" ? null : inspectCalendarDocument(item.data);
      return parseEventEntries(item.data, fetchedAt, start, end).map(({ event, recurrenceId }) => ({
      id: item.id, etag: item.etag, calendarId: item.calendarId,
      ...(metadata ?? { recurring: recurrenceId !== null, hasExceptions: false, masterStart: event.start, masterEnd: event.end }),
      recurrenceId,
      event: { ...event, id: `cal_${createHash("sha256").update(JSON.stringify([accountId, calendarId, item.id, recurrenceId ?? event.start])).digest("hex").slice(0, 26)}`,
        source: { ...event.source, adapterId: "friday-calendar-account", system: accountId, externalId: item.id } },
      }));
    });
    const value = { items, readOnly: result.readOnly };
    if (cacheMinutes > 0) {
      if (this.eventCache.size >= 128) this.eventCache.delete(this.eventCache.keys().next().value!);
      this.eventCache.set(key, { expires: Date.now() + Math.min(cacheMinutes, 1440) * 60_000, value });
    }
    for (const item of items) {
      if (this.eventById.size >= 2000) this.eventById.delete(this.eventById.keys().next().value!);
      this.eventById.set(item.event.id, item.event);
    }
    return value;
  }
  async create(accountId: string, calendarId: string, event: CalendarEventInput, uid: string, operationKey: string, identityId: string, channel: string) {
    const result = await this.run<{ state: "created" | "uncertain"; id: string | null; etag: string | null; createdAt: string | null }>(
      { action: "create", accountId, calendarId, event, uid, operationKey, identityId, channel }, true);
    this.invalidateEvents(); return result;
  }
  async update(accountId: string, calendarId: string, eventId: string, etag: string, event: CalendarEventInput, scope: "single" | "series" | "occurrence", recurrenceId: string | undefined, operationKey: string, identityId: string, channel: string) {
    const result = await this.run<{ state: "updated" | "uncertain"; id: string | null; etag: string | null; createdAt: string | null }>(
      { action: "update", accountId, calendarId, eventId, etag, event, scope, recurrenceId, operationKey, identityId, channel }, true);
    this.invalidateEvents(); return result;
  }
  async deleteEvent(accountId: string, calendarId: string, eventId: string, etag: string, scope: "single" | "series" | "occurrence", recurrenceId: string | undefined, operationKey: string, identityId: string, channel: string) {
    const result = await this.run<{ state: "deleted" | "uncertain"; id: string | null; createdAt: string | null }>(
      { action: "delete-event", accountId, calendarId, eventId, etag, scope, recurrenceId, operationKey, identityId, channel }, true);
    this.invalidateEvents(); return result;
  }
}
