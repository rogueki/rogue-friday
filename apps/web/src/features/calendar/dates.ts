/**
 * Calendar-day arithmetic in an explicit IANA time zone without a date library (PLAN §34.2 "Zeitzone").
 * A "civil" date is a wall-calendar day (year, month, day); instants are UTC `Date`s as on the wire (PLAN §8.2).
 */
export interface Civil {
  y: number;
  /** 1..12 */
  m: number;
  d: number;
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

export const civilKey = (civil: Civil): string => `${pad(civil.y, 4)}-${pad(civil.m)}-${pad(civil.d)}`;

export function parseCivilKey(value: string | null | undefined): Civil | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const civil = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  const check = new Date(Date.UTC(civil.y, civil.m - 1, civil.d));
  return check.getUTCFullYear() === civil.y && check.getUTCMonth() === civil.m - 1 && check.getUTCDate() === civil.d ? civil : null;
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (local = UTC + offset). Without a zone: the browser's zone. */
export function tzOffsetMinutes(instant: Date, timeZone?: string): number {
  if (!timeZone) return -instant.getTimezoneOffset();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The calendar day an instant falls on in `timeZone`. */
export function civilOf(instant: Date, timeZone?: string): Civil {
  const local = new Date(instant.getTime() + tzOffsetMinutes(instant, timeZone) * 60_000);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
}

/** Minutes since local midnight of an instant in `timeZone`. */
export function minutesOfDay(instant: Date, timeZone?: string): number {
  const local = new Date(instant.getTime() + tzOffsetMinutes(instant, timeZone) * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** The UTC instant of a local wall-clock time (`minutes` after midnight of `civil`) in `timeZone`; DST gaps resolve forward. */
export function instantOf(civil: Civil, minutes: number, timeZone?: string): Date {
  const guess = Date.UTC(civil.y, civil.m - 1, civil.d, 0, minutes);
  const first = tzOffsetMinutes(new Date(guess), timeZone);
  const candidate = guess - first * 60_000;
  const second = tzOffsetMinutes(new Date(candidate), timeZone);
  return new Date(second === first ? candidate : guess - second * 60_000);
}

export function addDays(civil: Civil, days: number): Civil {
  const date = new Date(Date.UTC(civil.y, civil.m - 1, civil.d + days));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

export function addMonths(civil: Civil, months: number): Civil {
  const date = new Date(Date.UTC(civil.y, civil.m - 1 + months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: Math.min(civil.d, last) };
}

/** 0 = Monday … 6 = Sunday (ISO week). */
export function weekdayIndex(civil: Civil): number {
  return (new Date(Date.UTC(civil.y, civil.m - 1, civil.d)).getUTCDay() + 6) % 7;
}

export const startOfWeek = (civil: Civil): Civil => addDays(civil, -weekdayIndex(civil));
export const sameDay = (a: Civil, b: Civil): boolean => a.y === b.y && a.m === b.m && a.d === b.d;
export const compareCivil = (a: Civil, b: Civil): number => civilKey(a).localeCompare(civilKey(b));

/** 42 days (6 weeks, Monday first) that cover the month of `civil`. */
export function monthGrid(civil: Civil): Civil[] {
  const first = { y: civil.y, m: civil.m, d: 1 };
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/** `[from, to)` instants of the local days `first` … `first + days`. */
export function rangeOfDays(first: Civil, days: number, timeZone?: string): { from: Date; to: Date } {
  return { from: instantOf(first, 0, timeZone), to: instantOf(addDays(first, days), 0, timeZone) };
}

/** ISO week number (1..53) of a civil date. */
export function isoWeek(civil: Civil): number {
  const date = new Date(Date.UTC(civil.y, civil.m - 1, civil.d));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** `HH:mm` of a minute-of-day value. */
export const clock = (minutes: number): string => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** Value for `<input type="datetime-local">` of an instant in `timeZone`. */
export function toLocalInput(instant: Date, timeZone?: string): string {
  const civil = civilOf(instant, timeZone);
  return `${civilKey(civil)}T${clock(minutesOfDay(instant, timeZone))}`;
}

/** Instant of a `datetime-local` value interpreted in `timeZone`; null when malformed. */
export function fromLocalInput(value: string, timeZone?: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const civil = parseCivilKey(match?.[1]);
  if (!match || !civil) return null;
  return instantOf(civil, Number(match[2]) * 60 + Number(match[3]), timeZone);
}
