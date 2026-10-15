import { CONTRACT_VERSION, isJarvisApiError, type SessionResponse } from "@jarvis/sdk";
import type { Query, QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";
import { buildSnapshot, parseSnapshot, restoreSnapshot, type OfflineIdentity } from "./snapshot";
import { clearStored, readStored, writeStored } from "./storage";

const WRITE_DELAY_MS = 2_000;

/** Identity restored from the stored snapshot; set at boot, consumed by `useSession` when the API is unreachable. */
let restored: { identity: OfflineIdentity; savedAt: number } | null = null;
/** True once GET /auth/session succeeded in this page life: only then may the cache be (re)written. */
let liveUserId: string | null = null;

/** True while the last session request failed because the API is unreachable (stays true across the retries). */
let unreachableFlag = false;
const listeners = new Set<() => void>();
function setUnreachable(next: boolean): void {
  if (unreachableFlag === next) return;
  unreachableFlag = next;
  for (const listener of listeners) listener();
}
export const subscribeUnreachable = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const isApiUnreachable = (): boolean => unreachableFlag;

export function getRestoredIdentity(): { identity: OfflineIdentity; savedAt: number } | null {
  return restored;
}

/** A refused connection, a timeout or a gateway error: the API is not there. 4xx answers are never "offline". */
export function isUnreachable(error: unknown): boolean {
  if (isJarvisApiError(error)) return error.status === 0 || error.status >= 500;
  return error instanceof TypeError || (error instanceof Error && /fetch|network|load failed/i.test(error.message));
}

/** Removes the stored snapshot and forgets the restored identity (logout, 401, other user, expired session). */
export function clearOfflineCache(): void {
  clearStored();
  restored = null;
  liveUserId = null;
  setUnreachable(false);
}

/** Test seam. */
export function resetOfflineCacheState(): void {
  restored = null;
  liveUserId = null;
  setUnreachable(false);
}

/** Restores the stored snapshot into a fresh client. Safe on the server and without storage (does nothing). */
export function restoreOfflineCache(client: QueryClient, now: number = Date.now()): number {
  const parsed = parseSnapshot(readStored(), { contractVersion: CONTRACT_VERSION, now });
  if (!parsed.ok) {
    if (parsed.reason !== "empty") clearStored();
    return 0;
  }
  restored = { identity: parsed.cache.identity, savedAt: parsed.cache.savedAt };
  return restoreSnapshot(client, parsed.cache);
}

function sessionIdentity(response: SessionResponse | undefined): OfflineIdentity | null {
  const session = response?.data;
  if (!session?.authenticated || !session.user) return null;
  return { userId: session.user.id, role: session.user.role, displayName: session.user.displayName };
}

export interface Controller {
  dispose: () => void;
  /** Writes the snapshot immediately (page hide). */
  flush: () => void;
}

/**
 * Connects a QueryClient to the stored snapshot: session results decide whose data is allowed to live (other user or
 * logged out: wipe), successful queries are written back debounced, and an API that comes back triggers a refetch.
 */
export function startOfflineCache(client: QueryClient, hooks: { onRecovered?: () => void; now?: () => number; delayMs?: number } = {}): Controller {
  const now = hooks.now ?? Date.now;
  const delay = hooks.delayMs ?? WRITE_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let identity: OfflineIdentity | null = null;
  let wasUnreachable = false;

  const write = (): void => {
    timer = null;
    if (!identity || liveUserId !== identity.userId) return;
    const snapshot = buildSnapshot(client, identity, { contractVersion: CONTRACT_VERSION, now: now() });
    if (snapshot.queries.length === 0) return;
    writeStored(JSON.stringify(snapshot));
  };
  const schedule = (): void => {
    if (timer !== null || !identity || liveUserId !== identity.userId) return;
    timer = setTimeout(write, delay);
  };

  const forgetUserData = (): void => {
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.session[0] });
  };

  const onSession = (query: Query): void => {
    const state = query.state;
    if (state.status === "success") {
      const next = sessionIdentity(state.data as SessionResponse | undefined);
      if (!next) {
        // Logged out or expired while the cache was stored: nothing of the previous session may stay readable.
        if (restored) forgetUserData();
        clearOfflineCache();
        identity = null;
        return;
      }
      if (restored && restored.identity.userId !== next.userId) {
        forgetUserData();
        clearStored();
      }
      identity = next;
      liveUserId = next.userId;
      restored = null;
      setUnreachable(false);
      if (wasUnreachable) {
        wasUnreachable = false;
        hooks.onRecovered?.();
      }
      schedule();
      return;
    }
    if (state.status === "error") {
      if (isJarvisApiError(state.error) && (state.error.code === "UNAUTHENTICATED" || state.error.status === 401)) {
        if (restored) forgetUserData();
        clearOfflineCache();
        identity = null;
      } else if (isUnreachable(state.error)) {
        wasUnreachable = true;
        setUnreachable(true);
      }
    }
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    const query = event.query;
    if (query.queryKey[0] === queryKeys.session[0] && query.queryKey[1] === queryKeys.session[1]) {
      if (event.type === "updated") onSession(query);
      return;
    }
    if (event.type === "updated" && event.action.type === "success") schedule();
  });

  const onHide = (): void => {
    if (document.visibilityState === "hidden") flush();
  };
  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      write();
    }
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onHide);
  if (typeof window !== "undefined") window.addEventListener("pagehide", flush);

  return {
    flush,
    dispose: () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onHide);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", flush);
    },
  };
}
