import ICAL from "ical.js";
import type { CalendarEvent } from "@friday/sdk";
import {
  AdapterError, createId,
  type AdapterContext, type AdapterHealthReport, type CalendarPort, type CapabilitySet,
  type CallContext, type ListCalendarEventsParams, type Page, type Single,
} from "@friday/adapter-core";
import { manifest } from "./index";
import { fetchIcs, validateFeedUrl } from "./fetch-ics";

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

export class IcsCalendarAdapter implements CalendarPort {
  readonly manifest = manifest;
  private context: AdapterContext | undefined;
  private cache: { text: string; fetchedAt: string; expires: number } | undefined;

  async initialize(context: AdapterContext): Promise<void> {
    this.context = context;
    this.cache = undefined;
  }
  async shutdown(): Promise<void> { this.context = undefined; this.cache = undefined; }
  async getCapabilities(): Promise<CapabilitySet> { return { capabilities: ["calendar.read"] }; }
  async healthCheck(): Promise<AdapterHealthReport> {
    const start = Date.now();
    try {
      await this.load();
      return { status: "online", latencyMs: Date.now() - start };
    } catch {
      return { status: "offline", latencyMs: Date.now() - start, errorCode: "ADAPTER_UNAVAILABLE", message: "iCalendar-Feed nicht konfiguriert oder nicht erreichbar" };
    }
  }
  private async load(signal?: AbortSignal): Promise<{ text: string; fetchedAt: string }> {
    const url = this.context?.getSecret("feedUrl");
    if (!url) throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "iCalendar-Feed nicht konfiguriert" });
    try { validateFeedUrl(url); } catch { throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungueltige private Kalender-URL" }); }
    if (this.cache && Date.now() < this.cache.expires) return this.cache;
    try {
      const text = await fetchIcs(url, signal ?? this.context?.signal);
      // Parse before accepting it into cache; never expose URL in errors.
      const fetchedAt = new Date().toISOString();
      parseEvents(text, fetchedAt, Date.now() - 86_400_000, Date.now() + 86_400_000);
      this.cache = { text, fetchedAt, expires: Date.now() + CACHE_MS };
      return this.cache;
    } catch {
      throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "iCalendar-Feed nicht erreichbar oder ungueltig" });
    }
  }
  async listCalendarEvents(params: ListCalendarEventsParams, call: CallContext): Promise<Page<CalendarEvent>> {
    const from = params.from ? Date.parse(params.from) : Date.now() - 7 * 86_400_000;
    const to = params.to ? Date.parse(params.to) : Date.now() + 60 * 86_400_000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * 86_400_000) {
      throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungueltiger Kalender-Zeitraum" });
    }
    const { text, fetchedAt } = await this.load(call.signal);
    const query = params.q?.toLocaleLowerCase();
    const all = parseEvents(text, fetchedAt, from, to).filter((event) => !query || event.title.toLocaleLowerCase().includes(query));
    const offset = params.cursor ? Number(params.cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungueltiger Cursor" });
    const limit = Math.max(1, Math.min(MAX_PAGE, params.limit ?? 50));
    const items = all.slice(offset, offset + limit);
    return { items, pageInfo: { nextCursor: offset + limit < all.length ? String(offset + limit) : null, hasNextPage: offset + limit < all.length, totalCount: all.length }, freshness: { state: "fresh", asOf: fetchedAt } };
  }
  async getCalendarEvent({ id }: { id: string }, call: CallContext): Promise<Single<CalendarEvent>> {
    const { text, fetchedAt } = await this.load(call.signal);
    const item = parseEvents(text, fetchedAt, Date.now() - 366 * 86_400_000, Date.now() + 366 * 86_400_000).find((event) => event.id === id);
    if (!item) throw new AdapterError({ code: "NOT_FOUND", message: "Kalendertermin nicht gefunden" });
    return { data: item, freshness: { state: "fresh", asOf: fetchedAt } };
  }
  async listCalendarConflicts(): Promise<Page<never>> { return { items: [], pageInfo: { nextCursor: null, hasNextPage: false, totalCount: 0 }, freshness: { state: "fresh", asOf: new Date().toISOString() } }; }
  async listCalendarBriefings(): Promise<Page<never>> { return { items: [], pageInfo: { nextCursor: null, hasNextPage: false, totalCount: 0 }, freshness: { state: "fresh", asOf: new Date().toISOString() } }; }
}
