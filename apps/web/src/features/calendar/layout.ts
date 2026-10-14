import type { CalendarEvent } from "@jarvis/sdk";
import { addDays, civilKey, instantOf, parseCivilKey, type Civil } from "./dates";

export const WORK_START_MIN = 8 * 60;
export const WORK_END_MIN = 18 * 60;
export const MIN_FREE_SLOT_MIN = 30;

export interface Positioned {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  column: number;
  columns: number;
}

export interface Interval {
  startMin: number;
  endMin: number;
}

const utcDate = (iso: string): Civil | null => parseCivilKey(iso.slice(0, 10));

/** All-day events cover UTC calendar dates `[start, end)` (their instants carry no wall-clock meaning). */
export function isAllDay(event: CalendarEvent): boolean {
  return event.allDay;
}

/** True when an all-day event covers `civil`. */
export function allDayCovers(event: CalendarEvent, civil: Civil): boolean {
  const start = utcDate(event.start);
  if (!start) return false;
  const end = utcDate(event.end);
  const key = civilKey(civil);
  const last = end && civilKey(end) > civilKey(start) ? civilKey(addDays(end, -1)) : civilKey(start);
  return key >= civilKey(start) && key <= last;
}

/** Minute range of a timed event clipped to the local day `civil` (null if it does not touch the day). */
export function clipToDay(event: CalendarEvent, civil: Civil, timeZone?: string): Interval | null {
  const dayStart = instantOf(civil, 0, timeZone).getTime();
  const dayEnd = instantOf(addDays(civil, 1), 0, timeZone).getTime();
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= dayStart || start >= dayEnd) return null;
  const startMin = Math.max(0, Math.round((Math.max(start, dayStart) - dayStart) / 60_000));
  const endMin = Math.min(24 * 60, Math.max(startMin + 15, Math.round((Math.min(end, dayEnd) - dayStart) / 60_000)));
  return { startMin, endMin };
}

/** Events visible on one local day: timed ones positioned in side-by-side columns, all-day ones separate. */
export function layoutDay(events: readonly CalendarEvent[], civil: Civil, timeZone?: string): { timed: Positioned[]; allDay: CalendarEvent[] } {
  const allDay = events.filter((event) => event.allDay && allDayCovers(event, civil));
  const items = events
    .filter((event) => !event.allDay)
    .map((event) => ({ event, range: clipToDay(event, civil, timeZone) }))
    .filter((item): item is { event: CalendarEvent; range: Interval } => item.range !== null)
    .sort((a, b) => a.range.startMin - b.range.startMin || b.range.endMin - a.range.endMin || a.event.id.localeCompare(b.event.id));

  const positioned: Positioned[] = [];
  let cluster: Positioned[] = [];
  let clusterEnd = -1;
  const flush = (): void => {
    const columns = cluster.reduce((max, item) => Math.max(max, item.column + 1), 1);
    for (const item of cluster) item.columns = columns;
    positioned.push(...cluster);
    cluster = [];
  };
  const columnEnds: number[] = [];
  for (const { event, range } of items) {
    if (cluster.length > 0 && range.startMin >= clusterEnd) {
      flush();
      columnEnds.length = 0;
    }
    let column = columnEnds.findIndex((end) => end <= range.startMin);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = range.endMin;
    cluster.push({ event, startMin: range.startMin, endMin: range.endMin, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, range.endMin);
  }
  if (cluster.length > 0) flush();
  return { timed: positioned, allDay };
}

/** Free gaps inside working hours (PLAN §34.2 "freie Zeit"): cancelled and all-day events do not block. */
export function freeSlots(events: readonly CalendarEvent[], civil: Civil, timeZone?: string, minLength = MIN_FREE_SLOT_MIN): Interval[] {
  const busy = events
    .filter((event) => !event.allDay && event.status !== "cancelled")
    .map((event) => clipToDay(event, civil, timeZone))
    .filter((range): range is Interval => range !== null)
    .map((range) => ({ startMin: Math.max(range.startMin, WORK_START_MIN), endMin: Math.min(range.endMin, WORK_END_MIN) }))
    .filter((range) => range.endMin > range.startMin)
    .sort((a, b) => a.startMin - b.startMin);
  const slots: Interval[] = [];
  let cursor = WORK_START_MIN;
  for (const range of busy) {
    if (range.startMin - cursor >= minLength) slots.push({ startMin: cursor, endMin: range.startMin });
    cursor = Math.max(cursor, range.endMin);
  }
  if (WORK_END_MIN - cursor >= minLength) slots.push({ startMin: cursor, endMin: WORK_END_MIN });
  return slots;
}

/** Events of one local day for agenda/month lists, in start order (all-day first). */
export function eventsOnDay(events: readonly CalendarEvent[], civil: Civil, timeZone?: string): CalendarEvent[] {
  const result = events.filter((event) => (event.allDay ? allDayCovers(event, civil) : clipToDay(event, civil, timeZone) !== null));
  return result.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}
