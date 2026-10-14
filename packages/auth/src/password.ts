import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const SCRYPT_DEFAULTS = { N: 1 << 15, r: 8, p: 1, saltBytes: 16, keyBytes: 32 } as const;

/** Upper bounds protect against a tampered stored hash forcing absurd CPU/memory use. */
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Node's default maxmem (32 MiB) is exactly what N=2^15, r=8 needs; give it headroom. */
function maxmemFor(N: number, r: number, p: number): number {
  return 128 * r * (N + p + 2) + 1024 * 1024;
}

export interface HashOptions {
  N?: number;
  r?: number;
  p?: number;
}

/** Returns `scrypt$N$r$p$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string, options: HashOptions = {}): Promise<string> {
  if (password.length === 0) throw new Error('Password must not be empty');
  const N = options.N ?? SCRYPT_DEFAULTS.N;
  const r = options.r ?? SCRYPT_DEFAULTS.r;
  const p = options.p ?? SCRYPT_DEFAULTS.p;
  const salt = randomBytes(SCRYPT_DEFAULTS.saltBytes);
  const key = await scryptAsync(password, salt, SCRYPT_DEFAULTS.keyBytes, { N, r, p, maxmem: maxmemFor(N, r, p) });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

export function parsePasswordHash(encoded: string): ParsedHash | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || r < 1 || r > MAX_R || p < 1 || p > MAX_P) return null;
  const salt = Buffer.from(saltB64, 'base64');
  const hash = Buffer.from(hashB64, 'base64');
  if (salt.length < 8 || hash.length < 16) return null;
  return { N, r, p, salt, hash };
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. A missing/invalid stored hash still burns one scrypt computation so that
 * "unknown user" and "wrong password" take comparable time.
 */
export async function verifyPassword(password: string, encoded: string | null | undefined): Promise<boolean> {
  const parsed = encoded ? parsePasswordHash(encoded) : null;
  if (!parsed) {
    dummyHash ??= hashPassword('jarvis-dummy-password');
    const dummy = parsePasswordHash(await dummyHash);
    if (dummy) await scryptAsync(password, dummy.salt, dummy.hash.length, { N: dummy.N, r: dummy.r, p: dummy.p, maxmem: maxmemFor(dummy.N, dummy.r, dummy.p) });
    return false;
  }
  const candidate = await scryptAsync(password, parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: maxmemFor(parsed.N, parsed.r, parsed.p),
  });
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

/** True when the stored hash uses weaker parameters than the current defaults. */
export function needsRehash(encoded: string): boolean {
  const parsed = parsePasswordHash(encoded);
  return !parsed || parsed.N < SCRYPT_DEFAULTS.N || parsed.r < SCRYPT_DEFAULTS.r || parsed.p < SCRYPT_DEFAULTS.p;
}
