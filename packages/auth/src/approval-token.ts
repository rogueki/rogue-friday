import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const DEFAULT_APPROVAL_TOKEN_TTL_MS = 120_000;

export interface ApprovalClaims {
  approvalId: string;
  userId: string;
  /** What the token authorises, e.g. `approvals.approve`. */
  action: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export type ApprovalTokenFailure = 'malformed' | 'bad_signature' | 'expired' | 'mismatch' | 'replayed';
export type ApprovalTokenResult = { ok: true; claims: ApprovalClaims } | { ok: false; reason: ApprovalTokenFailure };

/** Remembers consumed nonces until the token would have expired anyway. */
export interface NonceStore {
  /** Returns true when the nonce was unused (and is now burnt), false on replay. Must be atomic. */
  consume(nonce: string, expiresAt: number): boolean;
}

export class InMemoryNonceStore implements NonceStore {
  private readonly used = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  consume(nonce: string, expiresAt: number): boolean {
    this.purge();
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, expiresAt);
    return true;
  }

  private purge(): void {
    const now = this.now();
    for (const [nonce, expiresAt] of this.used) if (expiresAt <= now) this.used.delete(nonce);
  }
}

/** Survives restarts so a token cannot be replayed within its TTL after a crash/redeploy. */
export class SqliteNonceStore implements NonceStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS auth_approval_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`);
  }

  consume(nonce: string, expiresAt: number): boolean {
    this.db.prepare('DELETE FROM auth_approval_nonces WHERE expires_at <= ?').run(this.now());
    // PRIMARY KEY makes the insert the atomic "first use wins" check.
    const result = this.db.prepare('INSERT OR IGNORE INTO auth_approval_nonces (nonce, expires_at) VALUES (?, ?)').run(nonce, expiresAt);
    return Number(result.changes) === 1;
  }
}

export interface ApprovalTokenServiceOptions {
  /** Key dedicated to approval tokens, see `deriveKey(master, 'approval')`. */
  key: Buffer;
  ttlMs?: number;
  nonceStore?: NonceStore;
  now?: () => number;
}

export interface ApprovalBinding {
  approvalId: string;
  userId: string;
  action: string;
}

interface WirePayload {
  v: 1;
  aid: string;
  uid: string;
  act: string;
  n: string;
  iat: number;
  exp: number;
}

/**
 * Short-lived, single-use approval tokens (PLAN §32.5). The token binds approval id, user, action and a
 * random nonce; it is HMAC-signed and burns its nonce on first successful use. The caller still re-checks
 * the approval state and the user's permissions at execution time.
 */
export class ApprovalTokenService {
  private readonly ttlMs: number;
  private readonly nonceStore: NonceStore;
  private readonly now: () => number;

  constructor(private readonly options: ApprovalTokenServiceOptions) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_APPROVAL_TOKEN_TTL_MS;
    this.nonceStore = options.nonceStore ?? new InMemoryNonceStore(this.now);
  }

  issue(binding: ApprovalBinding): { token: string; claims: ApprovalClaims } {
    const issuedAt = this.now();
    const claims: ApprovalClaims = {
      ...binding,
      nonce: randomBytes(16).toString('base64url'),
      issuedAt,
      expiresAt: issuedAt + this.ttlMs,
    };
    const payload: WirePayload = { v: 1, aid: claims.approvalId, uid: claims.userId, act: claims.action, n: claims.nonce, iat: claims.issuedAt, exp: claims.expiresAt };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return { token: `${body}.${this.sign(body)}`, claims };
  }

  /** Checks signature, expiry and binding without burning the nonce. */
  inspect(token: string, expected: ApprovalBinding): ApprovalTokenResult {
    const parsed = this.parse(token);
    if (!parsed.ok) return parsed;
    const { claims } = parsed;
    if (this.now() >= claims.expiresAt) return { ok: false, reason: 'expired' };
    if (claims.approvalId !== expected.approvalId || claims.userId !== expected.userId || claims.action !== expected.action) {
      return { ok: false, reason: 'mismatch' };
    }
    return parsed;
  }

  /** Full validation; on success the token can never be used again. */
  consume(token: string, expected: ApprovalBinding): ApprovalTokenResult {
    const result = this.inspect(token, expected);
    if (!result.ok) return result;
    if (!this.nonceStore.consume(result.claims.nonce, result.claims.expiresAt)) return { ok: false, reason: 'replayed' };
    return result;
  }

  private parse(token: string): ApprovalTokenResult {
    const parts = token.split('.');
    if (parts.length !== 2) return { ok: false, reason: 'malformed' };
    const [body, signature] = parts as [string, string];
    const expectedSignature = Buffer.from(this.sign(body));
    const actualSignature = Buffer.from(signature);
    if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
      return { ok: false, reason: 'bad_signature' };
    }
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<WirePayload>;
      if (
        payload.v !== 1 ||
        typeof payload.aid !== 'string' ||
        typeof payload.uid !== 'string' ||
        typeof payload.act !== 'string' ||
        typeof payload.n !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
      ) {
        return { ok: false, reason: 'malformed' };
      }
      return {
        ok: true,
        claims: { approvalId: payload.aid, userId: payload.uid, action: payload.act, nonce: payload.n, issuedAt: payload.iat, expiresAt: payload.exp },
      };
    } catch {
      return { ok: false, reason: 'malformed' };
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.options.key).update('approval:v1.').update(body).digest('base64url');
  }
}
