export interface LoginRateLimiterOptions {
  /** Failed attempts per username+IP inside the window before lockout. Default 5. */
  maxAttempts?: number;
  /** Failed attempts per IP (any username) inside the window, against password spraying. Default 20. */
  maxAttemptsPerIp?: number;
  /** Sliding window length. Default 15 minutes. */
  windowMs?: number;
  now?: () => number;
  /** Upper bound of tracked keys; oldest are evicted. Default 10 000. */
  maxKeys?: number;
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

/** Sliding-window login throttle. Failures are timestamps; the lock lifts when old ones age out. */
export class LoginRateLimiter {
  private readonly maxAttempts: number;
  private readonly maxAttemptsPerIp: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;
  private readonly byUserIp = new Map<string, number[]>();
  private readonly byIp = new Map<string, number[]>();

  constructor(options: LoginRateLimiterOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.maxAttemptsPerIp = options.maxAttemptsPerIp ?? 20;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  /** Call before verifying credentials. A locked key must not even reach the password check. */
  check(username: string, ip: string): RateLimitDecision {
    const now = this.now();
    const userIp = this.retryAfter(this.byUserIp, userKey(username, ip), this.maxAttempts, now);
    const perIp = this.retryAfter(this.byIp, ip, this.maxAttemptsPerIp, now);
    const retryAfterMs = Math.max(userIp, perIp);
    return retryAfterMs > 0 ? { allowed: false, retryAfterMs } : { allowed: true };
  }

  recordFailure(username: string, ip: string): void {
    const now = this.now();
    this.push(this.byUserIp, userKey(username, ip), now);
    this.push(this.byIp, ip, now);
  }

  /** A successful login clears the username+IP counter (the per-IP counter keeps ageing out on its own). */
  recordSuccess(username: string, ip: string): void {
    this.byUserIp.delete(userKey(username, ip));
  }

  private retryAfter(map: Map<string, number[]>, key: string, max: number, now: number): number {
    const stamps = this.prune(map, key, now);
    if (stamps.length < max) return 0;
    // The lock lifts when enough old failures slide out of the window to get below the limit.
    const releasing = stamps[stamps.length - max] ?? now;
    return Math.max(1, releasing + this.windowMs - now);
  }

  private prune(map: Map<string, number[]>, key: string, now: number): number[] {
    const stamps = map.get(key);
    if (!stamps) return [];
    const cutoff = now - this.windowMs;
    const fresh = stamps.filter((t) => t > cutoff);
    if (fresh.length === 0) map.delete(key);
    else if (fresh.length !== stamps.length) map.set(key, fresh);
    return fresh;
  }

  private push(map: Map<string, number[]>, key: string, now: number): void {
    const stamps = this.prune(map, key, now);
    stamps.push(now);
    // Re-insert to keep Map iteration order = recency, then evict from the front.
    map.delete(key);
    map.set(key, stamps);
    while (map.size > this.maxKeys) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
}

function userKey(username: string, ip: string): string {
  return `${username.trim().toLowerCase()}\u0000${ip}`;
}
