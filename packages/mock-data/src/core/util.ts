import type { PageInfo } from "@friday/sdk";
import { validationFailed } from "./errors";

export type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | null | undefined;

export const clone = <T>(value: T): T => structuredClone(value);

/** Normalizes `a=1&a=2`, `a=1,2` and arrays to a string list. */
export function asList(value: QueryValue): string[] {
  if (value === undefined || value === null || value === "") return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter(Boolean);
}

export function asBool(value: QueryValue): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const text = String(value).toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  throw validationFailed(`Ungültiger Boolean-Wert: ${text}`);
}

export function asIso(value: QueryValue, name: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const ms = Date.parse(String(value));
  if (Number.isNaN(ms)) throw validationFailed(`Parameter ${name} ist kein gültiger Zeitstempel.`, [{ path: name, message: "date-time erwartet" }]);
  return ms;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface PageQuery {
  cursor?: string | undefined;
  limit?: number | string | undefined;
}

export interface Page<T> {
  items: T[];
  pageInfo: PageInfo;
}

function encodeCursor(offset: number): string {
  return `c${offset.toString(36)}`;
}

function decodeCursor(cursor: string): number {
  if (!/^c[0-9a-z]+$/.test(cursor)) throw validationFailed("Ungültiger Cursor.", [{ path: "cursor", message: "unbekanntes Format" }]);
  return parseInt(cursor.slice(1), 36);
}

/** Cursor pagination over an already filtered and sorted list. */
export function paginate<T>(items: readonly T[], query: PageQuery = {}): Page<T> {
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined && query.limit !== "") {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw validationFailed(`limit muss zwischen 1 und ${MAX_LIMIT} liegen.`, [{ path: "limit", message: "1..200" }]);
    }
  }
  const offset = query.cursor ? decodeCursor(query.cursor) : 0;
  const slice = items.slice(offset, offset + limit);
  const end = offset + slice.length;
  const hasNextPage = end < items.length;
  return {
    items: slice,
    pageInfo: { nextCursor: hasNextPage ? encodeCursor(end) : null, hasNextPage, totalCount: items.length },
  };
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
export const priorityRank = (priority: string): number => PRIORITY_RANK[priority] ?? 9;

/** Lower-case, strips diacritics and maps ß/ä/ö/ü so "Büro" matches "buero" and "buro". */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/** Full-text match: every query token must occur in the haystack (substring match on normalized text). */
export function matchesQuery(haystack: string, query: string | undefined): boolean {
  if (!query) return true;
  const text = normalizeText(haystack);
  return tokenize(query).every((token) => text.includes(token));
}

export function compareDesc(a: string | number, b: string | number): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

export function compareAsc(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable JSON with sorted keys; used for idempotency fingerprints and the audit hash chain. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function minutes(count: number): number {
  return count * 60_000;
}
export function hours(count: number): number {
  return count * 3_600_000;
}
export function days(count: number): number {
  return count * 86_400_000;
}
