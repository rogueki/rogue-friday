import ICAL from "ical.js";
import type { CalendarEvent, CalDavEventCreateResponse } from "@friday/sdk";
import {
  AdapterError, createId,
  type AdapterContext, type AdapterHealthReport, type CalendarPort, type CapabilitySet,
  type CallContext, type ListCalendarEventsParams, type Page, type Single,
} from "@friday/adapter-core";
import { manifest } from "./index";
import { fetchIcs, validateFeedUrl } from "./fetch-ics";
import { fetchCalDav } from "./fetch-caldav";
import { putCalDav } from "./put-caldav";

const CACHE_MS = 5 * 60_000;
const MAX_COMPONENTS = 5000;
const MAX_OCCURRENCES = 5000;
const MAX_PAGE = 200;

type SourceEvent = CalendarEvent;

export function parseEvents(document: string, fetchedAt: string, from: number, to: number): SourceEvent[] {
  const component = new ICAL.Component(ICAL.parse(document));
  if (component.name !== "vcalendar") throw new Error("Ungueltiges iCalendar-Dokument");
  const raw = component.getAllSubcomponents("vevent");
  if (raw.length > MAX_COMPONENTS) throw new Error("Kalender-Feed enthaelt zu viele Termine");
  const result: SourceEvent[] = [];
  let expanded = 0;
  for (const part of raw) {
    const event = new ICAL.Event(part);
    if (event.isRecurrenceException()) continue;
    const add = (startMs: number, endMs: number, recurrence: string) => {
      if (endMs <= from || startMs >= to) return;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
      const start = new Date(startMs).toISOString();
      const end = new Date(endMs).toISOString();
      const title = event.summary || "Ohne Titel";
      const allDay = event.startDate.isDate;
      const zone = event.startDate.zone?.tzid || "UTC";
      const statusRaw = String(part.getFirstPropertyValue("status") ?? "CONFIRMED").toUpperCase();
      result.push({
        id: createId("cal", `${event.uid || title}:${recurrence}`),
        version: 1,
        createdAt: fetchedAt,
        updatedAt: fetchedAt,
        source: { adapterId: manifest.id, system: "ics", externalId: event.uid || undefined, lastSyncedAt: fetchedAt },
        title, description: event.description || undefined,
        start, end, allDay, timeZone: zone === "floating" ? "UTC" : zone,
        location: event.location || undefined,
        attendees: [],
        status: statusRaw === "CANCELLED" ? "cancelled" : statusRaw === "TENTATIVE" ? "tentative" : "confirmed",
        reminderMinutes: [], linkedTaskIds: [], linkedThreadIds: [], conflictIds: [], briefingId: null,
      });
    };
    if (!event.isRecurring()) {
      add(event.startDate.toJSDate().getTime(), event.endDate.toJSDate().getTime(), "single");
      continue;
    }
    const iterator = event.iterator();
    let occurrence;
    while ((occurrence = iterator.next())) {
      if (++expanded > MAX_OCCURRENCES) throw new Error("Kalender-Feed enthaelt zu viele Wiederholungen");
      const details = event.getOccurrenceDetails(occurrence);
      const startMs = details.startDate.toJSDate().getTime();
      if (startMs >= to) break;
      add(startMs, details.endDate.toJSDate().getTime(), occurrence.toString());
    }
  }
  return result.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

function parseDocuments(documents: string[], fetchedAt: string, from: number, to: number): SourceEvent[] {
  const events: SourceEvent[] = [];
  for (const document of documents) {
    events.push(...parseEvents(document, fetchedAt, from, to));
    if (events.length > MAX_OCCURRENCES) throw new Error("Kalender enthaelt zu viele Termine");
  }
  return events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

export class IcsCalendarAdapter implements CalendarPort {
  readonly manifest = manifest;
  private context: AdapterContext | undefined;
  private cache: { documents: string[]; fetchedAt: string; expires: number; mode: "ics" | "caldav"; from: number; to: number } | undefined;

  async initialize(context: AdapterContext): Promise<void> {
    this.context = context;
    this.cache = undefined;
  }
  async shutdown(): Promise<void> { this.context = undefined; this.cache = undefined; }
  async getCapabilities(): Promise<CapabilitySet> {
    const url = this.context?.getSecret("calendarUrl");
    let collection = false;
    try { const target = validateFeedUrl(url ?? ""); collection = target.pathname.endsWith("/") && !target.search && !target.hash; } catch { /* invalid saved URL remains read-only */ }
    return { capabilities: this.context?.config.mode === "caldav" && collection && this.context.getSecret("username") && this.context.getSecret("password")
      ? ["calendar.read", "calendar.create"] : ["calendar.read"] };
  }
  async healthCheck(): Promise<AdapterHealthReport> {
    const start = Date.now();
    try {
      await this.load();
      return { status: "online", latencyMs: Date.now() - start };
    } catch {
      return { status: "offline", latencyMs: Date.now() - start, errorCode: "ADAPTER_UNAVAILABLE", message: "Kalender nicht konfiguriert oder nicht erreichbar" };
    }
  }
  private async load(signal?: AbortSignal, from = Date.now() - 7 * 86_400_000, to = Date.now() + 60 * 86_400_000): Promise<{ documents: string[]; fetchedAt: string; mode: "ics" | "caldav" }> {
    const mode = this.context?.config.mode === "caldav" ? "caldav" : "ics";
    const url = this.context?.getSecret(mode === "caldav" ? "calendarUrl" : "feedUrl");
    const username = mode === "caldav" ? this.context?.getSecret("username") : undefined;
    const password = mode === "caldav" ? this.context?.getSecret("password") : undefined;
    if (!url || mode === "caldav" && (!username || !password)) throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "Kalender-Zugang nicht konfiguriert" });
    try { validateFeedUrl(url); } catch { throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungueltige private Kalender-URL" }); }
    if (this.cache && Date.now() < this.cache.expires && this.cache.mode === mode && (mode === "ics" || this.cache.from <= from && this.cache.to >= to)) return this.cache;
    try {
      const documents = mode === "caldav"
        ? await fetchCalDav(url, username!, password!, from, to, signal ?? this.context?.signal)
        : [await fetchIcs(url, signal ?? this.context?.signal)];
      // Parse before accepting it into cache; never expose URL in errors.
      const fetchedAt = new Date().toISOString();
      parseDocuments(documents, fetchedAt, Date.now() - 86_400_000, Date.now() + 86_400_000);
      this.cache = { documents, fetchedAt, mode, from, to, expires: Date.now() + CACHE_MS };
      return this.cache;
    } catch {
      throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "Kalender nicht erreichbar oder ungueltig" });
    }
  }
  async listCalendarEvents(params: ListCalendarEventsParams, call: CallContext): Promise<Page<CalendarEvent>> {
    const from = params.from ? Date.parse(params.from) : Date.now() - 7 * 86_400_000;
    const to = params.to ? Date.parse(params.to) : Date.now() + 60 * 86_400_000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * 86_400_000) {
      throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungueltiger Kalender-Zeitraum" });
    }
    const { documents, fetchedAt } = await this.load(call.signal, from, to);
    const query = params.q?.toLocaleLowerCase();
    const all = parseDocuments(documents, fetchedAt, from, to)
      .filter((event) => !query || event.title.toLocaleLowerCase().includes(query));
    const offset = params.cursor ? Number(params.cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungueltiger Cursor" });
    const limit = Math.max(1, Math.min(MAX_PAGE, params.limit ?? 50));
    const items = all.slice(offset, offset + limit);
    return { items, pageInfo: { nextCursor: offset + limit < all.length ? String(offset + limit) : null, hasNextPage: offset + limit < all.length, totalCount: all.length }, freshness: { state: "fresh", asOf: fetchedAt } };
  }
  async getCalendarEvent({ id }: { id: string }, call: CallContext): Promise<Single<CalendarEvent>> {
    const from = Date.now() - 366 * 86_400_000;
    const to = Date.now() + 366 * 86_400_000;
    const { documents, fetchedAt } = await this.load(call.signal, from, to);
    const item = parseDocuments(documents, fetchedAt, from, to).find((event) => event.id === id);
    if (!item) throw new AdapterError({ code: "NOT_FOUND", message: "Kalendertermin nicht gefunden" });
    return { data: item, freshness: { state: "fresh", asOf: fetchedAt } };
  }
  async listCalendarConflicts(): Promise<Page<never>> { return { items: [], pageInfo: { nextCursor: null, hasNextPage: false, totalCount: 0 }, freshness: { state: "fresh", asOf: new Date().toISOString() } }; }
  async listCalendarBriefings(): Promise<Page<never>> { return { items: [], pageInfo: { nextCursor: null, hasNextPage: false, totalCount: 0 }, freshness: { state: "fresh", asOf: new Date().toISOString() } }; }
  async createCalendarEvent({ body }: { body: { title: string; start: string; end: string; uid: string } }, call: CallContext): Promise<Single<CalDavEventCreateResponse["data"]>> {
    if (this.context?.config.mode !== "caldav") throw new AdapterError({ code: "CAPABILITY_MISSING", message: "Kalender ist nur lesbar" });
    const url = this.context.getSecret("calendarUrl");
    const username = this.context.getSecret("username");
    const password = this.context.getSecret("password");
    if (!url || !username || !password) throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "CalDAV-Zugang fehlt" });
    try { await putCalDav(url, username, password, body, call.signal); }
    catch { throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "CalDAV-Schreibstatus unbekannt; Kalender beim Anbieter pruefen" }); }
    this.cache = undefined;
    const now = new Date().toISOString();
    return { data: { state: "created", replayed: false }, freshness: { state: "fresh", asOf: now } };
  }
}
