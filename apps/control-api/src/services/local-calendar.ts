import { createId } from "@friday/observability";
import type { CalendarEvent } from "@friday/sdk";
import type { Db } from "../db/database";
import { conflict, notFound, validationFailed } from "../util/errors";

export interface LocalEventInput { title: string; start: string; end: string; timeZone: string }
interface Row { id: string; owner_id: string; version: number; title: string; starts_at: string; ends_at: string; time_zone: string; created_at: string; updated_at: string }

export function checkedLocalEvent(input: LocalEventInput): LocalEventInput {
  if (!input || typeof input.title !== "string" || typeof input.start !== "string" || typeof input.end !== "string" || typeof input.timeZone !== "string") throw validationFailed("Termindaten fehlen.");
  const title = input.title.trim();
  if (!title || [...title].length > 120 || [...title].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw validationFailed("Titel ist ungueltig.");
  const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/;
  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  if (!iso.test(input.start) || !iso.test(input.end) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 31 * 86_400_000) throw validationFailed("Beginn und Ende muessen einen gueltigen Termin bis zu 31 Tagen Dauer beschreiben.");
  try { new Intl.DateTimeFormat("de-DE", { timeZone: input.timeZone }); }
  catch { throw validationFailed("Zeitzone ist ungueltig."); }
  return { title, start: new Date(start).toISOString(), end: new Date(end).toISOString(), timeZone: input.timeZone };
}

function event(row: Row): CalendarEvent {
  return {
    id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    source: { adapterId: "friday-local-calendar", system: "friday-local", externalId: row.id, lastSyncedAt: row.updated_at },
    title: row.title, start: row.starts_at, end: row.ends_at, timeZone: row.time_zone,
    allDay: false, attendees: [], status: "confirmed", reminderMinutes: [], linkedTaskIds: [], linkedThreadIds: [], conflictIds: [], briefingId: null,
    labels: [], description: "", location: "",
  };
}

export class LocalCalendarService {
  constructor(private readonly db: Db) {}

  list(from?: string, to?: string, q?: string, limit = 200, offset = 0): CalendarEvent[] {
    if (limit < 1 || limit > 201) throw validationFailed("Limit muss zwischen 1 und 201 liegen.");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw validationFailed("Kalender-Cursor ist ungueltig.");
    const fromIso = from === undefined ? "0000-01-01T00:00:00.000Z" : this.rangeDate(from);
    const toIso = to === undefined ? "9999-12-31T23:59:59.999Z" : this.rangeDate(to);
    if (fromIso >= toIso) throw validationFailed("Kalenderzeitraum ist ungueltig.");
    const rows = this.db.prepare(`SELECT * FROM local_calendar_events WHERE starts_at < ? AND ends_at > ? AND title LIKE ? ESCAPE '\\' ORDER BY starts_at, id LIMIT ? OFFSET ?`).all(toIso, fromIso, `%${(q ?? "").replace(/[\\%_]/g, "\\$&")}%`, limit, offset) as unknown as Row[];
    return rows.map(event);
  }

  get(id: string): CalendarEvent {
    const row = this.db.prepare("SELECT * FROM local_calendar_events WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw notFound("Termin", id);
    return event(row);
  }

  has(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM local_calendar_events WHERE id = ?").get(id) !== undefined;
  }

  findOwnerByTitle(ownerId: string, title: string): CalendarEvent[] {
    const rows = this.db.prepare("SELECT * FROM local_calendar_events WHERE owner_id = ? AND lower(title) = lower(?) ORDER BY starts_at, id LIMIT 5").all(ownerId, title.trim()) as unknown as Row[];
    return rows.map(event);
  }

  create(input: LocalEventInput, ownerId: string): CalendarEvent {
    const data = checkedLocalEvent(input);
    const id = createId("cal");
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO local_calendar_events (id, owner_id, version, title, starts_at, ends_at, time_zone, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)").run(id, ownerId, data.title, data.start, data.end, data.timeZone, now, now);
    return this.get(id);
  }

  update(id: string, input: LocalEventInput, ownerId: string, version: number | undefined): CalendarEvent {
    if (version === undefined || !Number.isSafeInteger(version) || version < 1) throw validationFailed("If-Match mit Terminversion ist erforderlich.");
    const data = checkedLocalEvent(input);
    const updated = this.db.prepare("UPDATE local_calendar_events SET title = ?, starts_at = ?, ends_at = ?, time_zone = ?, version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?").run(data.title, data.start, data.end, data.timeZone, new Date().toISOString(), id, ownerId, version).changes;
    if (!updated) this.missingOrConflict(id, ownerId);
    return this.get(id);
  }

  delete(id: string, ownerId: string, version: number | undefined): void {
    if (version === undefined || !Number.isSafeInteger(version) || version < 1) throw validationFailed("If-Match mit Terminversion ist erforderlich.");
    const deleted = this.db.prepare("DELETE FROM local_calendar_events WHERE id = ? AND owner_id = ? AND version = ?").run(id, ownerId, version).changes;
    if (!deleted) this.missingOrConflict(id, ownerId);
  }

  private rangeDate(value: string): string {
    const date = Date.parse(value);
    if (!Number.isFinite(date)) throw validationFailed("Kalenderzeitraum ist ungueltig.");
    return new Date(date).toISOString();
  }

  private missingOrConflict(id: string, ownerId: string): never {
    const row = this.db.prepare("SELECT version FROM local_calendar_events WHERE id = ? AND owner_id = ?").get(id, ownerId);
    if (!row) throw notFound("Termin", id);
    throw conflict("Der Termin wurde inzwischen geaendert. Bitte neu laden.");
  }
}
