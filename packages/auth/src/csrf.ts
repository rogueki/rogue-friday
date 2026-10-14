import { createHmac, timingSafeEqual } from 'node:crypto';

export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isCsrfProtectedMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Double-submit token bound to the session: HMAC-SHA256(key, sessionId), base64url.
 * A token minted for one session never validates for another, and an attacker who can plant a cookie
 * (sub-domain, MITM) still cannot forge a value without the server key.
 */
export function issueCsrfToken(csrfKey: Buffer, sessionId: string): string {
  return createHmac('sha256', csrfKey).update('csrf:v1:').update(sessionId, 'utf8').digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // Compare fixed-length digests so length differences do not short-circuit on secret data.
  const l = createHmac('sha256', 'cmp').update(left).digest();
  const r = createHmac('sha256', 'cmp').update(right).digest();
  return timingSafeEqual(l, r) && left.length === right.length;
}

/**
 * Validates the token from the `X-CSRF-Token` header. When the readable `jarvis_csrf` cookie value is
 * passed as well it must match the header (the double-submit check itself).
 */
export function verifyCsrfToken(csrfKey: Buffer, sessionId: string, headerToken: string | undefined | null, cookieToken?: string | null): boolean {
  if (!headerToken || !sessionId) return false;
  if (cookieToken !== undefined && (cookieToken === null || !safeEqual(headerToken, cookieToken))) return false;
  return safeEqual(headerToken, issueCsrfToken(csrfKey, sessionId));
}
