import type { Query, QueryClient } from "@tanstack/react-query";
import { containsForbiddenProperty, isPersistableKey } from "./policy";

/** Bumped when the stored shape changes; a different value discards the stored cache. */
export const FORMAT_VERSION = 1;
/** Whole snapshot (JSON characters). localStorage allows ~5 MB per origin; stay well below. */
export const MAX_TOTAL_CHARS = 900_000;
/** One query entry; larger lists (event history, big task boards) are skipped, not truncated. */
export const MAX_ENTRY_CHARS = 200_000;
/** Older snapshots are discarded: yesterday's status is more misleading than helpful after a week. */
export const MAX_AGE_MS = 7 * 24 * 3600_000;

export interface OfflineIdentity {
  /** Owner of the data; a different user on the same browser never sees it. */
  userId: string;
  role: string;
  displayName: string;
}

export interface PersistedEntry {
  key: readonly unknown[];
  data: unknown;
  updatedAt: number;
}

export interface PersistedCache {
  format: typeof FORMAT_VERSION;
  contractVersion: string;
  identity: OfflineIdentity;
  /** When the snapshot was written; "Stand" in the offline banner. */
  savedAt: number;
  queries: PersistedEntry[];
}

/** Queries that matter most come first when the size cap forces a choice. */
const PRIORITY: readonly string[] = ["meta", "capabilities", "settings", "overview", "status", "health", "orb"];
const priorityOf = (key: readonly unknown[]): number => {
  const index = PRIORITY.indexOf(String(key[0]));
  return index === -1 ? PRIORITY.length : index;
};

function eligible(query: Query): boolean {
  return query.state.status === "success" && query.state.data !== undefined && isPersistableKey(query.queryKey);
}

export function buildSnapshot(
  client: QueryClient,
  identity: OfflineIdentity,
  options: { contractVersion: string; now: number; maxTotalChars?: number; maxEntryChars?: number },
): PersistedCache {
  const maxTotal = options.maxTotalChars ?? MAX_TOTAL_CHARS;
  const maxEntry = options.maxEntryChars ?? MAX_ENTRY_CHARS;
  const candidates = client
    .getQueryCache()
    .getAll()
    .filter(eligible)
    .sort((a, b) => priorityOf(a.queryKey) - priorityOf(b.queryKey) || b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  const queries: PersistedEntry[] = [];
  let total = 0;
  for (const query of candidates) {
    if (containsForbiddenProperty(query.state.data)) continue;
    let size: number;
    try {
      size = JSON.stringify(query.state.data).length;
    } catch {
      continue;
    }
    if (size > maxEntry || total + size > maxTotal) continue;
    total += size;
    queries.push({ key: query.queryKey, data: query.state.data, updatedAt: query.state.dataUpdatedAt });
  }
  return { format: FORMAT_VERSION, contractVersion: options.contractVersion, identity, savedAt: options.now, queries };
}

export type ParseResult = { ok: true; cache: PersistedCache } | { ok: false; reason: "empty" | "corrupt" | "format" | "contract" | "expired" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates a stored string; anything unexpected discards the whole cache instead of guessing. */
export function parseSnapshot(raw: string | null, options: { contractVersion: string; now: number; maxAgeMs?: number }): ParseResult {
  if (!raw) return { ok: false, reason: "empty" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (!isRecord(value) || value.format !== FORMAT_VERSION) return { ok: false, reason: "format" };
  if (value.contractVersion !== options.contractVersion) return { ok: false, reason: "contract" };
  const identity = value.identity;
  if (
    !isRecord(identity) ||
    typeof identity.userId !== "string" ||
    typeof identity.role !== "string" ||
    typeof identity.displayName !== "string" ||
    typeof value.savedAt !== "number" ||
    !Array.isArray(value.queries)
  ) {
    return { ok: false, reason: "corrupt" };
  }
  if (options.now - value.savedAt > (options.maxAgeMs ?? MAX_AGE_MS)) return { ok: false, reason: "expired" };
  const maxAge = options.maxAgeMs ?? MAX_AGE_MS;
  const queries: PersistedEntry[] = [];
  for (const entry of value.queries) {
    if (!isRecord(entry) || !Array.isArray(entry.key) || typeof entry.updatedAt !== "number" || entry.data === undefined) continue;
    // Defense in depth: a hand-edited or older snapshot must not smuggle in something the policy forbids.
    if (!isPersistableKey(entry.key) || containsForbiddenProperty(entry.data)) continue;
    if (options.now - entry.updatedAt > maxAge) continue;
    queries.push({ key: entry.key, data: entry.data, updatedAt: entry.updatedAt });
  }
  return {
    ok: true,
    cache: {
      format: FORMAT_VERSION,
      contractVersion: value.contractVersion as string,
      identity: { userId: identity.userId, role: identity.role, displayName: identity.displayName },
      savedAt: value.savedAt,
      queries,
    },
  };
}

/**
 * Marks a response envelope as served from the offline cache. The server's own `freshness` is replaced; `asOf` is the
 * moment the data was fetched, so the UI shows its true age. Non-envelope values are returned unchanged.
 */
export function markOfflineCache<T>(data: T, updatedAt: number): T {
  if (!isRecord(data) || !isRecord(data.freshness)) return data;
  return { ...data, freshness: { ...data.freshness, state: "offline-cache", asOf: new Date(updatedAt).toISOString() } };
}

/** Puts a parsed snapshot into the query cache; every envelope is marked `offline-cache` until a refetch replaces it. */
export function restoreSnapshot(client: QueryClient, cache: PersistedCache): number {
  for (const entry of cache.queries) {
    client.setQueryData(entry.key, markOfflineCache(entry.data, entry.updatedAt), { updatedAt: entry.updatedAt });
  }
  return cache.queries.length;
}
