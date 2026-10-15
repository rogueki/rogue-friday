import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADAPTER_CATEGORIES,
  ConfigError,
  SecretValue,
  describeSecretRef,
  interpolateString,
  interpolateTree,
  isLoopback,
  legacyEnvWarning,
  loadConfig,
  normalizeLegacyEnv,
  parseSecretRef,
  resolveSecret,
  type FridayConfig,
  type SpawnFn,
} from './index';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(files: { dashboard?: string; adapters?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'friday-config-'));
  tempDirs.push(dir);
  if (files.dashboard !== undefined) writeFileSync(join(dir, 'dashboard.yaml'), files.dashboard);
  if (files.adapters !== undefined) writeFileSync(join(dir, 'adapters.yaml'), files.adapters);
  return dir;
}

function load(files: { dashboard?: string; adapters?: string }, env: NodeJS.ProcessEnv = {}): FridayConfig {
  return loadConfig({ configDir: setup(files), env, cwd: tmpdir() });
}

function loadError(files: { dashboard?: string; adapters?: string }, env: NodeJS.ProcessEnv = {}): ConfigError {
  try {
    load(files, env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('expected loadConfig to throw');
}

describe('interpolation', () => {
  it('substitutes ${VAR} and ${VAR:-default}', () => {
    const misses: string[] = [];
    const env = { A: 'alpha', EMPTY: '' };
    const run = (s: string) => interpolateString(s, env, (v) => misses.push(v));
    expect(run('x-${A}-y')).toBe('x-alpha-y');
    expect(run('${B:-fallback}')).toBe('fallback');
    expect(run('${EMPTY:-fallback}')).toBe('fallback');
    expect(run('${A:-fallback}')).toBe('alpha');
    expect(run('${B:-}')).toBe('');
    expect(run('${MISSING}')).toBe('${MISSING}');
    expect(run('${EMPTY}')).toBe('${EMPTY}');
    expect(misses).toEqual(['MISSING', 'EMPTY']);
  });

  it('supports the $${ escape and leaves other dollars alone', () => {
    const run = (s: string) => interpolateString(s, { A: '1' }, () => undefined);
    expect(run('$${A}')).toBe('${A}');
    expect(run('cost $5 and $A')).toBe('cost $5 and $A');
  });

  it('walks nested trees and records the failing path', () => {
    const misses: { path: string; variable: string }[] = [];
    const out = interpolateTree({ a: { b: ['${X:-1}', '${NOPE}'] }, n: 3 }, {}, misses);
    expect(out).toEqual({ a: { b: ['1', '${NOPE}'] }, n: 3 });
    expect(misses).toEqual([{ path: 'a.b[1]', variable: 'NOPE' }]);
  });

  it('is applied to config files and coerces numbers', () => {
    const config = load({ dashboard: 'server:\n  port: ${PORT:-4100}\npaths:\n  dataDir: ${DATA_ROOT}/data\n' }, { DATA_ROOT: tmpdir().replaceAll('\\', '/') });
    expect(config.server.port).toBe(4100);
    expect(config.paths.dataDir).toBe(resolve(tmpdir(), 'data'));
  });

  it('reports unset variables without default as validation problems', () => {
    const error = loadError({ dashboard: 'ui:\n  theme: ${THEME_ID}\n' });
    expect(error.message).toContain('ui.theme');
    expect(error.message).toContain('THEME_ID is not set');
  });

  it('tolerates unset variables inside disabled adapters', () => {
    const config = load(
      { adapters: 'adapters:\n  tasks:\n    provider: hermes-tasks\n    enabled: false\n    config:\n      baseUrl: ${HERMES_BASE_URL}\nallowlist:\n  hermes-tasks: "@friday/adapter-hermes-placeholder"\n' },
      { FRIDAY_DATA_MODE: 'hybrid' },
    );
    expect(config.adapters.tasks.enabled).toBe(false);
    expect(config.adapters.tasks.provider).toBe('hermes-tasks');
  });
});

describe('defaults', () => {
  it('works without any file and yields a safe mock configuration', () => {
    const config = load({});
    expect(config.dataMode).toBe('mock');
    expect(config.server).toEqual({ host: '127.0.0.1', port: 3100, allowRemote: false });
    expect(config.remoteAccess).toBe(false);
    expect(config.auth).toMatchObject({
      mode: 'local',
      sessionTtlMinutes: 720,
      reauthWindowMinutes: 5,
      idleTimeoutMinutes: 30,
      secureCookies: false,
      ownerPasswordHash: { ref: 'env:FRIDAY_OWNER_PASSWORD_HASH', configured: false },
    });
    expect(config.realtime).toEqual({ ringBufferSize: 5000, heartbeatSeconds: 15 });
    expect(config.ui).toEqual({ locale: 'de-DE', timezone: 'Europe/Berlin', assistantName: 'F.R.I.D.A.Y.', theme: 'friday-command-midnight', layout: 'friday-command-overview' });
    expect(config.dev).toEqual({ scenarioConsole: true, responseValidation: true });
    expect(config.files).toEqual({ dashboard: null, adapters: null });
    expect(config.warnings.some((w) => w.includes('dashboard.yaml not found'))).toBe(true);
  });

  it('derives dev defaults from the data mode but honours explicit values', () => {
    expect(load({ dashboard: 'dataMode: live\n' }).dev).toEqual({ scenarioConsole: false, responseValidation: false });
    expect(load({ dashboard: 'dataMode: hybrid\n' }).dev).toEqual({ scenarioConsole: false, responseValidation: true });
    expect(load({ dashboard: 'dataMode: live\ndev:\n  responseValidation: true\n' }).dev.responseValidation).toBe(true);
  });

  it('resolves relative paths against the config dir and keeps absolute ones', () => {
    const dir = setup({ dashboard: 'paths:\n  dataDir: ./state\n  logDir: ../elsewhere/logs\n  backupDir: ' + JSON.stringify(resolve(tmpdir(), 'abs-backups')) + '\n' });
    const config = loadConfig({ configDir: dir, env: {}, cwd: tmpdir() });
    expect(config.configDir).toBe(dir);
    expect(config.paths.dataDir).toBe(resolve(dir, 'state'));
    expect(config.paths.logDir).toBe(resolve(dir, '..', 'elsewhere', 'logs'));
    expect(config.paths.backupDir).toBe(resolve(tmpdir(), 'abs-backups'));
    expect(config.paths.webRoot).toBe(resolve(dir, '..', 'apps', 'web', 'out'));
  });

  it('returns a deeply frozen object', () => {
    const config = load({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.server)).toBe(true);
    expect(Object.isFrozen(config.adapters.tasks.retry)).toBe(true);
    expect(() => {
      (config.server as { port: number }).port = 1;
    }).toThrow(TypeError);
  });
});

describe('environment overrides', () => {
  it('FRIDAY_* override YAML values', () => {
    const dir = setup({ dashboard: 'dataMode: mock\nserver:\n  port: 3100\n' });
    const cwd = resolve(tmpdir(), 'cwd-base');
    const config = loadConfig({
      configDir: dir,
      cwd,
      env: { FRIDAY_DATA_MODE: 'hybrid', FRIDAY_HOST: 'localhost', FRIDAY_PORT: '4200', FRIDAY_DATA_DIR: 'rel-data', FRIDAY_LOG_DIR: resolve(tmpdir(), 'abs-logs') },
    });
    expect(config.dataMode).toBe('hybrid');
    expect(config.server).toMatchObject({ host: 'localhost', port: 4200 });
    expect(config.paths.dataDir).toBe(resolve(cwd, 'rel-data'));
    expect(config.paths.logDir).toBe(resolve(tmpdir(), 'abs-logs'));
  });

  it('FRIDAY_CONFIG_DIR selects the config directory', () => {
    const dir = setup({ dashboard: 'server:\n  port: 5005\n' });
    expect(loadConfig({ env: { FRIDAY_CONFIG_DIR: dir } }).server.port).toBe(5005);
  });

  it('rejects invalid override values', () => {
    const error = loadError({}, { FRIDAY_DATA_MODE: 'turbo', FRIDAY_PORT: '99999' });
    expect(error.problems.map((p) => p.path)).toEqual(['FRIDAY_DATA_MODE', 'FRIDAY_PORT']);
    expect(loadError({}, { FRIDAY_PORT: '80abc' }).message).toContain('FRIDAY_PORT');
  });
});

describe('legacy JARVIS_* environment variables', () => {
  it('reads a legacy variable when the FRIDAY_* one is unset and reports it once in the warnings', () => {
    const config = load({}, { JARVIS_DATA_MODE: 'hybrid', JARVIS_PORT: '4300' });
    expect(config.dataMode).toBe('hybrid');
    expect(config.server.port).toBe(4300);
    const deprecations = config.warnings.filter((w) => w.includes('Veraltete Umgebungsvariablen'));
    expect(deprecations).toHaveLength(1);
    expect(deprecations[0]).toContain('JARVIS_DATA_MODE');
    expect(deprecations[0]).toContain('JARVIS_PORT');
  });

  it('prefers the FRIDAY_* variable and stays silent when no legacy variable is applied', () => {
    const config = load({}, { FRIDAY_PORT: '4400', JARVIS_PORT: '4500' });
    expect(config.server.port).toBe(4400);
    expect(config.warnings.some((w) => w.includes('Veraltete Umgebungsvariablen'))).toBe(false);
  });

  it('resolves ${env:FRIDAY_X} references from a legacy JARVIS_X value', () => {
    const config = load({ dashboard: 'server:\n  host: ${env:FRIDAY_HOST}\n' }, { JARVIS_HOST: 'localhost' });
    expect(config.server.host).toBe('localhost');
  });

  it('normalizeLegacyEnv never mutates its input and ignores unrelated variables', () => {
    const source = { JARVIS_LOG_DIR: 'logs', PATH: '/bin' };
    const result = normalizeLegacyEnv(source);
    expect(result.env.FRIDAY_LOG_DIR).toBe('logs');
    expect(source).toEqual({ JARVIS_LOG_DIR: 'logs', PATH: '/bin' });
    expect(result.legacy).toEqual(['JARVIS_LOG_DIR']);
    expect(normalizeLegacyEnv({ PATH: '/bin' })).toEqual({ env: { PATH: '/bin' }, legacy: [] });
    expect(legacyEnvWarning(result.legacy)).toContain('FRIDAY_*');
  });
});

describe('validation errors', () => {
  it('lists every problem at once with paths', () => {
    const error = loadError({
      dashboard: [
        'dataMode: turbo',
        'server:',
        '  port: 70000',
        '  hostname: x',
        'auth:',
        '  sessionTtlMinutes: 1',
        'realtime:',
        '  heartbeatSeconds: abc',
        '',
      ].join('\n'),
      adapters: 'adapters:\n  tasks:\n    enabled: true\n  coffee:\n    provider: mock-coffee\n',
    });
    const text = error.message;
    expect(error.problems.length).toBeGreaterThanOrEqual(6);
    expect(text).toMatch(/Invalid configuration \(\d+ problems\)/);
    expect(text).toContain('[dashboard.yaml] dataMode: must be one of: mock, hybrid, live (got "turbo")');
    expect(text).toContain('server.port: must be <= 65535 (got 70000)');
    expect(text).toContain('server.hostname: unknown property');
    expect(text).toContain('auth.sessionTtlMinutes: must be >= 5 (got 1)');
    expect(text).toContain('realtime.heartbeatSeconds: must be integer');
    expect(text).toContain('[adapters.yaml] adapters.tasks.provider: required property is missing');
    expect(text).toContain('adapters.coffee: unknown property');
  });

  it('reports YAML syntax errors with a line number', () => {
    const error = loadError({ dashboard: 'server:\n  port: [1, 2\n' });
    expect(error.message).toMatch(/\[dashboard\.yaml\] YAML syntax error/);
  });

  it('rejects duplicate keys and non-mapping roots', () => {
    expect(loadError({ dashboard: 'dataMode: mock\ndataMode: live\n' }).message).toContain('YAML syntax error');
    expect(loadError({ dashboard: '- a\n- b\n' }).message).toContain('top level must be a mapping');
  });

  it('validates locale and time zone semantics', () => {
    expect(load({ dashboard: 'ui:\n  assistantName: Nova\n' }).ui.assistantName).toBe('Nova');
    expect(loadError({ dashboard: "ui:\n  assistantName: ''\n" }).message).toContain('ui.assistantName');
    const error = loadError({ dashboard: 'ui:\n  timezone: Mars/Olympus\n' });
    expect(error.message).toContain('ui.timezone');
  });
});

describe('loopback guard', () => {
  it('classifies hosts', () => {
    for (const h of ['127.0.0.1', '127.5.5.5', 'localhost', '::1', '[::1]']) expect(isLoopback(h), h).toBe(true);
    for (const h of ['0.0.0.0', '::', '192.168.0.2', 'friday.example.com', '127.0.0.1.nip.io']) expect(isLoopback(h), h).toBe(false);
  });

  it('refuses a non-loopback host unless allowRemote is true', () => {
    const error = loadError({ dashboard: 'server:\n  host: 0.0.0.0\n' });
    expect(error.message).toContain('server.host');
    expect(error.message).toContain('allowRemote');
    expect(loadError({}, { FRIDAY_HOST: '192.168.1.10' }).message).toContain('server.host');
  });

  it('accepts remote hosts with allowRemote and records the TLS/VPN requirement', () => {
    const config = load({ dashboard: 'server:\n  host: 0.0.0.0\n  allowRemote: true\n' });
    expect(config.remoteAccess).toBe(true);
    expect(config.warnings.join('\n')).toContain('TLS or a VPN/zero-trust');
    expect(config.warnings.join('\n')).toContain('auth.secureCookies is false');
    const secure = load({ dashboard: 'server:\n  host: 0.0.0.0\n  allowRemote: true\nauth:\n  secureCookies: true\n' });
    expect(secure.warnings.join('\n')).not.toContain('auth.secureCookies');
  });

  it('only allows dev auth with mock mode on loopback', () => {
    expect(load({ dashboard: 'auth:\n  mode: dev\n' }).auth.mode).toBe('dev');
    expect(loadError({ dashboard: 'dataMode: hybrid\nauth:\n  mode: dev\n' }).message).toContain('dev auth is only allowed');
    expect(loadError({ dashboard: 'server:\n  host: 0.0.0.0\n  allowRemote: true\nauth:\n  mode: dev\n' }).message).toContain('dev auth is only allowed');
    expect(loadError({ dashboard: 'auth:\n  mode: dev\n' }, { FRIDAY_DATA_MODE: 'live' }).message).toContain('dev auth is only allowed');
  });
});

describe('mode presets', () => {
  const hermes = '@friday/adapter-hermes-placeholder';
  const adapters = [
    'allowlist:',
    `  hermes-tasks: "${hermes}"`,
    'adapters:',
    '  tasks:',
    '    provider: hermes-tasks',
    '    config:',
    '      baseUrl: http://127.0.0.1:9000',
    '  memory:',
    '    provider: mock-memory',
    '',
  ].join('\n');

  it('mock: every category is its mock-* provider; other providers are overridden with a warning', () => {
    const config = load({ adapters });
    for (const category of ADAPTER_CATEGORIES) {
      expect(config.adapters[category].provider, category).toBe(`mock-${category}`);
      expect(config.adapters[category].enabled).toBe(true);
      expect(config.adapters[category].packageName).toBe('@friday/adapter-mock');
    }
    expect(config.adapters.tasks.origin).toBe('mock-forced');
    expect(config.adapters.tasks.config).toEqual({});
    expect(config.adapters.memory.origin).toBe('configured');
    expect(config.adapters.voice.origin).toBe('mock-preset');
    expect(config.warnings.some((w) => w.includes('adapters.tasks.provider "hermes-tasks" ignored'))).toBe(true);
  });

  it('hybrid: configured categories keep their provider, the rest fall back to mock', () => {
    const config = load({ dashboard: 'dataMode: hybrid\n', adapters });
    expect(config.adapters.tasks).toMatchObject({ provider: 'hermes-tasks', packageName: hermes, origin: 'configured', enabled: true });
    expect(config.adapters.tasks.config).toEqual({ baseUrl: 'http://127.0.0.1:9000' });
    expect(config.adapters.activity).toMatchObject({ provider: 'mock-activity', origin: 'mock-preset', enabled: true });
    expect(config.adapters.commands.provider).toBe('mock-commands');
  });

  it('live: missing categories are disabled, not mocked', () => {
    const config = load({ dashboard: 'dataMode: live\n', adapters });
    expect(config.adapters.tasks).toMatchObject({ provider: 'hermes-tasks', enabled: true });
    expect(config.adapters.activity).toMatchObject({ provider: null, packageName: null, enabled: false, origin: 'disabled-by-mode' });
    expect(config.adapters.voice.enabled).toBe(false);
    expect(config.warnings.some((w) => w.includes('adapters.memory.provider "mock-memory" is a mock provider'))).toBe(true);
  });

  it('applies adapter resilience defaults and overrides', () => {
    const config = load({
      dashboard: 'dataMode: hybrid\n',
      adapters: 'allowlist:\n  hermes-tasks: "@friday/adapter-hermes-placeholder"\nadapters:\n  tasks:\n    provider: hermes-tasks\n    timeoutMs: 9000\n    retry:\n      maxAttempts: 5\n      jitter: 0.5\n',
    });
    expect(config.adapters.tasks.timeoutMs).toBe(9000);
    expect(config.adapters.tasks.retry).toEqual({ maxAttempts: 5, baseDelayMs: 200, maxDelayMs: 5000, jitter: 0.5 });
    expect(config.adapters.tasks.circuitBreaker).toEqual({ failureThreshold: 5, resetAfterMs: 30000 });
  });

  it('enforces the allowlist and protects built-in mock providers', () => {
    const missing = loadError({ dashboard: 'dataMode: live\n', adapters: 'adapters:\n  tasks:\n    provider: rogue-tasks\n' });
    expect(missing.message).toContain('adapters.tasks.provider: "rogue-tasks" is not in the adapter allowlist');
    const repointed = loadError({ adapters: 'allowlist:\n  mock-tasks: "evil-package"\n' });
    expect(repointed.message).toContain('built-in mock provider');
    expect(loadError({ adapters: 'allowlist:\n  x-y: "../../evil"\n' }).message).toContain('allowlist.x-y');
  });

  it('warns when adapters.yaml mode disagrees with the effective mode', () => {
    expect(load({ adapters: 'mode: live\nadapters: {}\n' }).warnings.some((w) => w.includes('mode "live" ignored'))).toBe(true);
  });
});

describe('secrets', () => {
  const adapters = (body: string) => `allowlist:\n  hermes-tasks: "@friday/adapter-hermes-placeholder"\nadapters:\n  tasks:\n    provider: hermes-tasks\n    config:\n${body}`;

  it('replaces secret references by { ref, configured } and never loads the value', () => {
    const secret = 's3cr3t-token-value-12345';
    const config = load(
      { dashboard: 'dataMode: hybrid\n', adapters: adapters('      apiToken: env:HERMES_API_TOKEN\n      other: env:NOT_SET_ANYWHERE\n      baseUrl: http://x\n') },
      { HERMES_API_TOKEN: secret },
    );
    expect(config.adapters.tasks.config).toEqual({
      apiToken: { ref: 'env:HERMES_API_TOKEN', configured: true },
      other: { ref: 'env:NOT_SET_ANYWHERE', configured: false },
      baseUrl: 'http://x',
    });
    expect(JSON.stringify(config)).not.toContain(secret);
    expect(JSON.stringify(config)).not.toContain('s3cr3t');
  });

  it('exposes the owner password hash only as a reference state', () => {
    const hash = 'scrypt$32768$8$1$AAAA$BBBB';
    const config = load({}, { FRIDAY_OWNER_PASSWORD_HASH: hash });
    expect(config.auth.ownerPasswordHash).toEqual({ ref: 'env:FRIDAY_OWNER_PASSWORD_HASH', configured: true });
    expect(JSON.stringify(config)).not.toContain(hash);
  });

  it('rejects literal values and interpolation on credential-looking fields', () => {
    const literal = loadError({ dashboard: 'dataMode: hybrid\n', adapters: adapters('      apiToken: abc123\n') });
    expect(literal.message).toContain('adapters.tasks.config.apiToken');
    expect(literal.message).toContain('secret reference');
    expect(literal.message).not.toContain('abc123');
    const interpolated = loadError({ dashboard: 'dataMode: hybrid\n', adapters: adapters('      password: ${GMX_PASSWORD}\n') }, { GMX_PASSWORD: 'hunter2-plaintext' });
    expect(interpolated.message).toContain('adapters.tasks.config.password');
    expect(interpolated.message).not.toContain('hunter2-plaintext');
    // descriptive keys are fine
    expect(load({ dashboard: 'dataMode: hybrid\n', adapters: adapters('      tokenUrl: http://auth/token\n      secretPath: /x\n') }).adapters.tasks.config).toEqual({
      tokenUrl: 'http://auth/token',
      secretPath: '/x',
    });
  });

  it('flags malformed references', () => {
    const error = loadError({ dashboard: 'dataMode: hybrid\n', adapters: adapters('      apiToken: "env:not valid!"\n') });
    expect(error.message).toContain('invalid secret reference');
  });

  it('SecretValue never prints', () => {
    const secret = new SecretValue('top-secret');
    expect(String(secret)).toBe('[SECRET]');
    expect(`${secret}`).toBe('[SECRET]');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[SECRET]"}');
    expect(secret.reveal()).toBe('top-secret');
    expect(JSON.stringify(Object.keys(secret))).toBe('[]');
  });

  it('resolves env: references', () => {
    const ok = resolveSecret('env:TOKEN', { env: { TOKEN: 'abc' } });
    expect(ok.ok && ok.secret.reveal()).toBe('abc');
    expect(resolveSecret('env:TOKEN', { env: {} })).toMatchObject({ ok: false, code: 'NOT_SET' });
    expect(resolveSecret('env:TOKEN', { env: { TOKEN: '' } })).toMatchObject({ ok: false, code: 'NOT_SET' });
    expect(resolveSecret('env:1BAD', { env: {} })).toMatchObject({ ok: false, code: 'INVALID_REF' });
    expect(resolveSecret('ftp:x', {})).toMatchObject({ ok: false, code: 'INVALID_REF' });
    expect(describeSecretRef('env:TOKEN', { env: { TOKEN: 'abc' } })).toEqual({ ref: 'env:TOKEN', configured: true });
  });

  it('parses reference grammar', () => {
    expect(parseSecretRef('env:A_B1')).toEqual({ scheme: 'env', name: 'A_B1' });
    expect(parseSecretRef('wincred:friday voice/api')).toEqual({ scheme: 'wincred', name: 'friday voice/api' });
    expect(parseSecretRef("wincred:a'; Remove-Item *")).toBeNull();
    expect(parseSecretRef('wincred:')).toBeNull();
  });

  describe('wincred', () => {
    const fakeSpawn = (status: number | null, stdout = '', error?: Error): SpawnFn => (command, args, options) => {
      expect(command).toBe('powershell.exe');
      expect(args.join(' ')).not.toContain('my-target'); // target is passed via env, not interpolated
      expect(options.env.FRIDAY_WINCRED_TARGET).toBe('my-target');
      return { status, stdout, stderr: '', error };
    };

    it('returns the credential from the CredentialManager module', () => {
      const result = resolveSecret('wincred:my-target', { platform: 'win32', spawn: fakeSpawn(0, 'pw-from-vault') });
      expect(result.ok && result.secret.reveal()).toBe('pw-from-vault');
    });

    it('reports a clear error when the module is missing', () => {
      const result = resolveSecret('wincred:my-target', { platform: 'win32', spawn: fakeSpawn(3) });
      expect(result).toMatchObject({ ok: false, code: 'WINCRED_UNAVAILABLE' });
      expect(!result.ok && result.message).toContain('CredentialManager');
    });

    it('distinguishes not-found, errors and missing PowerShell', () => {
      expect(resolveSecret('wincred:my-target', { platform: 'win32', spawn: fakeSpawn(4) })).toMatchObject({ code: 'WINCRED_NOT_FOUND' });
      expect(resolveSecret('wincred:my-target', { platform: 'win32', spawn: fakeSpawn(1) })).toMatchObject({ code: 'WINCRED_ERROR' });
      expect(resolveSecret('wincred:my-target', { platform: 'win32', spawn: fakeSpawn(null, '', new Error('spawn ENOENT')) })).toMatchObject({ code: 'WINCRED_UNAVAILABLE' });
      expect(resolveSecret('wincred:my-target', { platform: 'linux' })).toMatchObject({ code: 'WINCRED_UNAVAILABLE' });
    });

    it('config marks wincred refs configured without leaking the value', () => {
      const config = loadConfig({
        configDir: setup({
          dashboard: 'dataMode: hybrid\n',
          adapters: adapters('      apiToken: wincred:my-target\n'),
        }),
        env: {},
        secrets: { platform: 'win32', spawn: fakeSpawn(0, 'vault-secret') },
      });
      expect(config.adapters.tasks.config).toEqual({ apiToken: { ref: 'wincred:my-target', configured: true } });
      expect(JSON.stringify(config)).not.toContain('vault-secret');
    });

    it('never puts secret material into error messages', () => {
      const result = resolveSecret('wincred:my-target', { platform: 'win32', spawn: () => ({ status: 1, stdout: 'leaky-secret', stderr: 'leaky-secret', error: undefined }) });
      expect(JSON.stringify(result)).not.toContain('leaky-secret');
    });
  });
});

describe('example files', () => {
  const root = resolve(import.meta.dirname, '..', '..', '..');
  const fixture = (name: string) => readFileSync(join(root, 'config', name), 'utf8');

  it('load cleanly in mock mode and cover all 15 categories', () => {
    const config = load({ dashboard: fixture('dashboard.example.yaml'), adapters: fixture('adapters.example.yaml') });
    expect(Object.keys(config.adapters)).toHaveLength(15);
    expect(ADAPTER_CATEGORIES).toHaveLength(15);
    for (const category of ADAPTER_CATEGORIES) {
      expect(config.adapters[category]).toMatchObject({ provider: `mock-${category}`, origin: 'configured', enabled: true });
    }
    expect(config.warnings).toEqual([]);
  });

  it('hybrid and live example files load with the real adapter providers', () => {
    const hybrid = load({ dashboard: 'dataMode: hybrid\n', adapters: fixture('adapters.hybrid.example.yaml') }, {});
    expect(hybrid.adapters.tasks).toMatchObject({ provider: 'hermes-tasks', enabled: true });
    expect(hybrid.adapters.voice.provider).toBe('friday-voice-http');
    expect(hybrid.adapters.system.provider).toBe('local-system');
    expect(hybrid.adapters.memory.provider).toBe('mock-memory');
    // Registry-level retry stays opt-in: one attempt unless a category configures more.
    expect(hybrid.adapters.tasks.retry).toMatchObject({ maxAttempts: 1 });
    const live = load({ dashboard: 'dataMode: live\n', adapters: fixture('adapters.live.example.yaml') }, {});
    expect(live.adapters.tasks.provider).toBe('hermes-tasks');
    expect(live.adapters.memory.enabled).toBe(false);
  });

  it('.env.example contains no real values', () => {
    const env = readFileSync(join(root, '.env.example'), 'utf8');
    for (const line of env.split('\n')) {
      if (line.startsWith('#') || !line.includes('=')) continue;
      const value = line.slice(line.indexOf('=') + 1).trim();
      expect(['', 'http://127.0.0.1:3100']).toContain(value);
    }
  });
});
