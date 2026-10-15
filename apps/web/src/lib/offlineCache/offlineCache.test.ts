import { CONTRACT_VERSION, FridayApiError, type SessionResponse } from "@friday/sdk";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../api/queryKeys";
import { clearOfflineCache, getRestoredIdentity, isUnreachable, resetOfflineCacheState, restoreOfflineCache, startOfflineCache } from "./controller";
import { containsForbiddenProperty, isPersistableKey } from "./policy";
import { buildSnapshot, FORMAT_VERSION, markOfflineCache, MAX_AGE_MS, parseSnapshot, restoreSnapshot, type PersistedCache } from "./snapshot";
import { readStored, STORAGE_KEY, writeStored } from "./storage";

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const identity = { userId: "usr_01HZZZZZZZZZZZZZZZZZZZZZZZ", role: "owner", displayName: "Erik Brandt" };
const envelope = (value: unknown) => ({ contractVersion: CONTRACT_VERSION, data: value, freshness: { state: "fresh", asOf: "2026-10-15T11:59:00.000Z" } });
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

function sessionResponse(userId: string, role = "owner"): SessionResponse {
  return {
    contractVersion: CONTRACT_VERSION,
    data: { authenticated: true, user: { id: userId, displayName: "Erik Brandt", role }, role, csrfToken: "csrf-secret-value", expiresAt: null, reauthUntil: null },
    freshness: { state: "fresh", asOf: new Date(NOW).toISOString() },
  } as unknown as SessionResponse;
}

beforeEach(() => {
  window.localStorage.clear();
  resetOfflineCacheState();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("policy", () => {
  it("allows operational read data", () => {
    for (const key of [["overview"], ["tasks", "list", {}], ["tasks", "detail", "task_1"], ["system", "metrics"], ["voice", "status"], ["settings"], ["settings", "themes"], ["meta"], ["capabilities"]]) {
      expect(isPersistableKey(key), JSON.stringify(key)).toBe(true);
    }
  });

  it("never persists session, approval tokens, audit, mail, memory, files, commands, adapter data or dev tools", () => {
    for (const key of [
      queryKeys.session,
      queryKeys.approvals.token("appr_1"),
      queryKeys.audit.list(),
      queryKeys.communication.threads.list(),
      queryKeys.communication.channels,
      queryKeys.memory.list(),
      queryKeys.files.list(),
      queryKeys.commands.history,
      queryKeys.adapters.logs("a"),
      queryKeys.settings.adapters,
      queryKeys.voice.enrollment("e"),
      queryKeys.dev.scenarios,
      ["unknown-root"],
      [],
    ]) {
      expect(isPersistableKey(key), JSON.stringify(key)).toBe(false);
    }
  });

  it("detects credential-looking properties deeply but allows harmless counters", () => {
    expect(containsForbiddenProperty({ a: { b: [{ csrfToken: "x" }] } })).toBe(true);
    expect(containsForbiddenProperty({ approvalToken: "x" })).toBe(true);
    expect(containsForbiddenProperty({ items: [{ password: "x" }] })).toBe(true);
    expect(containsForbiddenProperty({ Authorization: "Bearer x" })).toBe(true);
    expect(containsForbiddenProperty({ tokens: 12, inputTokens: 3, nextToken: null, title: "Token Economy" })).toBe(false);
    expect(containsForbiddenProperty({ items: [{ id: "task_1", title: "Bericht" }] })).toBe(false);
  });
});

describe("snapshot", () => {
  it("round-trips and marks every envelope as offline-cache with its real age", () => {
    const source = newClient();
    source.setQueryData(queryKeys.overview, envelope({ x: 1 }), { updatedAt: NOW - 120_000 });
    const snapshot = buildSnapshot(source, identity, { contractVersion: CONTRACT_VERSION, now: NOW });
    const parsed = parseSnapshot(JSON.stringify(snapshot), { contractVersion: CONTRACT_VERSION, now: NOW });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const target = newClient();
    expect(restoreSnapshot(target, parsed.cache)).toBe(1);
    const restored = target.getQueryData(queryKeys.overview) as ReturnType<typeof envelope>;
    expect(restored.freshness.state).toBe("offline-cache");
    expect(restored.freshness.asOf).toBe(new Date(NOW - 120_000).toISOString());
    expect(target.getQueryState(queryKeys.overview)?.dataUpdatedAt).toBe(NOW - 120_000);
  });

  it("skips disallowed queries and payloads with credentials", () => {
    const client = newClient();
    client.setQueryData(queryKeys.overview, envelope({ ok: true }));
    client.setQueryData(queryKeys.session, sessionResponse(identity.userId));
    client.setQueryData(queryKeys.approvals.token("appr_1"), "tok");
    client.setQueryData(queryKeys.tasks.list(), envelope({ leaked: { apiKey: "sk-123" } }));
    const snapshot = buildSnapshot(client, identity, { contractVersion: CONTRACT_VERSION, now: NOW });
    expect(snapshot.queries.map((entry) => entry.key[0])).toEqual(["overview"]);
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain("csrf-secret-value");
    expect(text).not.toContain("sk-123");
  });

  it("does not persist queries that failed or have no data", () => {
    const client = newClient();
    client.getQueryCache().build(client, { queryKey: queryKeys.status });
    expect(buildSnapshot(client, identity, { contractVersion: CONTRACT_VERSION, now: NOW }).queries).toEqual([]);
  });

  it("enforces the entry and total size caps, keeping the high-priority queries", () => {
    const client = newClient();
    const big = "x".repeat(300);
    client.setQueryData(queryKeys.tasks.list({ page: 1 }), envelope({ big }));
    client.setQueryData(queryKeys.tasks.list({ page: 2 }), envelope({ big }));
    client.setQueryData(queryKeys.overview, envelope({ small: 1 }));
    client.setQueryData(queryKeys.meta, envelope({ small: 2 }));
    client.setQueryData(queryKeys.activity.list(), envelope({ huge: "y".repeat(5_000) }));
    const snapshot = buildSnapshot(client, identity, { contractVersion: CONTRACT_VERSION, now: NOW, maxTotalChars: 800, maxEntryChars: 1_000 });
    const roots = snapshot.queries.map((entry) => entry.key[0]);
    expect(roots).toContain("meta");
    expect(roots).toContain("overview");
    expect(roots).not.toContain("activity"); // above the per-entry cap
    expect(JSON.stringify(snapshot.queries.map((entry) => entry.data)).length).toBeLessThanOrEqual(800);
  });

  it("rejects corrupt, foreign-format, other-contract and expired snapshots", () => {
    const opts = { contractVersion: CONTRACT_VERSION, now: NOW };
    const valid: PersistedCache = { format: FORMAT_VERSION, contractVersion: CONTRACT_VERSION, identity, savedAt: NOW - 1000, queries: [] };
    expect(parseSnapshot(null, opts)).toEqual({ ok: false, reason: "empty" });
    expect(parseSnapshot("{not json", opts)).toEqual({ ok: false, reason: "corrupt" });
    expect(parseSnapshot(JSON.stringify({ ...valid, format: 99 }), opts)).toEqual({ ok: false, reason: "format" });
    expect(parseSnapshot(JSON.stringify({ ...valid, contractVersion: "0.9.0" }), opts)).toEqual({ ok: false, reason: "contract" });
    expect(parseSnapshot(JSON.stringify({ ...valid, identity: { userId: 1 } }), opts)).toEqual({ ok: false, reason: "corrupt" });
    expect(parseSnapshot(JSON.stringify({ ...valid, savedAt: NOW - MAX_AGE_MS - 1 }), opts)).toEqual({ ok: false, reason: "expired" });
    expect(parseSnapshot(JSON.stringify(valid), opts).ok).toBe(true);
  });

  it("drops smuggled entries on read: forbidden keys, credentials in data, too old", () => {
    const entries = [
      { key: ["auth", "session"], data: { csrfToken: "x" }, updatedAt: NOW },
      { key: ["tasks", "list"], data: { password: "x" }, updatedAt: NOW },
      { key: ["status"], data: envelope({}), updatedAt: NOW - MAX_AGE_MS - 5 },
      { key: ["status"], data: envelope({ ok: 1 }), updatedAt: NOW },
    ];
    const raw = JSON.stringify({ format: FORMAT_VERSION, contractVersion: CONTRACT_VERSION, identity, savedAt: NOW, queries: entries });
    const parsed = parseSnapshot(raw, { contractVersion: CONTRACT_VERSION, now: NOW });
    expect(parsed.ok && parsed.cache.queries.length).toBe(1);
  });

  it("markOfflineCache leaves non-envelopes alone", () => {
    expect(markOfflineCache("text", NOW)).toBe("text");
    expect(markOfflineCache({ a: 1 }, NOW)).toEqual({ a: 1 });
  });
});

describe("controller", () => {
  it("writes the snapshot only after a live session and debounces writes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const client = newClient();
    const controller = startOfflineCache(client, { delayMs: 1000, now: () => Date.now() });
    client.setQueryData(queryKeys.overview, envelope({ x: 1 }));
    vi.advanceTimersByTime(5_000);
    expect(readStored()).toBeNull(); // no session yet: the owner of the data is unknown

    client.setQueryData(queryKeys.session, sessionResponse(identity.userId));
    client.setQueryData(queryKeys.status, envelope({ y: 1 }));
    client.setQueryData(queryKeys.health, envelope({ z: 1 }));
    expect(readStored()).toBeNull(); // debounced
    vi.advanceTimersByTime(1_000);
    const stored = JSON.parse(readStored() ?? "null") as PersistedCache;
    expect(stored.identity.userId).toBe(identity.userId);
    expect(stored.queries.map((entry) => entry.key[0]).sort()).toEqual(["health", "overview", "status"]);
    expect(readStored()).not.toContain("csrf-secret-value");
    controller.dispose();
  });

  it("restores into a fresh client, exposes the identity and hands over when the user matches", () => {
    const first = newClient();
    writeStored(JSON.stringify(buildSnapshot((() => { first.setQueryData(queryKeys.overview, envelope({ x: 1 })); return first; })(), identity, { contractVersion: CONTRACT_VERSION, now: Date.now() })));
    resetOfflineCacheState();
    const client = newClient();
    expect(restoreOfflineCache(client)).toBe(1);
    expect(getRestoredIdentity()?.identity).toEqual(identity);
    const controller = startOfflineCache(client, { delayMs: 10 });
    client.setQueryData(queryKeys.session, sessionResponse(identity.userId));
    expect(getRestoredIdentity()).toBeNull();
    expect(client.getQueryData(queryKeys.overview)).toBeDefined();
    controller.dispose();
  });

  it("wipes the stored data and the restored queries when a different user logs in", () => {
    const first = newClient();
    first.setQueryData(queryKeys.overview, envelope({ x: 1 }));
    writeStored(JSON.stringify(buildSnapshot(first, identity, { contractVersion: CONTRACT_VERSION, now: Date.now() })));
    const client = newClient();
    restoreOfflineCache(client);
    const controller = startOfflineCache(client, { delayMs: 10 });
    client.setQueryData(queryKeys.session, sessionResponse("usr_01HYYYYYYYYYYYYYYYYYYYYYYY", "viewer"));
    expect(client.getQueryData(queryKeys.overview)).toBeUndefined();
    expect(readStored()).toBeNull();
    controller.dispose();
  });

  it("wipes everything when the session answers unauthenticated or is rejected", () => {
    const first = newClient();
    first.setQueryData(queryKeys.overview, envelope({ x: 1 }));
    writeStored(JSON.stringify(buildSnapshot(first, identity, { contractVersion: CONTRACT_VERSION, now: Date.now() })));
    const client = newClient();
    restoreOfflineCache(client);
    const controller = startOfflineCache(client, { delayMs: 10 });
    const unauthenticated = sessionResponse(identity.userId);
    (unauthenticated.data as { authenticated: boolean }).authenticated = false;
    client.setQueryData(queryKeys.session, unauthenticated);
    expect(readStored()).toBeNull();
    expect(client.getQueryData(queryKeys.overview)).toBeUndefined();
    controller.dispose();
  });

  it("keeps the cache and the identity while the API is unreachable, and refetches on recovery", async () => {
    const first = newClient();
    first.setQueryData(queryKeys.overview, envelope({ x: 1 }));
    writeStored(JSON.stringify(buildSnapshot(first, identity, { contractVersion: CONTRACT_VERSION, now: Date.now() })));
    const client = newClient();
    restoreOfflineCache(client);
    const onRecovered = vi.fn();
    const controller = startOfflineCache(client, { delayMs: 10, onRecovered });
    await client.fetchQuery({ queryKey: queryKeys.session, queryFn: () => Promise.reject(new TypeError("Failed to fetch")) }).catch(() => undefined);
    expect(getRestoredIdentity()?.identity.userId).toBe(identity.userId);
    expect(readStored()).not.toBeNull();
    expect(onRecovered).not.toHaveBeenCalled();
    client.setQueryData(queryKeys.session, sessionResponse(identity.userId));
    expect(onRecovered).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("a 401 while restoring clears the cache (no offline access for a rejected session)", async () => {
    const first = newClient();
    first.setQueryData(queryKeys.overview, envelope({ x: 1 }));
    writeStored(JSON.stringify(buildSnapshot(first, identity, { contractVersion: CONTRACT_VERSION, now: Date.now() })));
    const client = newClient();
    restoreOfflineCache(client);
    const controller = startOfflineCache(client, { delayMs: 10 });
    const denied = new FridayApiError({ code: "UNAUTHENTICATED", message: "x", severity: "error", retryable: false, correlationId: "corr_00000000000000000000000000" }, 401);
    await client.fetchQuery({ queryKey: queryKeys.session, queryFn: () => Promise.reject(denied) }).catch(() => undefined);
    expect(readStored()).toBeNull();
    expect(getRestoredIdentity()).toBeNull();
    expect(client.getQueryData(queryKeys.overview)).toBeUndefined();
    controller.dispose();
  });

  it("clearOfflineCache (logout) removes the storage entry", () => {
    writeStored("x");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("x");
    clearOfflineCache();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("survives unusable storage: no throw, no cache", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(restoreOfflineCache(newClient())).toBe(0);
    expect(writeStored("x")).toBe(false);
    expect(readStored()).toBeNull();
  });

  it("discards a snapshot of another contract version", () => {
    const first = newClient();
    first.setQueryData(queryKeys.overview, envelope({ x: 1 }));
    writeStored(JSON.stringify(buildSnapshot(first, identity, { contractVersion: "0.0.1", now: Date.now() })));
    expect(restoreOfflineCache(newClient())).toBe(0);
    expect(readStored()).toBeNull();
  });
});

describe("isUnreachable", () => {
  const apiError = (status: number) => new FridayApiError({ code: "INTERNAL", message: "x", severity: "error", retryable: false, correlationId: "corr_00000000000000000000000000" }, status);
  it("treats network failures and gateway errors as unreachable, never 4xx", () => {
    expect(isUnreachable(new TypeError("Failed to fetch"))).toBe(true);
    expect(isUnreachable(apiError(502))).toBe(true);
    expect(isUnreachable(apiError(401))).toBe(false);
    expect(isUnreachable(apiError(403))).toBe(false);
    expect(isUnreachable(apiError(429))).toBe(false);
  });
});
