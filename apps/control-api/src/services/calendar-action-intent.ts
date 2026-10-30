/** Set when the sentence points at events a read command just listed: an ordinal, or null for "ihn"/"diesen". */
export interface ListedEventRef { ordinal: number | null }

export type CalendarActionIntent =
  | { kind: "calendar.create"; title: string; start: string; end: string; timeZone: string }
  | { kind: "calendar.update"; ref: string | null; start: string; listed?: ListedEventRef }
  | { kind: "calendar.delete"; ref: string | null; listed?: ListedEventRef };

const EVENT_ID = /^cal_[0-9A-Za-z]{26}$/;
const DEFAULT_DURATION_MS = 60 * 60_000;

const WEEKDAYS: Readonly<Record<string, number>> = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6,
};
const WEEKDAY_NAMES = Object.keys(WEEKDAYS).join("|");

/** Keyword matching is case- and umlaut-insensitive; extracted titles keep their original spelling. */
const squash = (value: string): string =>
  value.toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/\s+/g, " ");

/** A reference is an event id or a real title, never a bare pronoun or article. */
function validRef(value: string | undefined): string | null {
  const ref = (value ?? "").trim().replace(/^[„"']+|[“"']+$/g, "").trim();
  if (!ref || ref.length > 300) return null;
  if (EVENT_ID.test(ref)) return ref;
  return /^(?:der|die|das|dies|dieser|diese|es|ihn|sie|it|that|this)$/iu.test(ref) ? null : ref;
}

function tzOffsetMs(atMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(atMs);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour") % 24, part("minute"), part("second")) - atMs;
}

/** Wall-clock time in the given zone to a UTC instant; corrected once for a DST transition inside the guess. */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  return guess - tzOffsetMs(guess - tzOffsetMs(guess, timeZone), timeZone);
}

function localDate(nowMs: number, timeZone: string): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(nowMs);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const year = part("year"), month = part("month"), day = part("day");
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

const TIME_AT_END = /(?:^|\s)(?:um\s+)?(\d{1,2})(?::(\d{2}))?\s*uhr(?:\s+(\d{1,2}))?\s*$|(?:^|\s)(?:um\s+)?(\d{1,2}):(\d{2})\s*$/iu;
const DAY_AT_END = new RegExp(`(?:^|\\s)(?:am\\s+)?(heute|morgen|übermorgen|uebermorgen|nächste[rn]?\\s+(?:${WEEKDAY_NAMES})|naechste[rn]?\\s+(?:${WEEKDAY_NAMES})|${WEEKDAY_NAMES}|\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?)\\s*$`, "iu");

/**
 * Resolves a trailing German day+time phrase ("morgen 14 Uhr", "nächsten Dienstag 9:30", "am 24.10. um 8 Uhr")
 * against the injected clock. A phrase without a clock time is not a scheduling instruction and resolves to null.
 */
function parseWhen(text: string, nowMs: number, timeZone: string): { startMs: number; rest: string } | null {
  const timeMatch = TIME_AT_END.exec(text);
  if (!timeMatch) return null;
  const hour = Number(timeMatch[1] ?? timeMatch[4]);
  const minute = Number(timeMatch[2] ?? timeMatch[5] ?? timeMatch[3] ?? 0);
  if (hour > 24 || minute > 59) return null;
  const beforeTime = text.slice(0, timeMatch.index).trim();
  const dayMatch = DAY_AT_END.exec(beforeTime);
  if (!dayMatch) return null;
  const dayPhrase = squash(dayMatch[1]!);
  const today = localDate(nowMs, timeZone);
  let year = today.year, month = today.month, day = today.day;
  if (dayPhrase === "morgen" || dayPhrase === "uebermorgen") {
    const shifted = new Date(Date.UTC(year, month - 1, day + (dayPhrase === "morgen" ? 1 : 2)));
    year = shifted.getUTCFullYear(); month = shifted.getUTCMonth() + 1; day = shifted.getUTCDate();
  } else if (dayPhrase !== "heute") {
    const dateMatch = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(dayPhrase);
    if (dateMatch) {
      day = Number(dateMatch[1]); month = Number(dateMatch[2]);
      year = dateMatch[3] ? Number(dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]) : today.year;
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      // A bare date that already passed this year means the next occurrence.
      if (!dateMatch[3] && zonedToUtc(year, month, day, hour % 24, minute, timeZone) <= nowMs) year += 1;
    } else {
      const nextWeek = /^naechste[rn]?\s+/.test(dayPhrase);
      const weekday = WEEKDAYS[dayPhrase.replace(/^naechste[rn]?\s+/, "")];
      if (weekday === undefined) return null;
      let delta = (weekday - today.weekday + 7) % 7;
      // "nächsten <weekday>" is the occurrence of the following week cycle; a bare weekday is the next future one.
      if (nextWeek) delta += 7;
      else if (delta === 0 && zonedToUtc(year, month, day, hour % 24, minute, timeZone) <= nowMs) delta = 7;
      const shifted = new Date(Date.UTC(year, month - 1, day + delta));
      year = shifted.getUTCFullYear(); month = shifted.getUTCMonth() + 1; day = shifted.getUTCDate();
    }
  } else if (zonedToUtc(year, month, day, hour % 24, minute, timeZone) <= nowMs) {
    // "heute 8 Uhr" after that time is not schedulable without guessing a day.
    return null;
  }
  const startMs = zonedToUtc(year, month, day, hour % 24, minute, timeZone);
  return { startMs, rest: beforeTime.slice(0, dayMatch.index).trim() };
}

/** Splits "Zahnarzt morgen 14 Uhr" into the title and the resolved start; returns null when no full time is given. */
function splitTitleWhen(text: string, nowMs: number, timeZone: string): { title: string; startMs: number } | null {
  const when = parseWhen(text, nowMs, timeZone);
  if (!when) return null;
  const title = when.rest.replace(/\s+(?:am|für|fuer|um)$/iu, "").replace(/^(?:(?:einen|neuen?)\s+)*termin\s+/iu, "").trim();
  if (!title || title.length > 120) return null;
  return { title, startMs: when.startMs };
}

const CREATE_PREFIX = [
  /^(?:bitte\s+)?trag(?:e)?\s+(?:mir\s+|uns\s+)?(.+?)\s+ein$/iu,
  /^(?:bitte\s+)?plane?\s+(.+)$/iu,
  /^(?:bitte\s+)?(?:erstelle|erzeuge)\s+(?:mir\s+|uns\s+)?(?:einen\s+)?(?:neuen\s+)?termin\s+(.+)$/iu,
  /^(?:bitte\s+)?lege?\s+(?:mir\s+|uns\s+)?(?:einen\s+)?(?:neuen\s+)?termin\s+(.+?)\s+an$/iu,
  /^(?:bitte\s+)?(?:neuer|neuen)\s+termin[:\s]+(.+)$/iu,
];

const MOVE_WITH_REF = [
  /^(?:bitte\s+)?(?:verschiebe?|verlege?)\s+(?:(?:den|die|das|meinen|meine)\s+)?(?:termin|besprechung|meeting)\s+(.+?)\s+auf\s+(.+)$/iu,
];

const MOVE_SELECTED = [
  /^(?:bitte\s+)?(?:verschiebe?|verlege?)\s+(?:(?:den|die|das|meinen|meine)\s+)?(?:termin|besprechung|meeting)\s+auf\s+(.+)$/iu,
];

const DELETE_WITH_REF = [
  /^(?:bitte\s+)?(?:lösche?|loesche?|entferne?|streiche?)\s+(?:(?:den|die|das|meinen|meine)\s+)?(?:termin|besprechung|meeting)\s+(.+)$/iu,
  /^(?:bitte\s+)?sag(?:e)?\s+(?:(?:den|die|das|meinen|meine)\s+)?(?:termin|besprechung|meeting)\s+(.+?)\s+ab$/iu,
];

const DELETE_SELECTED = [
  /^(?:bitte\s+)?(?:lösche?|loesche?|entferne?|streiche?)\s+(?:(?:den|die|das|meinen|meine)\s+)?(?:termin|besprechung|meeting)$/iu,
  /^(?:bitte\s+)?sag(?:e)?\s+(?:(?:den|die|das|meinen|meine)\s+)?(?:termin|besprechung|meeting)\s+ab$/iu,
];

const ORDINALS: Readonly<Record<string, number>> = {
  erste: 0, zweite: 1, dritte: 2, vierte: 3, fuenfte: 4,
};

/** "ihn", "diesen" or "den ersten … fünften [Termin]" (Termin is masculine, so "sie"/"es" stay unmatched). */
function listedRef(value: string | undefined): ListedEventRef | null {
  const phrase = squash((value ?? "").trim());
  if (/^(?:ihn|diesen)$/u.test(phrase)) return { ordinal: null };
  const match = /^(?:den|der)\s+(erste|zweite|dritte|vierte|fuenfte)[nr]?(?:\s+(?:termin|eintrag))?$/u.exec(phrase);
  return match ? { ordinal: ORDINALS[match[1]!]! } : null;
}

const MOVE_LISTED = /^(?:bitte\s+)?(?:verschiebe?|verlege?)\s+(.+?)\s+auf\s+(.+)$/iu;
const DELETE_LISTED = [
  /^(?:bitte\s+)?(?:lösche?|loesche?|entferne?|streiche?)\s+(.+)$/iu,
  /^(?:bitte\s+)?sag(?:e)?\s+(.+?)\s+ab$/iu,
];

/**
 * Only an explicit calendar create/move/delete imperative with a resolvable time (create/move) is treated as an
 * action. The reference is an event id or an exact title; phrases without one resolve the single selected event of
 * the command context at the handler. The clock and zone are injected so resolution is deterministic.
 */
export function parseCalendarActionIntent(text: string, nowMs: number, timeZone: string): CalendarActionIntent | null {
  const trimmed = text.trim();
  for (const pattern of CREATE_PREFIX) {
    const match = pattern.exec(trimmed);
    const split = match ? splitTitleWhen(match[1]!, nowMs, timeZone) : null;
    if (split) {
      const start = new Date(split.startMs).toISOString();
      return { kind: "calendar.create", title: split.title, start,
        end: new Date(split.startMs + DEFAULT_DURATION_MS).toISOString(), timeZone };
    }
  }
  for (const pattern of MOVE_WITH_REF) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const ref = validRef(match[1]);
    const when = ref ? parseWhen(match[2]!, nowMs, timeZone) : null;
    if (ref && when && !when.rest) return { kind: "calendar.update", ref, start: new Date(when.startMs).toISOString() };
  }
  for (const pattern of MOVE_SELECTED) {
    const match = pattern.exec(trimmed);
    const when = match ? parseWhen(match[1]!, nowMs, timeZone) : null;
    if (when && !when.rest) return { kind: "calendar.update", ref: null, start: new Date(when.startMs).toISOString() };
  }
  for (const pattern of DELETE_WITH_REF) {
    const ref = validRef(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "calendar.delete", ref };
  }
  for (const pattern of DELETE_SELECTED) {
    if (pattern.test(trimmed)) return { kind: "calendar.delete", ref: null };
  }
  // Follow-ups to a listing come last, so every phrasing above keeps its meaning.
  const move = MOVE_LISTED.exec(trimmed);
  const moveRef = listedRef(move?.[1]);
  const moveWhen = move && moveRef ? parseWhen(move[2]!, nowMs, timeZone) : null;
  if (moveRef && moveWhen && !moveWhen.rest) {
    return { kind: "calendar.update", ref: null, start: new Date(moveWhen.startMs).toISOString(), listed: moveRef };
  }
  for (const pattern of DELETE_LISTED) {
    const listed = listedRef(pattern.exec(trimmed)?.[1]);
    if (listed) return { kind: "calendar.delete", ref: null, listed };
  }
  return null;
}
