/** Pure formatting helpers shared by the group-C module pages. Missing values are rendered as "—", never as 0. */

export const MISSING = "—";

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function bcp47(locale: string): string {
  return locale === "de" ? "de-DE" : "en-GB";
}

export function formatBytes(bytes: number | null | undefined, locale = "de"): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return MISSING;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat(bcp47(locale), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)} ${UNITS[unit]}`;
}

export function formatRate(bytesPerSec: number | null | undefined, locale = "de"): string {
  const base = formatBytes(bytesPerSec, locale);
  return base === MISSING ? base : `${base}/s`;
}

export function formatMs(ms: number | null | undefined, locale = "de"): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return MISSING;
  return `${new Intl.NumberFormat(bcp47(locale), { maximumFractionDigits: ms < 10 ? 1 : 0 }).format(ms)} ms`;
}

export function formatPercent(value: number | null | undefined, locale = "de", digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  return `${new Intl.NumberFormat(bcp47(locale), { maximumFractionDigits: digits }).format(value)} %`;
}

export function formatTemperature(celsius: number | null | undefined, locale = "de"): string {
  if (celsius === null || celsius === undefined || !Number.isFinite(celsius)) return MISSING;
  return `${new Intl.NumberFormat(bcp47(locale), { maximumFractionDigits: 0 }).format(celsius)} °C`;
}

/** "1 Std. 05 Min." style runtime for research projects and tests. */
export function formatRuntime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return MISSING;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} Std. ${String(minutes).padStart(2, "0")} Min.`;
  if (minutes > 0) return `${minutes} Min. ${String(seconds).padStart(2, "0")} Sek.`;
  return `${seconds} Sek.`;
}

export function formatCurrencyEur(value: number | null | undefined, locale = "de"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  return new Intl.NumberFormat(bcp47(locale), { style: "currency", currency: "EUR" }).format(value);
}

export function formatFraction(value: number | null | undefined, locale = "de"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  return formatPercent(Math.round(value * 100), locale);
}
