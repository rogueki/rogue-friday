import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';

export const SECRET_REF_PATTERN = /^(env|wincred):(.*)$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Conservative target charset: it is handed to PowerShell via an environment variable, never interpolated. */
const WINCRED_TARGET = /^[A-Za-z0-9_.:@/ -]{1,256}$/;

export type SecretScheme = 'env' | 'wincred';

export interface ParsedSecretRef {
  scheme: SecretScheme;
  name: string;
}

/** `{ ref, configured }` is all a config consumer ever sees about a secret. */
export interface SecretRefState {
  ref: string;
  configured: boolean;
}

export function looksLikeSecretRef(value: unknown): value is string {
  return typeof value === 'string' && SECRET_REF_PATTERN.test(value);
}

export function isSecretRefState(value: unknown): value is SecretRefState {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 2 &&
    typeof (value as SecretRefState).ref === 'string' &&
    typeof (value as SecretRefState).configured === 'boolean'
  );
}

export function parseSecretRef(ref: string): ParsedSecretRef | null {
  const match = SECRET_REF_PATTERN.exec(ref);
  if (!match) return null;
  const scheme = match[1] as SecretScheme;
  const name = match[2] ?? '';
  if (scheme === 'env' && !ENV_NAME.test(name)) return null;
  if (scheme === 'wincred' && !WINCRED_TARGET.test(name)) return null;
  return { scheme, name };
}

/** Holds a resolved secret; printing, JSON-serialising or inspecting it yields a placeholder. */
export class SecretValue {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  toString(): string {
    return '[SECRET]';
  }
  toJSON(): string {
    return '[SECRET]';
  }
  [inspect.custom](): string {
    return 'SecretValue { [SECRET] }';
  }
}

export type SecretErrorCode = 'INVALID_REF' | 'NOT_SET' | 'WINCRED_UNAVAILABLE' | 'WINCRED_NOT_FOUND' | 'WINCRED_ERROR';
export type SecretResolution = { ok: true; secret: SecretValue } | { ok: false; code: SecretErrorCode; message: string };

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}
export type SpawnFn = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }) => SpawnResult;

export interface ResolveSecretOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawn?: SpawnFn;
  timeoutMs?: number;
}

const WINCRED_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "if (-not (Get-Module -ListAvailable -Name CredentialManager)) { exit 3 }",
  'Import-Module CredentialManager',
  '$cred = Get-StoredCredential -Target $env:JARVIS_WINCRED_TARGET',
  'if ($null -eq $cred) { exit 4 }',
  '[Console]::Out.Write($cred.GetNetworkCredential().Password)',
].join('; ');

const defaultSpawn: SpawnFn = (command, args, options) => {
  const result = spawnSync(command, args, {
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    windowsHide: true,
    shell: false,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
};

/**
 * Resolves `env:NAME` or `wincred:TARGET`. `wincred:` uses the PowerShell `CredentialManager` module
 * (`Get-StoredCredential`), which is not installed by default; without it the result is a clear
 * WINCRED_UNAVAILABLE error. Error messages never contain secret material.
 */
export function resolveSecret(ref: string, options: ResolveSecretOptions = {}): SecretResolution {
  const parsed = parseSecretRef(ref);
  if (!parsed) {
    return { ok: false, code: 'INVALID_REF', message: `Invalid secret reference "${truncate(ref)}": expected env:NAME or wincred:TARGET` };
  }

  if (parsed.scheme === 'env') {
    const value = (options.env ?? process.env)[parsed.name];
    if (value === undefined || value === '') {
      return { ok: false, code: 'NOT_SET', message: `Environment variable ${parsed.name} is not set` };
    }
    return { ok: true, secret: new SecretValue(value) };
  }

  if ((options.platform ?? process.platform) !== 'win32') {
    return { ok: false, code: 'WINCRED_UNAVAILABLE', message: 'wincred: references need Windows Credential Manager (not available on this platform)' };
  }
  const spawn = options.spawn ?? defaultSpawn;
  const result = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINCRED_SCRIPT], {
    env: { ...(options.env ?? process.env), JARVIS_WINCRED_TARGET: parsed.name },
    timeoutMs: options.timeoutMs ?? 15_000,
  });
  if (result.error) {
    return { ok: false, code: 'WINCRED_UNAVAILABLE', message: `PowerShell could not be started (${result.error.message})` };
  }
  switch (result.status) {
    case 0:
      return result.stdout.length > 0
        ? { ok: true, secret: new SecretValue(result.stdout) }
        : { ok: false, code: 'WINCRED_NOT_FOUND', message: `Credential "${parsed.name}" is empty` };
    case 3:
      return {
        ok: false,
        code: 'WINCRED_UNAVAILABLE',
        message: 'wincred: not available - PowerShell module "CredentialManager" is not installed (Install-Module CredentialManager). Use env: references instead.',
      };
    case 4:
      return { ok: false, code: 'WINCRED_NOT_FOUND', message: `No Windows credential found for target "${parsed.name}"` };
    default:
      return { ok: false, code: 'WINCRED_ERROR', message: `Credential lookup failed (PowerShell exit code ${String(result.status)})` };
  }
}

/** Describes a reference without exposing the value. */
export function describeSecretRef(ref: string, options: ResolveSecretOptions = {}): SecretRefState {
  return { ref, configured: resolveSecret(ref, options).ok };
}

function truncate(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}...` : value;
}
