import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import {
  ADAPTER_CATEGORIES,
  DATA_MODES,
  builtinAllowlist,
  isMockProvider,
  mockProviderId,
  type AdapterCategory,
  type DataMode,
} from './categories';
import { ConfigError, type ConfigProblem } from './errors';
import { interpolateTree, type InterpolationMiss } from './interpolate';
import { describeSecretRef, looksLikeSecretRef, parseSecretRef, type ResolveSecretOptions } from './secrets';
import type { JarvisConfig, ResolvedAdapterConfig } from './types';
import { validateDocument } from './validate';

export interface LoadConfigOptions {
  /** Directory with dashboard.yaml / adapters.yaml. Falls back to `env.JARVIS_CONFIG_DIR`, then `<cwd>/config`. */
  configDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Base for relative env path overrides. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Passed to the secret resolver when checking `configured` (tests inject a fake PowerShell). */
  secrets?: ResolveSecretOptions;
}

type Tree = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- validated by AJV right after parsing

const DASHBOARD_FILE = 'dashboard.yaml';
const ADAPTERS_FILE = 'adapters.yaml';

/** Keys that look like they hold a credential and therefore must be secret references. */
const SECRET_KEY = /(password|passwd|passphrase|secret|token|api[-_]?key|authorization|credential|private[-_]?key)/i;
/** `tokenUrl`, `secretPath`, ... describe where a secret lives, not the secret itself. */
const SECRET_KEY_EXEMPT_SUFFIX = /(url|uri|path|file|header|name|field|type|endpoint|ttl|count|length|ref)$/i;

export function loadConfig(options: LoadConfigOptions = {}): JarvisConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const problems: ConfigProblem[] = [];
  const warnings: string[] = [];

  const configDir = resolve(cwd, options.configDir ?? env.JARVIS_CONFIG_DIR ?? 'config');

  const dashboardRead = readYaml(join(configDir, DASHBOARD_FILE), DASHBOARD_FILE, problems);
  const adaptersRead = readYaml(join(configDir, ADAPTERS_FILE), ADAPTERS_FILE, problems);
  if (!dashboardRead.found) warnings.push(`${DASHBOARD_FILE} not found in ${configDir}; using defaults (mock mode)`);
  if (!adaptersRead.found) warnings.push(`${ADAPTERS_FILE} not found in ${configDir}; using the mode preset for all categories`);

  // ---- dashboard.yaml -------------------------------------------------------------------------
  const dashboardMisses: InterpolationMiss[] = [];
  const dashboard = interpolateTree(dashboardRead.data, env, dashboardMisses) as Tree;
  reportMisses(dashboardMisses, DASHBOARD_FILE, problems);
  applyEnvOverrides(dashboard, env, cwd, problems);
  problems.push(...validateDocument('dashboard', dashboard, DASHBOARD_FILE));
  const dashboardValid = problems.length === 0;

  // ---- adapters.yaml --------------------------------------------------------------------------
  const adaptersMisses: InterpolationMiss[] = [];
  const adaptersRaw = interpolateAdapters(adaptersRead.data, env, adaptersMisses);
  reportMisses(adaptersMisses, ADAPTERS_FILE, problems);
  problems.push(...validateDocument('adapters', adaptersRaw, ADAPTERS_FILE));

  // Semantic checks dereference validated structures, so they only run on documents that passed the
  // schema; everything found up to here is still reported in a single ConfigError.
  if (!dashboardValid || problems.length > 0) {
    if (dashboardValid) validateSemantics(dashboard, problems, warnings);
    throw new ConfigError(problems);
  }

  const dataMode = dashboard.dataMode as DataMode;
  const server = dashboard.server as JarvisConfig['server'];
  const authSection = dashboard.auth as Tree;

  validateSemantics(dashboard, problems, warnings);

  const allowlist = mergeAllowlist(adaptersRaw.allowlist as Record<string, string>, problems);
  if (adaptersRaw.mode !== undefined && adaptersRaw.mode !== dataMode) {
    warnings.push(`${ADAPTERS_FILE}: mode "${String(adaptersRaw.mode)}" ignored; effective data mode is "${dataMode}" (dashboard.yaml / JARVIS_DATA_MODE)`);
  }
  const adapters = resolveAdapters(dataMode, adaptersRaw.adapters as Tree, allowlist, options.secrets ?? { env }, problems, warnings);

  if (problems.length > 0) throw new ConfigError(problems);

  const loopback = isLoopback(server.host);
  const remoteAccess = !loopback;
  if (remoteAccess) {
    warnings.push(
      `server.host "${server.host}" is reachable beyond loopback: run the dashboard only behind TLS or a VPN/zero-trust gateway, never via an open port forward (PLAN §49.7)`,
    );
    if (!authSection.secureCookies) warnings.push('server.allowRemote is on but auth.secureCookies is false: session cookies would travel without the Secure flag');
  }

  const paths = dashboard.paths as Record<string, string>;
  const dev = dashboard.dev as { scenarioConsole?: boolean; responseValidation?: boolean };
  const secretOptions = options.secrets ?? { env };

  const config: JarvisConfig = {
    configDir,
    files: {
      dashboard: dashboardRead.found ? join(configDir, DASHBOARD_FILE) : null,
      adapters: adaptersRead.found ? join(configDir, ADAPTERS_FILE) : null,
    },
    dataMode,
    server: { host: server.host, port: server.port, allowRemote: server.allowRemote },
    remoteAccess,
    paths: {
      dataDir: resolvePath(configDir, paths.dataDir as string),
      logDir: resolvePath(configDir, paths.logDir as string),
      backupDir: resolvePath(configDir, paths.backupDir as string),
      webRoot: resolvePath(configDir, paths.webRoot as string),
    },
    auth: {
      mode: authSection.mode,
      ownerUsername: authSection.ownerUsername,
      ownerPasswordHash: describeSecretRef(authSection.ownerPasswordHash as string, secretOptions),
      sessionTtlMinutes: authSection.sessionTtlMinutes,
      reauthWindowMinutes: authSection.reauthWindowMinutes,
      idleTimeoutMinutes: authSection.idleTimeoutMinutes,
      secureCookies: authSection.secureCookies,
    },
    realtime: dashboard.realtime as JarvisConfig['realtime'],
    ui: dashboard.ui as JarvisConfig['ui'],
    dev: {
      scenarioConsole: dev.scenarioConsole ?? dataMode === 'mock',
      responseValidation: dev.responseValidation ?? dataMode !== 'live',
    },
    logging: dashboard.logging as JarvisConfig['logging'],
    adapters,
    allowlist,
    warnings,
  };
  return deepFreeze(config);
}

// ---------------------------------------------------------------------------------------------

function readYaml(path: string, source: string, problems: ConfigProblem[]): { found: boolean; data: Tree } {
  if (!existsSync(path)) return { found: false, data: {} };
  let text: string;
  try {
    text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    problems.push({ source, path: '', message: `cannot read file: ${error instanceof Error ? error.message : String(error)}` });
    return { found: true, data: {} };
  }
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      const line = error.linePos?.[0]?.line;
      problems.push({ source, path: '', message: `YAML syntax error${line ? ` (line ${line})` : ''}: ${error.message.split('\n')[0]}` });
    }
    return { found: true, data: {} };
  }
  const data = doc.toJS({ maxAliasCount: 50 }) as unknown;
  if (data === null || data === undefined) return { found: true, data: {} };
  if (typeof data !== 'object' || Array.isArray(data)) {
    problems.push({ source, path: '', message: 'top level must be a mapping' });
    return { found: true, data: {} };
  }
  return { found: true, data: data as Tree };
}

function reportMisses(misses: readonly InterpolationMiss[], source: string, problems: ConfigProblem[]): void {
  for (const miss of misses) {
    problems.push({ source, path: miss.path, message: `environment variable ${miss.variable} is not set (use \${${miss.variable}:-default} for an optional value)` });
  }
}

/** Disabled categories may reference variables that are not set yet (e.g. a live adapter prepared in advance). */
function interpolateAdapters(raw: Tree, env: NodeJS.ProcessEnv, misses: InterpolationMiss[]): Tree {
  const out: Tree = { ...raw };
  for (const [key, value] of Object.entries(raw)) {
    if (key !== 'adapters' || value === null || typeof value !== 'object') {
      out[key] = interpolateTree(value, env, misses, key);
      continue;
    }
    const adapters: Tree = {};
    for (const [category, entry] of Object.entries(value as Tree)) {
      const disabled = entry !== null && typeof entry === 'object' && (entry as Tree).enabled === false;
      adapters[category] = interpolateTree(entry, env, disabled ? [] : misses, `adapters.${category}`);
    }
    out[key] = adapters;
  }
  return out;
}

function applyEnvOverrides(dashboard: Tree, env: NodeJS.ProcessEnv, cwd: string, problems: ConfigProblem[]): void {
  const set = (section: string, key: string, value: unknown): void => {
    const target = (dashboard[section] ??= {}) as Tree;
    if (typeof target !== 'object' || target === null) return; // schema validation reports the wrong type
    target[key] = value;
  };
  if (env.JARVIS_DATA_MODE) {
    if (!(DATA_MODES as readonly string[]).includes(env.JARVIS_DATA_MODE)) {
      problems.push({ source: 'env', path: 'JARVIS_DATA_MODE', message: `must be one of: ${DATA_MODES.join(', ')} (got ${JSON.stringify(env.JARVIS_DATA_MODE)})` });
    } else {
      dashboard.dataMode = env.JARVIS_DATA_MODE;
    }
  }
  if (env.JARVIS_HOST) set('server', 'host', env.JARVIS_HOST);
  if (env.JARVIS_PORT) {
    const port = Number(env.JARVIS_PORT);
    if (!/^\d+$/.test(env.JARVIS_PORT) || port < 1 || port > 65535) {
      problems.push({ source: 'env', path: 'JARVIS_PORT', message: `must be an integer between 1 and 65535 (got ${JSON.stringify(env.JARVIS_PORT)})` });
    } else {
      set('server', 'port', port);
    }
  }
  if (env.JARVIS_DATA_DIR) set('paths', 'dataDir', resolve(cwd, env.JARVIS_DATA_DIR));
  if (env.JARVIS_LOG_DIR) set('paths', 'logDir', resolve(cwd, env.JARVIS_LOG_DIR));
}

function validateSemantics(dashboard: Tree, problems: ConfigProblem[], warnings: string[]): void {
  const server = dashboard.server as JarvisConfig['server'];
  if (!isLoopback(server.host) && !server.allowRemote) {
    problems.push({
      source: 'dashboard.yaml',
      path: 'server.host',
      message: `"${server.host}" is not a loopback address. The dashboard binds to localhost only; set server.allowRemote: true to expose it (then TLS or VPN/zero-trust is required, PLAN §49.7)`,
    });
  }
  if (dashboard.auth.mode === 'dev' && (dashboard.dataMode !== 'mock' || !isLoopback(server.host))) {
    problems.push({
      source: 'dashboard.yaml',
      path: 'auth.mode',
      message: 'dev auth is only allowed with dataMode "mock" and a loopback host',
    });
  }
  if (dashboard.auth.reauthWindowMinutes > dashboard.auth.sessionTtlMinutes) {
    warnings.push('auth.reauthWindowMinutes exceeds auth.sessionTtlMinutes; re-authentication will never expire within a session');
  }
  const ui = dashboard.ui as { locale: string; timezone: string };
  try {
    Intl.getCanonicalLocales(ui.locale);
  } catch {
    problems.push({ source: 'dashboard.yaml', path: 'ui.locale', message: `"${ui.locale}" is not a valid locale` });
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: ui.timezone });
  } catch {
    problems.push({ source: 'dashboard.yaml', path: 'ui.timezone', message: `"${ui.timezone}" is not a valid IANA time zone` });
  }
}

function mergeAllowlist(custom: Record<string, string>, problems: ConfigProblem[]): Record<string, string> {
  const merged = builtinAllowlist();
  for (const [provider, pkg] of Object.entries(custom)) {
    if (merged[provider] !== undefined && merged[provider] !== pkg) {
      problems.push({ source: 'adapters.yaml', path: `allowlist.${provider}`, message: `"${provider}" is a built-in mock provider and cannot be re-pointed to "${pkg}"` });
      continue;
    }
    merged[provider] = pkg;
  }
  return merged;
}

function resolveAdapters(
  mode: DataMode,
  configured: Tree,
  allowlist: Record<string, string>,
  secretOptions: ResolveSecretOptions,
  problems: ConfigProblem[],
  warnings: string[],
): Record<AdapterCategory, ResolvedAdapterConfig> {
  const out = {} as Record<AdapterCategory, ResolvedAdapterConfig>;
  for (const category of ADAPTER_CATEGORIES) {
    const entry = configured[category] as Tree | undefined;
    const mock = mockProviderId(category);
    // Registry-level retry is opt-in (1 attempt): the adapters' HTTP clients already retry transport errors, and
    // stacking both multiplies attempts and timeouts during an outage.
    const defaults = { timeoutMs: 5000, retry: { maxAttempts: 1, baseDelayMs: 200, maxDelayMs: 5000, jitter: 0.2 }, circuitBreaker: { failureThreshold: 5, resetAfterMs: 30000 } };

    if (!entry) {
      out[category] =
        mode === 'live'
          ? { category, provider: null, packageName: null, enabled: false, origin: 'disabled-by-mode', config: {}, ...defaults }
          : { category, provider: mock, packageName: allowlist[mock] ?? null, enabled: true, origin: 'mock-preset', config: {}, ...defaults };
      continue;
    }

    let provider = entry.provider as string;
    let origin: ResolvedAdapterConfig['origin'] = 'configured';
    let rawConfig = entry.config as Tree;
    if (mode === 'mock' && !isMockProvider(provider)) {
      warnings.push(`adapters.${category}.provider "${provider}" ignored: data mode is "mock", using ${mock}`);
      provider = mock;
      origin = 'mock-forced';
      rawConfig = {};
    } else if (mode === 'live' && isMockProvider(provider) && entry.enabled) {
      warnings.push(`adapters.${category}.provider "${provider}" is a mock provider while data mode is "live"`);
    }

    if (entry.enabled && allowlist[provider] === undefined) {
      problems.push({
        source: 'adapters.yaml',
        path: `adapters.${category}.provider`,
        message: `"${provider}" is not in the adapter allowlist (add "${provider}: <package>" under allowlist)`,
      });
    }

    out[category] = {
      category,
      provider,
      packageName: allowlist[provider] ?? null,
      enabled: entry.enabled,
      origin,
      config: protectSecrets(rawConfig, `adapters.${category}.config`, secretOptions, problems) as Record<string, unknown>,
      timeoutMs: entry.timeoutMs,
      retry: entry.retry,
      circuitBreaker: entry.circuitBreaker,
    };
    if (entry.retry.baseDelayMs > entry.retry.maxDelayMs) {
      warnings.push(`adapters.${category}.retry.baseDelayMs exceeds maxDelayMs; the delay will be capped at maxDelayMs`);
    }
  }
  return out;
}

/**
 * Replaces secret references in an adapter config by `{ ref, configured }` and rejects literal values on
 * credential-looking keys, so a secret can never end up in the config object (PLAN §42.2, §49.6).
 */
function protectSecrets(value: unknown, path: string, secretOptions: ResolveSecretOptions, problems: ConfigProblem[], key = ''): unknown {
  if (typeof value === 'string') {
    if (looksLikeSecretRef(value)) {
      if (!parseSecretRef(value)) {
        problems.push({ source: 'adapters.yaml', path, message: 'invalid secret reference (expected env:NAME, file:ABSOLUTE_PATH or wincred:TARGET)' });
        return { ref: value, configured: false };
      }
      return describeSecretRef(value, secretOptions);
    }
    if (value !== '' && SECRET_KEY.test(key) && !SECRET_KEY_EXEMPT_SUFFIX.test(key)) {
      problems.push({
        source: 'adapters.yaml',
        path,
        message: 'credential-looking field must be a secret reference ("env:NAME", "file:ABSOLUTE_PATH" or "wincred:TARGET"), not a literal value or ${...} interpolation',
      });
      return '';
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => protectSecrets(item, `${path}[${index}]`, secretOptions, problems, key));
  if (value !== null && typeof value === 'object') {
    const out: Tree = {};
    for (const [childKey, child] of Object.entries(value)) out[childKey] = protectSecrets(child, `${path}.${childKey}`, secretOptions, problems, childKey);
    return out;
  }
  return value;
}

export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

function resolvePath(base: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
