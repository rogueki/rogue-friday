import createClient, { type Middleware } from "openapi-fetch";
import { errorFromResponse, isFridayApiError, networkError } from "./errors";
import type { paths } from "./generated/openapi";

const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomSuffix(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += CROCKFORD[byte % CROCKFORD.length];
  return out;
}

/** `corr_` + 26 characters; matches the contract id pattern. */
export const createCorrelationId = (): string => `corr_${randomSuffix(26)}`;

/** Key for the Idempotency-Key header of critical POSTs (one key per user intent, reused on retries). */
export const createIdempotencyKey = (): string => `idem_${randomSuffix(26)}`;

export interface FridayClientOptions {
  /** API origin; empty string = same origin (Next rewrite in dev, static hosting in production). */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Returns the CSRF token from the current session; sent as X-CSRF-Token on mutating requests. */
  getCsrfToken?: () => string | null | undefined;
  /** Supplies the correlation id of the current user action; a new one is generated per request otherwise. */
  getCorrelationId?: () => string;
}

export function createFridayClient(options: FridayClientOptions = {}) {
  const { baseUrl = "", fetch: customFetch, getCsrfToken, getCorrelationId } = options;
  // Node-based fetch implementations (tests, SSR, jsdom) cannot build a Request from a relative URL.
  const effectiveBaseUrl =
    baseUrl || (globalThis as { location?: { origin?: string } }).location?.origin || "";
  const correlationIds = new WeakMap<Request, string>();

  const middleware: Middleware = {
    onRequest({ request }) {
      const correlationId =
        request.headers.get("X-Correlation-Id") ?? getCorrelationId?.() ?? createCorrelationId();
      request.headers.set("X-Correlation-Id", correlationId);
      correlationIds.set(request, correlationId);
      if (MUTATING_METHODS.has(request.method.toUpperCase())) {
        const token = getCsrfToken?.();
        if (token && !request.headers.has("X-CSRF-Token")) request.headers.set("X-CSRF-Token", token);
      }
      return request;
    },
    async onResponse({ request, response }) {
      if (response.ok) return undefined;
      throw await errorFromResponse(response, correlationIds.get(request) ?? createCorrelationId());
    },
    onError({ request, error }) {
      if (isFridayApiError(error)) return error;
      return networkError(error, correlationIds.get(request) ?? createCorrelationId());
    },
  };

  const client = createClient<paths>({
    baseUrl: effectiveBaseUrl,
    credentials: "include",
    ...(customFetch ? { fetch: customFetch } : {}),
  });
  client.use(middleware);
  return client;
}

export type FridayClient = ReturnType<typeof createFridayClient>;
