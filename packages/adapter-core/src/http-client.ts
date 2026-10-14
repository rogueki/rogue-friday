import { systemClock, type Clock } from "./clock";
import { AdapterError, errorFromHttpStatus, normalizeError } from "./errors";
import { noopLogger, type Logger } from "./logger";
import {
  createResilientCaller,
  type CircuitBreaker,
  type CircuitBreakerOptions,
  type ResilientCaller,
  type RetryPolicy,
} from "./resilience";

export interface HttpClientOptions {
  baseUrl: string;
  /** Per attempt. Default 10 000 ms. */
  timeoutMs?: number;
  retry?: Partial<RetryPolicy> | false;
  circuitBreaker?: Partial<CircuitBreakerOptions> | false;
  /** Evaluated per request so rotated secrets are picked up. */
  headers?: () => Record<string, string>;
  clock?: Clock;
  logger?: Logger;
  /** Applied to everything that could end up in messages, details or logs (secret masking). */
  redact?: (text: string) => string;
  /** Aborted on adapter shutdown: in-flight requests are cancelled, later requests fail immediately. */
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  random?: () => number;
  breaker?: CircuitBreaker;
}

export interface HttpRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<
    string,
    string | number | boolean | readonly (string | number | boolean)[] | null | undefined
  >;
  body?: unknown;
  headers?: Record<string, string>;
  /** Forwarded as `Idempotency-Key`; also makes POST/PATCH safe to retry. */
  idempotencyKey?: string;
  correlationId?: string;
  /** If-Match value (resource version). */
  ifMatch?: number;
  signal?: AbortSignal;
  /** Name for error messages, e.g. "listTasks". */
  operation?: string;
  /** `false` = exactly one attempt (health probes). */
  retry?: false;
}

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

export interface HttpClient {
  request<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>>;
  readonly caller: ResilientCaller;
}

const SAFE_TO_RETRY = new Set(["GET", "HEAD", "PUT", "DELETE"]);
const MAX_ERROR_SNIPPET = 200;

function parseRetryAfter(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * HTTP/JSON client for adapters: timeout, bounded retries with jittered backoff, circuit breaker and error
 * normalisation in one place. Mutating requests are only retried when they carry an idempotency key.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? noopLogger;
  const redact = options.redact ?? ((text: string) => text);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;

  const caller = createResilientCaller(
    {
      timeoutMs: options.timeoutMs ?? 10_000,
      ...(options.retry !== undefined ? { retry: options.retry } : {}),
      ...(options.circuitBreaker !== undefined ? { circuitBreaker: options.circuitBreaker } : {}),
    },
    {
      clock,
      ...(options.random ? { random: options.random } : {}),
      ...(options.breaker ? { breaker: options.breaker } : {}),
      onRetry: ({ attempt, delayMs, error, operation }) =>
        logger.warn("Wiederholung nach Fehler", { operation, attempt, delayMs, code: error.code }),
    },
  );

  const buildUrl = (path: string, query: HttpRequest["query"]): string => {
    const url = new URL(path.replace(/^\//, ""), base);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) for (const entry of value) url.searchParams.append(key, String(entry));
      else url.searchParams.set(key, String(value));
    }
    return url.toString();
  };

  async function request<T>(req: HttpRequest): Promise<HttpResponse<T>> {
    const retryable =
      req.retry !== false && (SAFE_TO_RETRY.has(req.method) || req.idempotencyKey !== undefined);
    const signals = [options.signal, req.signal].filter((s): s is AbortSignal => s !== undefined);
    const combined =
      signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    const operation = req.operation ?? `${req.method} ${req.path}`;

    try {
      return await caller.call<HttpResponse<T>>(
        async (signal) => {
          const headers: Record<string, string> = {
            accept: "application/json",
            ...(options.headers?.() ?? {}),
            ...req.headers,
          };
          if (req.body !== undefined) headers["content-type"] = "application/json";
          if (req.idempotencyKey) headers["idempotency-key"] = req.idempotencyKey;
          if (req.correlationId) headers["x-correlation-id"] = req.correlationId;
          if (req.ifMatch !== undefined) headers["if-match"] = String(req.ifMatch);

          const response = await fetchImpl(buildUrl(req.path, req.query), {
            method: req.method,
            headers,
            ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
            signal,
          });

          if (!response.ok) {
            const snippet = (await response.text().catch(() => "")).slice(0, MAX_ERROR_SNIPPET);
            const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), clock.now());
            throw errorFromHttpStatus(response.status, redact(`${operation}: HTTP ${response.status}`), {
              ...(snippet ? { upstreamMessage: redact(snippet) } : {}),
              ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            });
          }

          const text = await response.text();
          let body: unknown;
          if (text.length > 0) {
            try {
              body = JSON.parse(text);
            } catch (cause) {
              throw new AdapterError({
                code: "VALIDATION_FAILED",
                message: `${operation}: Antwort ist kein gültiges JSON.`,
                retryable: false,
                cause,
              });
            }
          }
          return { status: response.status, headers: response.headers, body: body as T };
        },
        { operation, retry: retryable, ...(combined ? { signal: combined } : {}) },
      );
    } catch (raw) {
      const error = normalizeError(raw, { operation });
      // Messages built from foreign error text may contain the token we sent; mask before they leave the adapter.
      const safe = redact(error.message);
      if (safe === error.message) throw error;
      throw new AdapterError({
        code: error.code,
        message: safe,
        retryable: error.retryable,
        severity: error.severity,
        details: JSON.parse(redact(JSON.stringify(error.details))) as Record<string, unknown>,
      });
    }
  }

  return { request, caller };
}

/** Builds a `redact` function that masks the given secret values (and their URL-encoded form). */
export function createRedactor(secrets: () => Iterable<string | undefined>): (text: string) => string {
  return (text) => {
    let out = text;
    for (const secret of secrets()) {
      if (!secret || secret.length < 4) continue;
      for (const variant of new Set([
        secret,
        encodeURIComponent(secret),
        JSON.stringify(secret).slice(1, -1),
      ])) {
        out = out.split(variant).join("***");
      }
    }
    return out;
  };
}
