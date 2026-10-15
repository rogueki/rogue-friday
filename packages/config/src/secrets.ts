import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { inspect } from 'node:util';

export const SECRET_REF_PATTERN = /^(env|wincred|file):(.*)$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Conservative target charset: it is handed to PowerShell via an environment variable, never interpolated. */
const WINCRED_TARGET = /^[A-Za-z0-9_.:@/ -]{1,256}$/;

/** Key files are tiny; anything bigger is a misconfigured path (e.g. a log) and is refused. */
const FILE_MAX_BYTES = 64 * 1024;
const FILE_PATH_MAX = 1024;

export type SecretScheme = 'env' | 'wincred' | 'file';

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
  if (scheme === 'file' && !isAbsoluteFilePath(name)) return null;
  return { scheme, name };
}

/** `file:` references must be absolute (POSIX or Windows style, forward slashes allowed) so the result never depends on the cwd. */
function isAbsoluteFilePath(path: string): boolean {
  return path.length > 0 && path.length <= FILE_PATH_MAX && !path.includes('\0') && (win32.isAbsolute(path) || posix.isAbsolute(path)) && !/^[\\/]{2}[?.]/.test(path);
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

export type SecretErrorCode =
  | 'INVALID_REF'
  | 'NOT_SET'
  | 'WINCRED_UNAVAILABLE'
  | 'WINCRED_NOT_FOUND'
  | 'WINCRED_ERROR'
  | 'FILE_NOT_FOUND'
  | 'FILE_EMPTY'
  | 'FILE_ERROR';
export type SecretResolution = { ok: true; secret: SecretValue } | { ok: false; code: SecretErrorCode; message: string };

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}
export type SpawnFn = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }) => SpawnResult;

/** Reads a key file as UTF-8 text; throws like `fs.readFileSync` (tests inject a fake). */
export type ReadSecretFileFn = (path: string, maxBytes: number) => string;

export interface ResolveSecretOptions {
  env?: NodeJS.ProcessEnv;
  /** Used by `file:` references. Defaults to a size-limited `readFileSync`. */
  readFile?: ReadSecretFileFn;
  platform?: NodeJS.Platform;
  spawn?: SpawnFn;
  timeoutMs?: number;
}

const WINCRED_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "if (-not (Get-Module -ListAvailable -Name CredentialManager)) { exit 3 }",
  'Import-Module CredentialManager',
  '$cred = Get-StoredCredential -Target $env:FRIDAY_WINCRED_TARGET',
  'if ($null -eq $cred) { exit 4 }',
  '[Console]::Out.Write($cred.GetNetworkCredential().Password)',
].join('; ');

const defaultReadFile: ReadSecretFileFn = (path, maxBytes) => {
  if (statSync(path).size > maxBytes) throw Object.assign(new Error('file too large'), { code: 'E_TOO_LARGE' });
  return readFileSync(path, 'utf8');
};

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
 * Resolves `env:NAME`, `file:ABSOLUTE_PATH` or `wincred:TARGET`. `file:` reads the file server-side on every call (so a rotated
 * key is picked up), strips a BOM and surrounding whitespace/newlines and never echoes the content. `wincred:` uses the PowerShell `CredentialManager` module
 * (`Get-StoredCredential`), which is not installed by default; without it the result is a clear
 * WINCRED_UNAVAILABLE error. Error messages never contain secret material.
 */
export function resolveSecret(ref: string, options: ResolveSecretOptions = {}): SecretResolution {
  const parsed = parseSecretRef(ref);
  if (!parsed) {
    return { ok: false, code: 'INVALID_REF', message: `Invalid secret reference "${truncate(ref)}": expected env:NAME, file:ABSOLUTE_PATH or wincred:TARGET` };
  }

  if (parsed.scheme === 'env') {
    const value = (options.env ?? process.env)[parsed.name];
    if (value === undefined || value === '') {
      return { ok: false, code: 'NOT_SET', message: `Environment variable ${parsed.name} is not set` };
    }
    return { ok: true, secret: new SecretValue(value) };
  }

  if (parsed.scheme === 'file') return resolveFileSecret(parsed.name, options.readFile ?? defaultReadFile);

  if ((options.platform ?? process.platform) !== 'win32') {
    return { ok: false, code: 'WINCRED_UNAVAILABLE', message: 'wincred: references need Windows Credential Manager (not available on this platform)' };
  }
  const spawn = options.spawn ?? defaultSpawn;
  const result = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINCRED_SCRIPT], {
    env: { ...(options.env ?? process.env), FRIDAY_WINCRED_TARGET: parsed.name },
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

function resolveFileSecret(path: string, readFile: ReadSecretFileFn): SecretResolution {
  let text: string;
  try {
    text = readFile(path, FILE_MAX_BYTES);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, code: 'FILE_NOT_FOUND', message: `Secret file "${truncate(path)}" does not exist` };
    if (code === 'E_TOO_LARGE') return { ok: false, code: 'FILE_ERROR', message: `Secret file "${truncate(path)}" is larger than ${FILE_MAX_BYTES} bytes` };
    // The error text of fs calls names the path and the errno only; it never contains file content.
    return { ok: false, code: 'FILE_ERROR', message: `Secret file "${truncate(path)}" cannot be read (${code ?? 'unknown error'})` };
  }
  const value = text.replace(/^\uFEFF/, '').trim();
  if (value === '') return { ok: false, code: 'FILE_EMPTY', message: `Secret file "${truncate(path)}" is empty` };
  return { ok: true, secret: new SecretValue(value) };
}

/** Describes a reference without exposing the value. */
export function describeSecretRef(ref: string, options: ResolveSecretOptions = {}): SecretRefState {
  return { ref, configured: resolveSecret(ref, options).ok };
}

function truncate(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}...` : value;
}
