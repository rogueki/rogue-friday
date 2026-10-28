/** Wall-clock fields of an instant in a zone; throws for an unusable zone, which the caller treats as "cannot decide". */
function zonedParts(atMs: number, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(atMs);
  const value = (type: string): number => Number(parts.find((entry) => entry.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function tzOffsetMs(atMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(atMs);
  const value = (type: string): number => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second")) - atMs;
}

/** Midnight of a wall-clock date as a UTC instant, corrected once for a DST transition inside the first guess. */
function utcMidnight(year: number, month: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day);
  const shifted = guess - tzOffsetMs(guess, timeZone);
  return guess - tzOffsetMs(shifted, timeZone);
}

/**
 * Civil-day boundaries for "today" and "tomorrow" in the owner's zone. Rolling 24-hour windows are wrong across a DST
 * change, so both ends are computed as wall-clock midnights. Returns null when the zone is missing or unusable.
 */
export function localDayRange(nowMs: number, timeZone: string | undefined, dayOffset: number): { from: string; to: string } | null {
  if (!timeZone || (dayOffset !== 0 && dayOffset !== 1)) return null;
  try {
    const local = zonedParts(nowMs, timeZone);
    const startDate = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
    const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset + 1));
    const from = utcMidnight(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, startDate.getUTCDate(), timeZone);
    const to = utcMidnight(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate(), timeZone);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  } catch {
    return null;
  }
}