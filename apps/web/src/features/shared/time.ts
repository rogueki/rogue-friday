export interface TimeFormatOptions {
  locale: string;
  timeZone?: string;
  hour12?: boolean;
}

export type DateFormatPattern = "dd.MM.yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy";

export function formatDatePattern(date: Date, pattern: DateFormatPattern, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(date);
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = value.year ?? String(date.getFullYear());
  const month = value.month ?? String(date.getMonth() + 1).padStart(2, "0");
  const day = value.day ?? String(date.getDate()).padStart(2, "0");
  if (pattern === "yyyy-MM-dd") return `${year}-${month}-${day}`;
  return pattern === "MM/dd/yyyy" ? `${month}/${day}/${year}` : `${day}.${month}.${year}`;
}

export function formatDateTimePattern(date: Date, pattern: DateFormatPattern, options: TimeFormatOptions): string {
  const dateText = formatDatePattern(date, pattern, options.timeZone);
  const timeText = new Intl.DateTimeFormat(options.locale, { hour: "2-digit", minute: "2-digit", hour12: options.hour12, timeZone: options.timeZone }).format(date);
  return `${dateText}, ${timeText}`;
}

export function formatClockTime(iso: string | null | undefined, { locale, timeZone, hour12 }: TimeFormatOptions): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12, timeZone }).format(date);
}

const dayKey = (date: Date, timeZone: string | undefined, locale: string): string =>
  new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);

export function isSameDay(a: Date, b: Date, options: Pick<TimeFormatOptions, "locale" | "timeZone">): boolean {
  return dayKey(a, options.timeZone, options.locale) === dayKey(b, options.timeZone, options.locale);
}

/** "in 42 Min.", "vor 2 Sek.", "jetzt" in the UI locale. */
export function formatRelative(target: Date | number, now: Date | number, locale: string): string {
  const diffSeconds = Math.round((new Date(target).getTime() - new Date(now).getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (abs < 5) return rtf.format(0, "second");
  if (abs < 60) return rtf.format(diffSeconds, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  return rtf.format(Math.round(diffSeconds / 86_400), "day");
}

/** Compact duration for upcoming items: "42 Min.", "2 Std. 42 Min.". */
export function formatDuration(ms: number, labels: { minutes: string; hours: string }): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} ${labels.minutes}`;
  return minutes === 0 ? `${hours} ${labels.hours}` : `${hours} ${labels.hours} ${minutes} ${labels.minutes}`;
}
