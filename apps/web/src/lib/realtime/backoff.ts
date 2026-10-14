export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 15_000;
/** After this many consecutive failed connection attempts the client additionally polls snapshots (PLAN §12.1). */
export const POLLING_AFTER_FAILURES = 3;
export const POLL_INTERVAL_MS = 10_000;

/**
 * Exponential backoff with jitter. The ceiling doubles with every failed attempt (0.5 s, 1 s, 2 s, ... 15 s) and the
 * actual delay is drawn uniformly between the minimum and that ceiling, so the result always lies in [0.5 s, 15 s].
 * `random` is injectable for deterministic tests.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.min(attempt, 16));
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** exponent);
  const jittered = RECONNECT_MIN_MS + random() * (ceiling - RECONNECT_MIN_MS);
  return Math.round(Math.min(RECONNECT_MAX_MS, Math.max(RECONNECT_MIN_MS, jittered)));
}
