import {
  AdapterError,
  createHttpClient,
  createRedactor,
  type AdapterContext,
  type HttpClient,
} from "@friday/adapter-core";
import type { MockTransport, TransportCall } from "./transport";

/** Config keys read by {@link httpTransport} from `AdapterContext.config`. */
export interface HttpTransportConfig {
  baseUrl: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
}

const HEALTH_PATH = "/mock/health";

/**
 * Transport that sends every port call and health probe over HTTP to a (simulated) upstream before the world answers.
 * It gives the mock adapters the same failure surface as a real HTTP adapter (timeouts, bounded retries, status ->
 * canonical error code, secret redaction, idempotency-key forwarding) so the conformance suite can inject real
 * transport faults. The upstream acknowledges a call with `{ "ok": true }`; any other body is rejected as foreign
 * data that cannot be mapped (`VALIDATION_FAILED`). Routes: `GET|POST /mock/<method>`, `GET /mock/health`.
 */
export function httpTransport(options: { secretFields?: readonly string[] } = {}): MockTransport {
  let client: HttpClient | undefined;

  const requireClient = (): HttpClient => {
    if (!client) {
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Der HTTP-Transport wurde nicht geöffnet.",
        retryable: false,
      });
    }
    return client;
  };

  return {
    async open(context: AdapterContext) {
      const config = context.config as Partial<HttpTransportConfig>;
      if (typeof config.baseUrl !== "string" || config.baseUrl.length === 0) {
        throw new AdapterError({ code: "VALIDATION_FAILED", message: "Konfiguration: baseUrl fehlt.", retryable: false });
      }
      client = createHttpClient({
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs ?? 5_000,
        retry: { maxAttempts: config.maxAttempts ?? 3, baseDelayMs: config.retryBaseDelayMs ?? 50, jitter: "none" },
        circuitBreaker: false,
        clock: context.clock,
        signal: context.signal,
        logger: context.logger,
        redact: createRedactor(() => (options.secretFields ?? []).map((field) => context.getSecret(field))),
      });
    },
    async close() {
      client = undefined;
    },
    async beforeCall(call: TransportCall) {
      const response = await requireClient().request<{ ok?: unknown }>({
        method: call.mutating ? "POST" : "GET",
        path: `/mock/${call.method}`,
        operation: call.method,
        correlationId: call.correlationId,
        ...(call.mutating ? { body: {} } : {}),
        ...(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {}),
        ...(call.signal ? { signal: call.signal } : {}),
      });
      if (response.body?.ok !== true) {
        throw new AdapterError({
          code: "VALIDATION_FAILED",
          message: `${call.method}: Antwort des Fremdsystems ist nicht abbildbar.`,
          retryable: false,
        });
      }
    },
    async probe(signal?: AbortSignal) {
      const started = Date.now();
      await requireClient().request({ method: "GET", path: HEALTH_PATH, operation: "health", retry: false, ...(signal ? { signal } : {}) });
      return { latencyMs: Math.max(0, Math.round(Date.now() - started)) };
    },
  };
}
