import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  MetricsRegistry,
  RateMeter,
  appendToChain,
  canonicalJson,
  computeAuditHash,
  createCorrelationId,
  createId,
  createJarvisMetrics,
  createLogger,
  createRedactor,
  createSeededIdFactory,
  createUlidGenerator,
  getCorrelationId,
  isJarvisId,
  isSensitiveKey,
  redact,
  redactString,
  runWithCorrelation,
  sanitizeInboundCorrelationId,
  verifyChain,
  type AuditChainEntry,
  type HistogramSeries,
  type LogRecord,
} from './index';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-obs-'));
  tempDirs.push(dir);
  return dir;
}

describe('ids', () => {
  it('creates prefixed 26-char ULID ids', () => {
    const id = createId('task');
    expect(id).toMatch(/^task_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isJarvisId(id, 'task')).toBe(true);
    expect(isJarvisId(id, 'agent')).toBe(false);
    expect(createId('appr_')).toMatch(/^appr_/);
    expect(createCorrelationId()).toMatch(/^corr_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('is strictly monotonic within the same millisecond and across clock regressions', () => {
    let t = 1_700_000_000_000;
    const gen = createUlidGenerator({ now: () => t });
    const ids = [gen(), gen(), gen()];
    t -= 5_000;
    ids.push(gen());
    for (let i = 1; i < ids.length; i += 1) expect(ids[i]! > ids[i - 1]!).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries the random part on overflow', () => {
    const gen = createUlidGenerator({ now: () => 1_700_000_000_000, randomDigits: (n) => new Array<number>(n).fill(31) });
    const first = gen();
    const second = gen();
    expect(second > first).toBe(true);
    expect(second).toHaveLength(26);
  });

  it('seeded factory is deterministic and ordered', () => {
    const a = createSeededIdFactory('seed-1');
    const b = createSeededIdFactory('seed-1');
    const c = createSeededIdFactory('seed-2');
    const seqA = [a('task'), a('task'), a('agent')];
    const seqB = [b('task'), b('task'), b('agent')];
    expect(seqA).toEqual(seqB);
    expect(c('task')).not.toBe(seqA[0]);
    expect(seqA[1]! > seqA[0]!).toBe(true);
    expect(seqA.every((id) => isJarvisId(id))).toBe(true);
  });
});

describe('correlation', () => {
  it('propagates through async boundaries', async () => {
    expect(getCorrelationId()).toBeUndefined();
    await runWithCorrelation('corr_test', async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(getCorrelationId()).toBe('corr_test');
    });
    expect(getCorrelationId()).toBeUndefined();
  });

  it('rejects unsafe inbound ids', () => {
    expect(sanitizeInboundCorrelationId('corr_abc-1.2')).toBe('corr_abc-1.2');
    expect(sanitizeInboundCorrelationId('x\nforged: line')).toBeUndefined();
    expect(sanitizeInboundCorrelationId('a'.repeat(200))).toBeUndefined();
  });
});

describe('redaction', () => {
  it('redacts by key pattern, deeply and case-insensitively', () => {
    const out = redact({
      user: 'anna',
      password: 'hunter2',
      nested: { apiKey: 'abc', api_key: 'abc', Authorization: 'Bearer xyz', cookie: 'a=b', userPin: '1234', iban: 'DE89' },
      list: [{ client_secret: 's' }, { fine: 1 }],
      privateKey: '-----BEGIN',
    }) as {
      user: string;
      password: string;
      privateKey: string;
      nested: Record<string, string>;
      list: { client_secret?: string; fine?: number }[];
    };
    expect(out.user).toBe('anna');
    expect(out.password).toBe('[REDACTED]');
    expect(out.nested.apiKey).toBe('[REDACTED]');
    expect(out.nested.api_key).toBe('[REDACTED]');
    expect(out.nested.Authorization).toBe('[REDACTED]');
    expect(out.nested.cookie).toBe('[REDACTED]');
    expect(out.nested.userPin).toBe('[REDACTED]');
    expect(out.nested.iban).toBe('[REDACTED]');
    expect(out.list[0]?.client_secret).toBe('[REDACTED]');
    expect(out.list[1]?.fine).toBe(1);
    expect(out.privateKey).toBe('[REDACTED]');
  });

  it('does not over-match harmless keys', () => {
    expect(isSensitiveKey('mapping')).toBe(false);
    expect(isSensitiveKey('spinning')).toBe(false);
    expect(isSensitiveKey('footprint')).toBe(false);
    expect(isSensitiveKey('cacheKey')).toBe(false);
    expect(isSensitiveKey('pin')).toBe(true);
    expect(isSensitiveKey('pinCode')).toBe(true);
    expect(isSensitiveKey('x-api-key')).toBe(true);
  });

  it('redacts value patterns: bearer, JWT, long hex/base64, url credentials', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const hex = 'a'.repeat(16) + '0123456789abcdef0123456789abcdef';
    const b64 = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3A=';
    expect(redactString('Authorization: Bearer abc.def-123_456')).toBe('Authorization: Bearer [REDACTED]');
    expect(redactString(`token ${jwt} end`)).toBe('token [REDACTED] end');
    expect(redactString(`key=${hex}`)).toBe('key=[REDACTED]');
    expect(redactString(`blob ${b64}`)).toBe('blob [REDACTED]');
    expect(redactString('connect postgres://user:pw123@db.local/x')).toBe('connect postgres://user:[REDACTED]@db.local/x');
    expect(redactString('sk-abcdefghijklmnopqrstuv')).toBe('[REDACTED]');
    expect(redactString('plain message with /some/long/path-without-digits-aaaaaaaaaaaaaaaaaaaaaaaaaaa')).toContain('path-without');
  });

  it('masks e-mails only when the policy says so', () => {
    expect(redactString('mail anna@example.com')).toBe('mail anna@example.com');
    expect(redactString('mail anna@example.com', { redactEmails: true })).toBe('mail [REDACTED_EMAIL]');
    const out = createRedactor({ redactEmails: true }).redact({ to: ['a@b.de'] }) as { to: string[] };
    expect(out.to[0]).toBe('[REDACTED_EMAIL]');
  });

  it('keeps audit hashes intact but still redacts hash-named secrets by key', () => {
    const hash = 'f'.repeat(32) + '0'.repeat(32);
    const out = redact({ hash, prevHash: hash, note: hash }) as Record<string, string>;
    expect(out.hash).toBe(hash);
    expect(out.prevHash).toBe(hash);
    expect(out.note).toBe('[REDACTED]');
    expect((redact({ tokenHash: 'x' }) as Record<string, string>).tokenHash).toBe('[REDACTED]');
  });

  it('survives cycles, errors, bigint and does not mutate input', () => {
    const cyc: Record<string, unknown> = { name: 'c', password: 'p' };
    cyc.self = cyc;
    const err = Object.assign(new Error('failed with Bearer abcdef123456'), { token: 'zzz' });
    const input = { cyc, err, big: 10n, when: new Date('2026-01-01T00:00:00Z') };
    const out = redact(input) as {
      cyc: { self: string; password: string };
      err: { message: string; token: string };
      big: string;
      when: string;
    };
    expect(out.cyc.self).toBe('[Circular]');
    expect(out.cyc.password).toBe('[REDACTED]');
    expect(out.err.message).toBe('failed with Bearer [REDACTED]');
    expect(out.err.token).toBe('[REDACTED]');
    expect(out.big).toBe('10');
    expect(out.when).toBe('2026-01-01T00:00:00.000Z');
    expect(cyc.password).toBe('p');
    expect(JSON.stringify(out)).toBeTypeOf('string');
  });

  it('supports extra keys', () => {
    expect((redact({ customerNumber: 5 }, { extraKeys: ['customer_number'] }) as { customerNumber: string }).customerNumber).toBe('[REDACTED]');
  });
});

describe('logger', () => {
  function capture(options: Partial<Parameters<typeof createLogger>[0]> = {}) {
    const records: LogRecord[] = [];
    const lines: string[] = [];
    const logger = createLogger({
      service: 'control-api',
      stdout: false,
      sinks: [{ write: (line, record) => (lines.push(line), records.push(record)) }],
      clock: () => new Date('2026-05-01T10:00:00.000Z'),
      ...options,
    });
    return { logger, records, lines };
  }

  it('emits the PLAN §50.2 shape with correlation id from the async context', () => {
    const { logger, records } = capture();
    runWithCorrelation('corr_abc', () => logger.info('hello', { route: '/x' }));
    expect(records[0]).toEqual({
      time: '2026-05-01T10:00:00.000Z',
      level: 'info',
      service: 'control-api',
      correlationId: 'corr_abc',
      message: 'hello',
      route: '/x',
    });
    expect(Object.keys(records[0]!).slice(0, 5)).toEqual(['time', 'level', 'service', 'correlationId', 'message']);
  });

  it('filters by level and binds child fields', () => {
    const { logger, records } = capture({ level: 'warn' });
    const child = logger.child({ component: 'ws' });
    child.info('dropped');
    child.warn('kept', { n: 1 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ component: 'ws', n: 1, level: 'warn' });
  });

  it('redacts fields and message automatically and protects reserved keys', () => {
    const { logger, lines, records } = capture();
    logger.info('login with Bearer abcdef123456', { password: 'hunter2', level: 'fatal', nested: { token: 't' } });
    expect(lines[0]).not.toContain('hunter2');
    expect(lines[0]).not.toContain('abcdef123456');
    expect(records[0]!.level).toBe('info');
    expect((records[0]!.nested as { token: string }).token).toBe('[REDACTED]');
  });

  it('writes to stdout stream capture', () => {
    const chunks: string[] = [];
    const logger = createLogger({ service: 's', stdout: { write: (c) => chunks.push(c) } });
    logger.info('x');
    expect(JSON.parse(chunks.join(''))).toMatchObject({ service: 's', message: 'x' });
  });

  it('rotates files by size and keeps N files', () => {
    const dir = tempDir();
    const logger = createLogger({
      service: 's',
      stdout: false,
      file: { dir, fileName: 'app.log', maxBytes: 300, maxFiles: 3 },
    });
    for (let i = 0; i < 40; i += 1) logger.info(`line ${i} ${'x'.repeat(40)}`);
    const files = readdirSync(dir).sort();
    expect(files).toEqual(['app.log', 'app.log.1', 'app.log.2']);
    const last = readFileSync(join(dir, 'app.log'), 'utf8').trim().split('\n');
    expect(JSON.parse(last[last.length - 1]!).message).toContain('line 39');
    for (const f of files) expect(readFileSync(join(dir, f)).length).toBeLessThanOrEqual(300 + 120);
  });
});

describe('metrics', () => {
  it('counts, sets gauges and buckets histograms with labels', () => {
    const reg = new MetricsRegistry();
    const c = reg.counter('req_total', 'Requests', ['route']);
    c.inc({ route: '/a' });
    c.inc({ route: '/a' }, 2);
    c.inc({ route: '/b' });
    const g = reg.gauge('ws', 'ws');
    g.inc();
    g.inc();
    g.dec();
    const h = reg.histogram('lat', 'Latency', [], [0.1, 1]);
    h.observe(0.05);
    h.observe(0.5);
    h.observe(5);
    expect(c.value({ route: '/a' })).toBe(3);
    expect(c.total()).toBe(4);
    expect(g.value()).toBe(1);
    const snap = reg.snapshot(new Date('2026-01-01T00:00:00Z'));
    const lat = snap.metrics.find((m) => m.name === 'lat')!;
    expect(lat.series[0]).toMatchObject({ count: 3, sum: 5.55 });
    expect((lat.series[0] as HistogramSeries).buckets).toEqual([
      { le: '0.1', count: 1 },
      { le: '1', count: 2 },
      { le: '+Inf', count: 3 },
    ]);
    expect(JSON.parse(JSON.stringify(snap)).time).toBe('2026-01-01T00:00:00.000Z');
  });

  it('renders Prometheus text with escaping', () => {
    const reg = new MetricsRegistry();
    reg.counter('a_total', 'help "x"\nnext', ['l']).inc({ l: 'va"l\\ue' });
    const h = reg.histogram('d_seconds', 'd', [], [1]);
    h.observe(0.5);
    const text = reg.renderPrometheus();
    expect(text).toContain('# TYPE a_total counter');
    expect(text).toContain('a_total{l="va\\"l\\\\ue"} 1');
    expect(text).toContain('d_seconds_bucket{le="1"} 1');
    expect(text).toContain('d_seconds_bucket{le="+Inf"} 1');
    expect(text).toContain('d_seconds_sum 0.5');
    expect(text).toContain('d_seconds_count 1');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('validates names, type conflicts and caps cardinality', () => {
    const reg = new MetricsRegistry();
    expect(() => reg.counter('bad name', 'x')).toThrow();
    expect(() => reg.counter('x', 'x', ['le'])).toThrow();
    reg.counter('dup', 'x');
    expect(() => reg.gauge('dup', 'x')).toThrow(/already registered/);
    const c = reg.counter('card', 'x', ['id']);
    for (let i = 0; i < 600; i += 1) c.inc({ id: i });
    expect(c.snapshot().series).toHaveLength(500);
    expect(c.dropped).toBe(100);
  });

  it('provides the JARVIS summary (latency, error rate, adapters, cache, frontend)', () => {
    let now = 1_000_000;
    const m = createJarvisMetrics(new MetricsRegistry(), () => now);
    m.recordRequest('GET', '/api/v1/tasks', 200, 0.02);
    m.recordRequest('GET', '/api/v1/tasks', 200, 0.3);
    m.recordRequest('POST', '/api/v1/tasks', 500, 0.01);
    m.wsConnections.inc();
    m.recordEvent('jarvis.task.updated');
    m.recordEvent('jarvis.task.updated');
    m.recordCache(true);
    m.recordCache(true);
    m.recordCache(false);
    m.setAdapterHealth('mock-tasks', 'healthy');
    m.setAdapterHealth('hermes-tasks', 'down');
    m.recordFrontendReport({ orbFps: 58, webglMemoryBytes: 1024, errors: [{ kind: 'TypeError' }, { kind: 'TypeError', count: 2 }] });
    const s = m.summary();
    expect(s.http.requestsTotal).toBe(3);
    expect(s.http.errorRate).toBeCloseTo(1 / 3);
    expect(s.http.latencyP95Seconds).toBe(0.5);
    expect(s.websocket.connections).toBe(1);
    expect(s.events.total).toBe(2);
    expect(s.events.perSecond).toBeCloseTo(0.2);
    expect(s.cache).toEqual({ hits: 2, misses: 1, hitRatio: 2 / 3 });
    expect(s.adapters).toContainEqual({ adapter: 'mock-tasks', state: 'healthy' });
    expect(s.adapters).toContainEqual({ adapter: 'hermes-tasks', state: 'down' });
    expect(s.frontend).toEqual({ orbFps: 58, webglMemoryBytes: 1024, errorsTotal: 3 });
    now += 20_000;
    expect(m.summary().events.perSecond).toBe(0);
  });

  it('RateMeter slides', () => {
    let t = 0;
    const r = new RateMeter(1000, () => t);
    r.mark(5);
    expect(r.perSecond()).toBe(5);
    t = 1001;
    expect(r.perSecond()).toBe(0);
  });
});

describe('audit hash chain', () => {
  it('canonical JSON sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: undefined, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('builds and verifies a chain', () => {
    const chain: AuditChainEntry[] = [];
    let prev: string | null = null;
    for (let i = 0; i < 4; i += 1) {
      const entry: AuditChainEntry = appendToChain(prev, { seq: i, action: 'approve', actor: 'owner' });
      chain.push(entry);
      prev = entry.hash;
    }
    expect(chain[0]!.prevHash).toBe(GENESIS_HASH);
    expect(chain[0]!.hash).toBe(computeAuditHash(GENESIS_HASH, canonicalJson({ seq: 0, action: 'approve', actor: 'owner' })));
    expect(verifyChain(chain)).toEqual({ valid: true, length: 4, headHash: chain[3]!.hash });
    expect(verifyChain([])).toMatchObject({ valid: true, length: 0 });
  });

  it('detects tampering, reordering and deletion', () => {
    const e0 = appendToChain(null, { n: 0 });
    const e1 = appendToChain(e0.hash, { n: 1 });
    const e2 = appendToChain(e1.hash, { n: 2 });
    expect(verifyChain([e0, { ...e1, event: { n: 99 } }, e2])).toMatchObject({ valid: false, index: 1, reason: 'hash_mismatch' });
    expect(verifyChain([e0, e2])).toMatchObject({ valid: false, index: 1, reason: 'prev_hash_mismatch' });
    expect(verifyChain([e1, e0])).toMatchObject({ valid: false, index: 0 });
    expect(verifyChain([e1, e2])).toMatchObject({ valid: false, index: 0, reason: 'prev_hash_mismatch' });
    expect(verifyChain([e1, e2], e0.hash)).toMatchObject({ valid: true });
  });
});
