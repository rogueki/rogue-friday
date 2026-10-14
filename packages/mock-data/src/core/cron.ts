// Minimal cron support for mock automations: "m h dom mon dow" with *, lists, ranges and */n.
// Only Europe/Berlin (with EU daylight saving) is zoned; every other zone is treated as UTC.

function lastSundayUtc(year: number, monthIndex: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return lastDay.getUTCDate() - lastDay.getUTCDay();
}

/** UTC offset of Europe/Berlin in minutes at the given instant. */
export function berlinOffsetMinutes(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  // EU rule: DST from last Sunday in March 01:00 UTC to last Sunday in October 01:00 UTC.
  const start = Date.UTC(year, 2, lastSundayUtc(year, 2), 1);
  const end = Date.UTC(year, 9, lastSundayUtc(year, 9), 1);
  return utcMs >= start && utcMs < end ? 120 : 60;
}

function parseField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let from = min;
    let to = max;
    if (rangePart && rangePart !== "*") {
      const [a, b] = rangePart.split("-");
      from = Number(a);
      to = b !== undefined ? Number(b) : stepPart ? max : from;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const limits: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return fields.every((field, index) => parseField(field, (limits[index] as [number, number])[0], (limits[index] as [number, number])[1]) !== null);
}

/** Next execution after `afterMs` as ISO string, or null when the expression is invalid or never fires within 14 days. */
export function nextCronRun(expression: string, afterMs: number, timeZone?: string): string | null {
  if (!isValidCron(expression)) return null;
  const [minuteField, hourField, domField, monthField, dowField] = expression.trim().split(/\s+/) as [string, string, string, string, string];
  const minutes = parseField(minuteField, 0, 59) as Set<number>;
  const hours = parseField(hourField, 0, 23) as Set<number>;
  const doms = parseField(domField, 1, 31) as Set<number>;
  const months = parseField(monthField, 1, 12) as Set<number>;
  const dows = new Set([...(parseField(dowField, 0, 7) as Set<number>)].map((value) => value % 7));
  const domRestricted = domField !== "*";
  const dowRestricted = dowField !== "*";
  const zoned = timeZone === "Europe/Berlin";

  const dayStartUtc = Date.UTC(new Date(afterMs).getUTCFullYear(), new Date(afterMs).getUTCMonth(), new Date(afterMs).getUTCDate());
  for (let dayIndex = -1; dayIndex <= 14; dayIndex++) {
    const day = new Date(dayStartUtc + dayIndex * 86_400_000);
    const month = day.getUTCMonth() + 1;
    if (!months.has(month)) continue;
    const domOk = doms.has(day.getUTCDate());
    const dowOk = dows.has(day.getUTCDay());
    const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) continue;
    for (const hour of [...hours].sort((a, b) => a - b)) {
      for (const minute of [...minutes].sort((a, b) => a - b)) {
        const localMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute);
        const utcMs = zoned ? localMs - berlinOffsetMinutes(localMs - 60 * 60_000) * 60_000 : localMs;
        if (utcMs > afterMs) return new Date(utcMs).toISOString();
      }
    }
  }
  return null;
}
