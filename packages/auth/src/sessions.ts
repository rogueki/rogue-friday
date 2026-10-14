import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_REAUTH_WINDOW_MS, isReauthFresh, isRole, type Role } from './permissions';

export const SESSION_ID_BYTES = 32;
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** What the server knows about a session. The raw id only ever lives in the cookie. */
export interface Session {
  /** SHA-256 (hex) of the raw session id. Safe to log and to use as a key. */
  idHash: string;
  userId: string;
  role: Role;
  createdAt: number;
  lastSeenAt: number;
  /** Last time the user proved the password (login counts). Drives tier-3 re-auth. */
  reauthAt: number;
  expiresAt: number;
  idleTimeoutMs: number;
}

export interface CreateSessionInput {
  userId: string;
  role: Role;
  ttlMs?: number;
  idleTimeoutMs?: number;
}

export interface CreatedSession {
  /** Raw id for the `jarvis_session` cookie. Returned exactly once. */
  sessionId: string;
  session: Session;
}

export type SessionEndReason = 'expired' | 'idle' | 'revoked' | 'unknown';

export interface SessionStore {
  create(input: CreateSessionInput): CreatedSession;
  /** Validates the id; on success refreshes `lastSeenAt` (unless `touch: false`). Expired/idle sessions are deleted. */
  get(sessionId: string, options?: { touch?: boolean }): Session | null;
  /** Marks a successful password re-authentication. */
  markReauth(sessionId: string): Session | null;
  revoke(sessionId: string): boolean;
  /** "Logout all" (PLAN §49.4). Returns the number of sessions removed. */
  revokeAll(userId: string): number;
  listForUser(userId: string): Session[];
  purgeExpired(): number;
  close?(): void;
}

export interface SessionStoreOptions {
  now?: () => number;
  defaultTtlMs?: number;
  defaultIdleTimeoutMs?: number;
}

const RAW_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url');
}

export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId, 'utf8').digest('hex');
}

export function isSessionExpired(session: Session, now: number): boolean {
  return now >= session.expiresAt;
}

export function isSessionIdle(session: Session, now: number): boolean {
  return now - session.lastSeenAt >= session.idleTimeoutMs;
}

export function hasFreshReauth(session: Session, now: number, windowMs = DEFAULT_REAUTH_WINDOW_MS): boolean {
  return isReauthFresh(session.reauthAt, now, windowMs);
}

function buildSession(input: CreateSessionInput, idHash: string, now: number, opts: Required<SessionStoreOptions>): Session {
  return {
    idHash,
    userId: input.userId,
    role: input.role,
    createdAt: now,
    lastSeenAt: now,
    reauthAt: now,
    expiresAt: now + (input.ttlMs ?? opts.defaultTtlMs),
    idleTimeoutMs: input.idleTimeoutMs ?? opts.defaultIdleTimeoutMs,
  };
}

function resolveOptions(options: SessionStoreOptions): Required<SessionStoreOptions> {
  return {
    now: options.now ?? Date.now,
    defaultTtlMs: options.defaultTtlMs ?? DEFAULT_SESSION_TTL_MS,
    defaultIdleTimeoutMs: options.defaultIdleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
  };
}

function assertInput(input: CreateSessionInput): void {
  if (!input.userId) throw new Error('userId is required');
  if (!isRole(input.role)) throw new Error(`Invalid role: ${String(input.role)}`);
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly opts: Required<SessionStoreOptions>;

  constructor(options: SessionStoreOptions = {}) {
    this.opts = resolveOptions(options);
  }

  create(input: CreateSessionInput): CreatedSession {
    assertInput(input);
    const sessionId = generateSessionId();
    const session = buildSession(input, hashSessionId(sessionId), this.opts.now(), this.opts);
    this.sessions.set(session.idHash, session);
    return { sessionId, session: { ...session } };
  }

  get(sessionId: string, options: { touch?: boolean } = {}): Session | null {
    if (!RAW_ID_PATTERN.test(sessionId)) return null;
    const key = hashSessionId(sessionId);
    const session = this.sessions.get(key);
    if (!session) return null;
    const now = this.opts.now();
    if (isSessionExpired(session, now) || isSessionIdle(session, now)) {
      this.sessions.delete(key);
      return null;
    }
    if (options.touch !== false) session.lastSeenAt = now;
    return { ...session };
  }

  markReauth(sessionId: string): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    const stored = this.sessions.get(session.idHash);
    if (stored) stored.reauthAt = this.opts.now();
    return stored ? { ...stored } : null;
  }

  revoke(sessionId: string): boolean {
    if (!RAW_ID_PATTERN.test(sessionId)) return false;
    return this.sessions.delete(hashSessionId(sessionId));
  }

  revokeAll(userId: string): number {
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  listForUser(userId: string): Session[] {
    const now = this.opts.now();
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId && !isSessionExpired(s, now) && !isSessionIdle(s, now))
      .map((s) => ({ ...s }));
  }

  purgeExpired(): number {
    const now = this.opts.now();
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (isSessionExpired(session, now) || isSessionIdle(session, now)) {
        this.sessions.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

interface SessionRow {
  id_hash: string;
  user_id: string;
  role: string;
  created_at: number;
  last_seen_at: number;
  reauth_at: number;
  expires_at: number;
  idle_timeout_ms: number;
}

function rowToSession(row: SessionRow): Session {
  return {
    idHash: row.id_hash,
    userId: row.user_id,
    role: isRole(row.role) ? row.role : 'viewer',
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    reauthAt: row.reauth_at,
    expiresAt: row.expires_at,
    idleTimeoutMs: row.idle_timeout_ms,
  };
}

/** Sessions persisted in SQLite (`node:sqlite`). Only the SHA-256 of the session id is stored. */
export class SqliteSessionStore implements SessionStore {
  private readonly opts: Required<SessionStoreOptions>;

  constructor(
    private readonly db: DatabaseSync,
    options: SessionStoreOptions = {},
  ) {
    this.opts = resolveOptions(options);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        reauth_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        idle_timeout_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);
    `);
  }

  /** Opens (and creates) a database file with WAL enabled. Use `:memory:` for tests. */
  static async open(path: string, options: SessionStoreOptions = {}): Promise<SqliteSessionStore> {
    const { DatabaseSync: Database } = await import('node:sqlite');
    const db = new Database(path);
    if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
    return new SqliteSessionStore(db, options);
  }

  create(input: CreateSessionInput): CreatedSession {
    assertInput(input);
    const sessionId = generateSessionId();
    const session = buildSession(input, hashSessionId(sessionId), this.opts.now(), this.opts);
    this.db
      .prepare(
        `INSERT INTO auth_sessions (id_hash, user_id, role, created_at, last_seen_at, reauth_at, expires_at, idle_timeout_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(session.idHash, session.userId, session.role, session.createdAt, session.lastSeenAt, session.reauthAt, session.expiresAt, session.idleTimeoutMs);
    return { sessionId, session };
  }

  get(sessionId: string, options: { touch?: boolean } = {}): Session | null {
    if (!RAW_ID_PATTERN.test(sessionId)) return null;
    const idHash = hashSessionId(sessionId);
    const row = this.db.prepare('SELECT * FROM auth_sessions WHERE id_hash = ?').get(idHash) as SessionRow | undefined;
    if (!row) return null;
    const session = rowToSession(row);
    const now = this.opts.now();
    if (isSessionExpired(session, now) || isSessionIdle(session, now)) {
      this.db.prepare('DELETE FROM auth_sessions WHERE id_hash = ?').run(idHash);
      return null;
    }
    if (options.touch !== false) {
      this.db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id_hash = ?').run(now, idHash);
      session.lastSeenAt = now;
    }
    return session;
  }

  markReauth(sessionId: string): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    const now = this.opts.now();
    this.db.prepare('UPDATE auth_sessions SET reauth_at = ? WHERE id_hash = ?').run(now, session.idHash);
    return { ...session, reauthAt: now };
  }

  revoke(sessionId: string): boolean {
    if (!RAW_ID_PATTERN.test(sessionId)) return false;
    return Number(this.db.prepare('DELETE FROM auth_sessions WHERE id_hash = ?').run(hashSessionId(sessionId)).changes) > 0;
  }

  revokeAll(userId: string): number {
    return Number(this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId).changes);
  }

  listForUser(userId: string): Session[] {
    const now = this.opts.now();
    const rows = this.db.prepare('SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY created_at').all(userId) as unknown as SessionRow[];
    return rows.map(rowToSession).filter((s) => !isSessionExpired(s, now) && !isSessionIdle(s, now));
  }

  purgeExpired(): number {
    const now = this.opts.now();
    return Number(
      this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR (? - last_seen_at) >= idle_timeout_ms').run(now, now).changes,
    );
  }

  close(): void {
    this.db.close();
  }
}
