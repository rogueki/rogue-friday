export const SESSION_COOKIE = 'friday_session';
export const CSRF_COOKIE = 'friday_csrf';

export interface CookieOptions {
  /** Set the `Secure` attribute. Required whenever TLS terminates in front of the API (PLAN §49.7). */
  secureCookies?: boolean;
  maxAgeSeconds: number;
}

const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]+$/;

function assertCookieValue(value: string): void {
  if (!TOKEN_PATTERN.test(value)) throw new Error('Cookie value contains characters that need encoding');
}

function build(name: string, value: string, attributes: string[]): string {
  return [`${name}=${value}`, ...attributes].join('; ');
}

/** `friday_session`: HttpOnly so scripts cannot read it, SameSite=Strict against cross-site sends. */
export function serializeSessionCookie(sessionId: string, options: CookieOptions): string {
  assertCookieValue(sessionId);
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`];
  if (options.secureCookies) attrs.push('Secure');
  return build(SESSION_COOKIE, sessionId, attrs);
}

/** `friday_csrf`: deliberately readable by the SPA, which echoes it in `X-CSRF-Token`. */
export function serializeCsrfCookie(token: string, options: CookieOptions): string {
  assertCookieValue(token);
  const attrs = ['Path=/', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`];
  if (options.secureCookies) attrs.push('Secure');
  return build(CSRF_COOKIE, token, attrs);
}

export function clearSessionCookie(secureCookies = false): string {
  return build(SESSION_COOKIE, '', ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', ...(secureCookies ? ['Secure'] : [])]);
}

export function clearCsrfCookie(secureCookies = false): string {
  return build(CSRF_COOKIE, '', ['Path=/', 'SameSite=Strict', 'Max-Age=0', ...(secureCookies ? ['Secure'] : [])]);
}

/** Parses a `Cookie` request header. Later duplicates do not override earlier ones. */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    if (name && !(name in out)) out[name] = value;
  }
  return out;
}
