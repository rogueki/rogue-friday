import { createJarvisClient, type JarvisClient } from "@jarvis/sdk";

/** Name of the readable double-submit cookie written by the Control API (packages/auth/src/cookies.ts). */
const CSRF_COOKIE = "jarvis_csrf";

let sessionCsrfToken: string | null = null;
let client: JarvisClient | null = null;

/** Called by the session provider whenever GET /auth/session delivers a (new) token. */
export function setCsrfToken(token: string | null): void {
  sessionCsrfToken = token;
}

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
}

export function getCsrfToken(): string | null {
  return sessionCsrfToken ?? readCsrfCookie();
}

/** Single SDK client for the whole app; same origin (Next rewrite in dev, static hosting by the API in production). */
export function getApiClient(): JarvisClient {
  client ??= createJarvisClient({ baseUrl: "", getCsrfToken });
  return client;
}

/** Test seam: inject a client with a fake fetch, or pass `null` to reset. */
export function setApiClient(next: JarvisClient | null): void {
  client = next;
}
