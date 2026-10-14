import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApprovalTokenService,
  CSRF_COOKIE,
  DevAuthNotAllowedError,
  InMemoryNonceStore,
  InMemorySessionStore,
  LoginRateLimiter,
  SESSION_COOKIE,
  SqliteNonceStore,
  SqliteSessionStore,
  WRITE_ACTIONS,
  authorize,
  can,
  clearCsrfCookie,
  clearSessionCookie,
  createDevIdentity,
  deriveKey,
  hashPassword,
  hashSessionId,
  isCsrfProtectedMethod,
  isLoopbackHost,
  issueCsrfToken,
  issueDevSession,
  listAllowedActions,
  loadOrCreateServerKey,
  needsRehash,
  parseCookies,
  parsePasswordHash,
  serializeCsrfCookie,
  serializeSessionCookie,
  verifyCsrfToken,
  verifyPassword,
  type SessionStore,
} from './index';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function clock(start = 1_800_000_000_000) {
  const state = { t: start };
  return { now: () => state.t, advance: (ms: number) => void (state.t += ms), state };
}

describe('permission matrix', () => {
  it('lets every role read everything', () => {
    for (const role of ['owner', 'operator', 'viewer'] as const) {
      expect(can(role, 'read:tasks')).toBe(true);
      expect(can(role, 'read:audit')).toBe(true);
    }
    expect(can('viewer', 'read:')).toBe(false);
  });

  it('viewer is read only', () => {
    for (const action of WRITE_ACTIONS) expect(can('viewer', action, { devMode: true })).toBe(false);
    expect(listAllowedActions('viewer')).toEqual([]);
  });

  it('operator may run day-to-day operations but not settings/system/audit', () => {
    for (const action of [
      'tasks.create',
      'tasks.retry',
      'agents.stop',
      'approvals.approve',
      'approvals.reject',
      'approvals.requestContext',
      'memory.write',
      'memory.delete',
      'communication.requestSend',
      'calendar.propose',
      'automations.pauseAll',
      'files.delete',
      'voice.test',
      'notifications.snooze',
      'commands.run',
      'commands.resume',
    ] as const) {
      expect(can('operator', action), action).toBe(true);
    }
    for (const action of [
      'system.healthcheck',
      'system.reconnect',
      'system.restartAdapter',
      'settings.update',
      'settings.import',
      'settings.export',
      'adapters.configure',
      'dev.scenarios',
      'audit.export',
    ] as const) {
      expect(can('operator', action, { devMode: true }), action).toBe(false);
    }
  });

  it('owner may do everything; dev.scenarios only in dev mode', () => {
    for (const action of WRITE_ACTIONS.filter((a) => a !== 'dev.scenarios')) expect(can('owner', action), action).toBe(true);
    expect(can('owner', 'dev.scenarios')).toBe(false);
    expect(authorize('owner', 'dev.scenarios')).toEqual({ allowed: false, reason: 'dev_only' });
    expect(can('owner', 'dev.scenarios', { devMode: true })).toBe(true);
  });

  it('tier-3 approval needs owner + fresh re-auth and never voice', () => {
    const now = 1_000_000;
    const base = { approvalTier: 3 as const, now, reauthWindowMs: 300_000 };
    expect(authorize('owner', 'approvals.approve', { ...base, reauthAt: now - 1000 })).toEqual({ allowed: true });
    expect(authorize('owner', 'approvals.approve', base)).toEqual({ allowed: false, reason: 'reauth_required' });
    expect(authorize('owner', 'approvals.approve', { ...base, reauthAt: now - 301_000 })).toEqual({ allowed: false, reason: 'reauth_required' });
    expect(authorize('owner', 'approvals.approve', { ...base, reauthAt: now + 5000 })).toEqual({ allowed: false, reason: 'reauth_required' });
    expect(authorize('operator', 'approvals.approve', { ...base, reauthAt: now })).toEqual({ allowed: false, reason: 'forbidden_role' });
    expect(authorize('owner', 'approvals.approve', { ...base, reauthAt: now, channel: 'voice' })).toEqual({ allowed: false, reason: 'voice_not_allowed' });
    // lower tiers need no re-auth, operator allowed
    expect(can('operator', 'approvals.approve', { approvalTier: 2 })).toBe(true);
    expect(can('operator', 'approvals.approve')).toBe(true);
    // rejecting / asking for context never executes anything
    expect(can('operator', 'approvals.reject', { approvalTier: 3 })).toBe(true);
    expect(can('operator', 'approvals.requestContext', { approvalTier: 3 })).toBe(true);
  });

  it('denies unknown actions and roles', () => {
    expect(authorize('owner', 'tasks.explode' as never)).toEqual({ allowed: false, reason: 'unknown_action' });
    expect(can('root' as never, 'read:tasks')).toBe(false);
  });
});

describe('password hashing', () => {
  it('round-trips with the documented encoding', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    const parts = encoded.split('$');
    expect(parts.slice(0, 4)).toEqual(['scrypt', '32768', '8', '1']);
    expect(Buffer.from(parts[4]!, 'base64')).toHaveLength(16);
    expect(Buffer.from(parts[5]!, 'base64')).toHaveLength(32);
    expect(await verifyPassword('correct horse battery staple', encoded)).toBe(true);
    expect(needsRehash(encoded)).toBe(false);
  });

  it('rejects wrong passwords and uses a fresh salt each time', async () => {
    const a = await hashPassword('secret-password-1');
    const b = await hashPassword('secret-password-1');
    expect(a).not.toBe(b);
    expect(await verifyPassword('secret-password-2', a)).toBe(false);
    expect(await verifyPassword('', a)).toBe(false);
  });

  it('fails closed on malformed or hostile stored hashes', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$32768$8$1$AAAA')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1073741824$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$30000$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(parsePasswordHash('scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).not.toBeNull();
  });

  it('flags weaker parameters for rehash', async () => {
    const weak = await hashPassword('another-password', { N: 1 << 14 });
    expect(await verifyPassword('another-password', weak)).toBe(true);
    expect(needsRehash(weak)).toBe(true);
  });
});

function sessionStoreSuite(name: string, create: (c: ReturnType<typeof clock>) => SessionStore) {
  describe(name, () => {
    it('creates sessions with 32-byte random ids that are stored hashed', () => {
      const c = clock();
      const store = create(c);
      const { sessionId, session } = store.create({ userId: 'owner', role: 'owner' });
      expect(Buffer.from(sessionId, 'base64url')).toHaveLength(32);
      expect(session.idHash).toBe(hashSessionId(sessionId));
      expect(session.idHash).not.toContain(sessionId);
      expect(session).toMatchObject({ userId: 'owner', role: 'owner', createdAt: c.now(), reauthAt: c.now() });
      expect(store.get(sessionId)?.userId).toBe('owner');
      expect(store.get('not-a-session')).toBeNull();
      expect(store.get(sessionId.slice(0, -1) + (sessionId.endsWith('A') ? 'B' : 'A'))).toBeNull();
    });

    it('expires absolutely', () => {
      const c = clock();
      const store = create(c);
      const { sessionId } = store.create({ userId: 'u', role: 'viewer', ttlMs: 60_000, idleTimeoutMs: 3_600_000 });
      c.advance(59_000);
      expect(store.get(sessionId)).not.toBeNull();
      c.advance(1_000);
      expect(store.get(sessionId)).toBeNull();
      expect(store.get(sessionId)).toBeNull();
    });

    it('expires after idle timeout but activity keeps it alive', () => {
      const c = clock();
      const store = create(c);
      const { sessionId } = store.create({ userId: 'u', role: 'operator', ttlMs: 3_600_000, idleTimeoutMs: 10_000 });
      for (let i = 0; i < 5; i += 1) {
        c.advance(9_000);
        expect(store.get(sessionId)).not.toBeNull();
      }
      c.advance(10_000);
      expect(store.get(sessionId)).toBeNull();
    });

    it('does not extend on touch:false', () => {
      const c = clock();
      const store = create(c);
      const { sessionId } = store.create({ userId: 'u', role: 'operator', idleTimeoutMs: 10_000 });
      c.advance(9_000);
      expect(store.get(sessionId, { touch: false })).not.toBeNull();
      c.advance(2_000);
      expect(store.get(sessionId)).toBeNull();
    });

    it('revoke removes one session; revokeAll logs a user out everywhere', () => {
      const store = create(clock());
      const a1 = store.create({ userId: 'a', role: 'owner' });
      const a2 = store.create({ userId: 'a', role: 'owner' });
      const b1 = store.create({ userId: 'b', role: 'viewer' });
      expect(store.revoke(a1.sessionId)).toBe(true);
      expect(store.revoke(a1.sessionId)).toBe(false);
      expect(store.get(a1.sessionId)).toBeNull();
      expect(store.listForUser('a')).toHaveLength(1);
      expect(store.revokeAll('a')).toBe(1);
      expect(store.get(a2.sessionId)).toBeNull();
      expect(store.get(b1.sessionId)).not.toBeNull();
      expect(store.revokeAll('nobody')).toBe(0);
    });

    it('tracks re-authentication', () => {
      const c = clock();
      const store = create(c);
      const { sessionId, session } = store.create({ userId: 'o', role: 'owner' });
      c.advance(600_000);
      expect(store.get(sessionId)?.reauthAt).toBe(session.createdAt);
      const updated = store.markReauth(sessionId);
      expect(updated?.reauthAt).toBe(c.now());
      expect(store.get(sessionId)?.reauthAt).toBe(c.now());
      expect(store.markReauth('x'.repeat(43))).toBeNull();
    });

    it('purges expired sessions', () => {
      const c = clock();
      const store = create(c);
      store.create({ userId: 'u', role: 'viewer', ttlMs: 1000 });
      const keep = store.create({ userId: 'u', role: 'viewer', ttlMs: 100_000 });
      c.advance(5_000);
      expect(store.purgeExpired()).toBe(1);
      expect(store.get(keep.sessionId)).not.toBeNull();
    });

    it('rejects invalid roles', () => {
      expect(() => create(clock()).create({ userId: 'u', role: 'admin' as never })).toThrow(/role/);
    });
  });
}

sessionStoreSuite('InMemorySessionStore', (c) => new InMemorySessionStore({ now: c.now }));
sessionStoreSuite('SqliteSessionStore', (c) => new SqliteSessionStore(new DatabaseSync(':memory:'), { now: c.now }));

describe('SqliteSessionStore persistence', () => {
  it('survives reopening the database file and never stores the raw id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-auth-'));
    tempDirs.push(dir);
    const file = join(dir, 'dashboard.sqlite');
    const first = await SqliteSessionStore.open(file);
    const { sessionId } = first.create({ userId: 'owner', role: 'owner' });
    first.close();
    const raw = readFileSync(file);
    expect(raw.includes(Buffer.from(sessionId))).toBe(false);
    const second = await SqliteSessionStore.open(file);
    expect(second.get(sessionId)?.userId).toBe('owner');
    second.close();
  });
});

describe('server key + CSRF', () => {
  const dirWithKey = () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-key-'));
    tempDirs.push(dir);
    return dir;
  };

  it('generates the key once, persists it and restricts the file', () => {
    const dir = dirWithKey();
    const first = loadOrCreateServerKey(dir);
    expect(first.created).toBe(true);
    expect(first.key).toHaveLength(32);
    const second = loadOrCreateServerKey(dir);
    expect(second.created).toBe(false);
    expect(second.key.equals(first.key)).toBe(true);
    expect(statSync(first.path).isFile()).toBe(true);
    if (process.platform !== 'win32') expect(statSync(first.path).mode & 0o077).toBe(0);
  });

  it('derives independent sub-keys', () => {
    const { key } = loadOrCreateServerKey(dirWithKey());
    expect(deriveKey(key, 'csrf').equals(deriveKey(key, 'csrf'))).toBe(true);
    expect(deriveKey(key, 'csrf').equals(deriveKey(key, 'approval'))).toBe(false);
    expect(deriveKey(key, 'csrf').equals(key)).toBe(false);
  });

  const key = deriveKey(Buffer.alloc(32, 7), 'csrf');
  it('accepts a valid token for its own session', () => {
    const token = issueCsrfToken(key, 'session-A');
    expect(verifyCsrfToken(key, 'session-A', token)).toBe(true);
    expect(verifyCsrfToken(key, 'session-A', token, token)).toBe(true);
  });

  it('rejects invalid, missing, tampered and other-session tokens', () => {
    const token = issueCsrfToken(key, 'session-A');
    expect(verifyCsrfToken(key, 'session-B', token)).toBe(false);
    expect(verifyCsrfToken(key, 'session-A', 'garbage')).toBe(false);
    expect(verifyCsrfToken(key, 'session-A', '')).toBe(false);
    expect(verifyCsrfToken(key, 'session-A', undefined)).toBe(false);
    expect(verifyCsrfToken(key, 'session-A', (token[0] === 'A' ? 'B' : 'A') + token.slice(1))).toBe(false);
    expect(verifyCsrfToken(deriveKey(Buffer.alloc(32, 8), 'csrf'), 'session-A', token)).toBe(false);
  });

  it('enforces the double-submit cookie match', () => {
    const token = issueCsrfToken(key, 'session-A');
    const other = issueCsrfToken(key, 'session-B');
    expect(verifyCsrfToken(key, 'session-A', token, other)).toBe(false);
    expect(verifyCsrfToken(key, 'session-A', token, null)).toBe(false);
    expect(verifyCsrfToken(key, 'session-A', token, '')).toBe(false);
  });

  it('only protects unsafe methods', () => {
    expect(isCsrfProtectedMethod('get')).toBe(false);
    expect(isCsrfProtectedMethod('POST')).toBe(true);
    expect(isCsrfProtectedMethod('delete')).toBe(true);
  });
});

describe('cookies', () => {
  it('session cookie is HttpOnly, SameSite=Strict, Path=/ and optionally Secure', () => {
    const plain = serializeSessionCookie('abc_DEF-123', { maxAgeSeconds: 3600 });
    expect(plain).toBe('jarvis_session=abc_DEF-123; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600');
    expect(serializeSessionCookie('abc', { maxAgeSeconds: 10, secureCookies: true })).toContain('; Secure');
    expect(() => serializeSessionCookie('bad;value', { maxAgeSeconds: 1 })).toThrow();
  });

  it('csrf cookie is readable by scripts', () => {
    const cookie = serializeCsrfCookie('tok-en_1', { maxAgeSeconds: 60, secureCookies: true });
    expect(cookie).toBe('jarvis_csrf=tok-en_1; Path=/; SameSite=Strict; Max-Age=60; Secure');
    expect(cookie).not.toContain('HttpOnly');
  });

  it('clears and parses', () => {
    expect(clearSessionCookie()).toContain('Max-Age=0');
    expect(clearCsrfCookie(true)).toContain('Secure');
    expect(parseCookies(`${SESSION_COOKIE}=a1; ${CSRF_COOKIE}="b2"; other=x=y; ${SESSION_COOKIE}=evil`)).toEqual({
      jarvis_session: 'a1',
      jarvis_csrf: 'b2',
      other: 'x=y',
    });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('approval tokens', () => {
  const key = deriveKey(Buffer.alloc(32, 3), 'approval');
  const binding = { approvalId: 'appr_01HZ', userId: 'owner', action: 'approvals.approve' };

  it('issues a token valid once for the bound approval, user and action', () => {
    const c = clock();
    const svc = new ApprovalTokenService({ key, now: c.now });
    const { token, claims } = svc.issue(binding);
    expect(claims.expiresAt - claims.issuedAt).toBe(120_000);
    const first = svc.consume(token, binding);
    expect(first).toMatchObject({ ok: true });
    expect(svc.consume(token, binding)).toEqual({ ok: false, reason: 'replayed' });
  });

  it('expires after the TTL', () => {
    const c = clock();
    const svc = new ApprovalTokenService({ key, now: c.now, ttlMs: 5_000 });
    const { token } = svc.issue(binding);
    c.advance(4_999);
    expect(svc.inspect(token, binding).ok).toBe(true);
    c.advance(1);
    expect(svc.consume(token, binding)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects mismatching bindings without burning the nonce', () => {
    const svc = new ApprovalTokenService({ key });
    const { token } = svc.issue(binding);
    expect(svc.consume(token, { ...binding, approvalId: 'appr_other' })).toEqual({ ok: false, reason: 'mismatch' });
    expect(svc.consume(token, { ...binding, userId: 'mallory' })).toEqual({ ok: false, reason: 'mismatch' });
    expect(svc.consume(token, { ...binding, action: 'approvals.reject' })).toEqual({ ok: false, reason: 'mismatch' });
    expect(svc.consume(token, binding).ok).toBe(true);
  });

  it('rejects forged, tampered, foreign-key and malformed tokens', () => {
    const svc = new ApprovalTokenService({ key });
    const other = new ApprovalTokenService({ key: deriveKey(Buffer.alloc(32, 4), 'approval') });
    const { token } = svc.issue(binding);
    const [body, sig] = token.split('.') as [string, string];
    const forgedBody = Buffer.from(JSON.stringify({ v: 1, aid: 'appr_01HZ', uid: 'owner', act: 'approvals.approve', n: 'x', iat: 0, exp: 9e15 })).toString('base64url');
    expect(svc.consume(`${forgedBody}.${sig}`, binding)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(svc.consume(`${body}.${(sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)}`, binding)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(other.consume(token, binding)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(svc.consume('nodot', binding)).toEqual({ ok: false, reason: 'malformed' });
    expect(svc.consume('a.b.c', binding)).toEqual({ ok: false, reason: 'malformed' });
    // CSRF key must not validate approval tokens
    const csrfKey = deriveKey(Buffer.alloc(32, 3), 'csrf');
    expect(new ApprovalTokenService({ key: csrfKey }).consume(token, binding)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('single use also holds with the SQLite nonce store across service instances', () => {
    const c = clock();
    const db = new DatabaseSync(':memory:');
    const a = new ApprovalTokenService({ key, now: c.now, nonceStore: new SqliteNonceStore(db, c.now) });
    const b = new ApprovalTokenService({ key, now: c.now, nonceStore: new SqliteNonceStore(db, c.now) });
    const { token } = a.issue(binding);
    expect(b.consume(token, binding).ok).toBe(true);
    expect(a.consume(token, binding)).toEqual({ ok: false, reason: 'replayed' });
  });

  it('in-memory nonce store forgets only expired nonces', () => {
    const c = clock();
    const store = new InMemoryNonceStore(c.now);
    expect(store.consume('n1', c.now() + 1000)).toBe(true);
    expect(store.consume('n1', c.now() + 1000)).toBe(false);
    c.advance(1001);
    expect(store.consume('n1', c.now() + 1000)).toBe(true);
  });
});

describe('login rate limiter', () => {
  it('locks after maxAttempts failures and releases as the window slides', () => {
    const c = clock();
    const rl = new LoginRateLimiter({ maxAttempts: 3, windowMs: 60_000, now: c.now });
    expect(rl.check('Owner', '10.0.0.1')).toEqual({ allowed: true });
    rl.recordFailure('owner', '10.0.0.1');
    c.advance(10_000);
    rl.recordFailure('OWNER', '10.0.0.1');
    c.advance(10_000);
    expect(rl.check('owner', '10.0.0.1')).toEqual({ allowed: true });
    rl.recordFailure('owner', '10.0.0.1');
    const locked = rl.check('owner', '10.0.0.1');
    expect(locked).toEqual({ allowed: false, retryAfterMs: 40_000 });
    c.advance(39_999);
    expect(rl.check('owner', '10.0.0.1').allowed).toBe(false);
    c.advance(1);
    expect(rl.check('owner', '10.0.0.1')).toEqual({ allowed: true });
  });

  it('is scoped per username and IP', () => {
    const rl = new LoginRateLimiter({ maxAttempts: 2, now: clock().now });
    rl.recordFailure('owner', '1.1.1.1');
    rl.recordFailure('owner', '1.1.1.1');
    expect(rl.check('owner', '1.1.1.1').allowed).toBe(false);
    expect(rl.check('owner', '2.2.2.2').allowed).toBe(true);
    expect(rl.check('operator', '1.1.1.1').allowed).toBe(true);
  });

  it('success clears the user counter', () => {
    const rl = new LoginRateLimiter({ maxAttempts: 2, now: clock().now });
    rl.recordFailure('owner', '1.1.1.1');
    rl.recordSuccess('owner', '1.1.1.1');
    rl.recordFailure('owner', '1.1.1.1');
    expect(rl.check('owner', '1.1.1.1').allowed).toBe(true);
  });

  it('throttles username spraying from one IP', () => {
    const rl = new LoginRateLimiter({ maxAttempts: 5, maxAttemptsPerIp: 4, now: clock().now });
    for (const user of ['a', 'b', 'c', 'd']) rl.recordFailure(user, '9.9.9.9');
    expect(rl.check('fresh-user', '9.9.9.9').allowed).toBe(false);
    expect(rl.check('fresh-user', '8.8.8.8').allowed).toBe(true);
  });

  it('bounds memory', () => {
    const rl = new LoginRateLimiter({ maxKeys: 10, now: clock().now });
    for (let i = 0; i < 100; i += 1) rl.recordFailure(`u${i}`, `10.0.0.${i}`);
    expect(rl.check('u0', '10.0.0.0').allowed).toBe(true);
  });
});

describe('dev auth mode', () => {
  const ok = { dataMode: 'mock', host: '127.0.0.1' } as const;

  it('yields fixed identities for each role in mock + loopback', () => {
    expect(createDevIdentity('owner', ok)).toEqual({ userId: 'dev-owner', username: 'dev-owner', role: 'owner', mode: 'dev' });
    expect(createDevIdentity('viewer', { dataMode: 'mock', host: 'localhost' }).role).toBe('viewer');
    expect(createDevIdentity('operator', { dataMode: 'mock', host: '::1' }).userId).toBe('dev-operator');
  });

  it('refuses hybrid/live and non-loopback hosts', () => {
    expect(() => createDevIdentity('owner', { dataMode: 'hybrid', host: '127.0.0.1' })).toThrow(DevAuthNotAllowedError);
    expect(() => createDevIdentity('owner', { dataMode: 'live', host: '127.0.0.1' })).toThrow(/mock/);
    expect(() => createDevIdentity('owner', { dataMode: 'mock', host: '0.0.0.0' })).toThrow(/loopback/);
    expect(() => createDevIdentity('owner', { dataMode: 'mock', host: '192.168.1.5' })).toThrow(DevAuthNotAllowedError);
    expect(() => createDevIdentity('owner', { dataMode: 'mock', host: 'example.com' })).toThrow(DevAuthNotAllowedError);
  });

  it('classifies loopback hosts', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ['0.0.0.0', '::', '10.0.0.1', '127.0.0.1.evil.com', '']) expect(isLoopbackHost(h), h).toBe(false);
  });

  it('issues a store-backed session', () => {
    const store = new InMemorySessionStore();
    const issued = issueDevSession(store, 'operator', ok);
    expect(store.get(issued.sessionId)).toMatchObject({ userId: 'dev-operator', role: 'operator' });
    expect(() => issueDevSession(store, 'owner', { dataMode: 'live', host: '127.0.0.1' })).toThrow(DevAuthNotAllowedError);
    expect(store.listForUser('dev-owner')).toEqual([]);
  });
});
