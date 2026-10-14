import type { AdapterCategory, DataMode } from './categories';
import type { SecretRefState } from './secrets';

export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetAfterMs: number;
}

/**
 * Where a category's effective provider came from:
 * - `configured`: listed in adapters.yaml
 * - `mock-preset`: mock-* provider supplied by the mode preset
 * - `mock-forced`: adapters.yaml named a live provider but mock mode overrides it
 * - `disabled-by-mode`: live mode and the category is not configured
 */
export type AdapterOrigin = 'configured' | 'mock-preset' | 'mock-forced' | 'disabled-by-mode';

export interface ResolvedAdapterConfig {
  category: AdapterCategory;
  /** Null only when the category is disabled by `live` mode. */
  provider: string | null;
  /** npm package that implements the provider (from the allowlist). */
  packageName: string | null;
  enabled: boolean;
  origin: AdapterOrigin;
  /** Adapter settings. Secret fields are `SecretRefState` objects, never values. */
  config: Readonly<Record<string, unknown>>;
  timeoutMs: number;
  retry: RetryConfig;
  circuitBreaker: CircuitBreakerConfig;
}

export interface JarvisConfig {
  /** Absolute config directory the files were read from. */
  configDir: string;
  files: { dashboard: string | null; adapters: string | null };
  dataMode: DataMode;
  server: { host: string; port: number; allowRemote: boolean };
  /** True when the listener is reachable beyond loopback: TLS or VPN/zero-trust is mandatory (PLAN §49.7). */
  remoteAccess: boolean;
  paths: { dataDir: string; logDir: string; backupDir: string; webRoot: string };
  auth: {
    mode: 'local' | 'dev';
    ownerUsername: string;
    ownerPasswordHash: SecretRefState;
    sessionTtlMinutes: number;
    reauthWindowMinutes: number;
    idleTimeoutMinutes: number;
    secureCookies: boolean;
  };
  realtime: { ringBufferSize: number; heartbeatSeconds: number };
  ui: { locale: string; timezone: string; theme: string; layout: string };
  dev: { scenarioConsole: boolean; responseValidation: boolean };
  logging: { level: LogLevelName; redactEmails: boolean; file: { enabled: boolean; maxBytes: number; maxFiles: number } };
  adapters: Readonly<Record<AdapterCategory, ResolvedAdapterConfig>>;
  /** Merged provider id -> package allowlist (built-in mock providers + adapters.yaml). */
  allowlist: Readonly<Record<string, string>>;
  /** Non-fatal findings (ignored settings, TLS/VPN requirement, missing files). */
  warnings: readonly string[];
}
