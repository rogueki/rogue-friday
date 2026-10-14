import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hkdfSync, randomBytes } from 'node:crypto';
import { join } from 'node:path';

export const SERVER_KEY_FILE = 'auth.key';
const KEY_BYTES = 32;

export interface ServerKey {
  /** Master key. Never log it. */
  key: Buffer;
  path: string;
  created: boolean;
  /** True when file permissions were restricted to the current user (best effort on Windows). */
  permissionsRestricted: boolean;
}

/**
 * Restricts a file to the current user: chmod 600 on POSIX, `icacls` (remove inheritance, grant only the
 * current user) on Windows. Returns false when it could not be verified; callers surface a warning.
 */
export function restrictFilePermissions(path: string): boolean {
  if (process.platform !== 'win32') {
    try {
      chmodSync(path, 0o600);
      return true;
    } catch {
      return false;
    }
  }
  const user = process.env.USERNAME;
  if (!user) return false;
  const domain = process.env.USERDOMAIN;
  const principal = domain ? `${domain}\\${user}` : user;
  try {
    execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${principal}:(R,W)`], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads the server secret from `<dataDir>/auth.key`, generating it on first start. It seeds the CSRF and
 * approval-token keys (via {@link deriveKey}) and is never part of any API response or log.
 */
export function loadOrCreateServerKey(dataDir: string): ServerKey {
  const path = join(dataDir, SERVER_KEY_FILE);
  mkdirSync(dataDir, { recursive: true });

  if (!existsSync(path)) {
    try {
      // `wx` makes concurrent first starts race safely: exactly one writer wins.
      writeFileSync(path, randomBytes(KEY_BYTES).toString('base64'), { flag: 'wx', mode: 0o600 });
      const restricted = restrictFilePermissions(path);
      return { key: readKey(path), path, created: true, permissionsRestricted: restricted };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  return { key: readKey(path), path, created: false, permissionsRestricted: restrictFilePermissions(path) };
}

function readKey(path: string): Buffer {
  const key = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new Error(`Server key file ${path} is corrupt (expected ${KEY_BYTES} bytes)`);
  return key;
}

/** Domain-separated sub-key so CSRF and approval tokens can never be replayed against each other. */
export function deriveKey(masterKey: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), `jarvis/${purpose}/v1`, KEY_BYTES));
}
