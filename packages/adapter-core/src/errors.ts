import type { ErrorCode, ErrorDetail, Severity } from "@friday/sdk";

export interface AdapterErrorInit {
  code: ErrorCode;
  message: string;
  retryable?: boolean;
  severity?: Severity;
  details?: Record<string, unknown>;
  cause?: unknown;
  correlationId?: string;
}

const DEFAULT_SEVERITY: Readonly<Record<ErrorCode, Severity>> = {
  ADAPTER_UNAVAILABLE: "warning",
  ADAPTER_TIMEOUT: "warning",
  CAPABILITY_MISSING: "info",
  VALIDATION_FAILED: "error",
  NOT_FOUND: "info",
  CONFLICT: "warning",
  UNAUTHENTICATED: "error",
  FORBIDDEN: "error",
  CSRF_INVALID: "error",
  APPROVAL_REQUIRED: "info",
  IDEMPOTENCY_CONFLICT: "warning",
  RATE_LIMITED: "warning",
  REAUTH_REQUIRED: "info",
  INTERNAL: "error",
};

const DEFAULT_RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "ADAPTER_UNAVAILABLE",
  "ADAPTER_TIMEOUT",
  "RATE_LIMITED",
]);

/** The only error type that leaves an adapter. Carries a canonical code; provider details go into `details` (never secrets). */
export class AdapterError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly severity: Severity;
  readonly details: Record<string, unknown>;
  readonly correlationId?: string;

  constructor(init: AdapterErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "AdapterError";
    this.code = init.code;
    this.retryable = init.retryable ?? DEFAULT_RETRYABLE.has(init.code);
    this.severity = init.severity ?? DEFAULT_SEVERITY[init.code];
    this.details = init.details ?? {};
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }

  withCorrelationId(correlationId: string): AdapterError {
    if (this.correlationId === correlationId) return this;
    return new AdapterError({ ...this.toInit(), correlationId });
  }

  toErrorDetail(fallbackCorrelationId: string): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      severity: this.severity,
      retryable: this.retryable,
      correlationId: this.correlationId ?? fallbackCorrelationId,
      details: this.details,
    };
  }

  private toInit(): AdapterErrorInit {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      severity: this.severity,
      details: this.details,
      cause: this.cause,
    };
  }
}

export const isAdapterError = (value: unknown): value is AdapterError => value instanceof AdapterError;

export const ERROR_CODES: readonly ErrorCode[] = Object.keys(DEFAULT_SEVERITY) as ErrorCode[];

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);

/** Maps an HTTP status of an upstream response to a canonical error. */
export function errorFromHttpStatus(
  status: number,
  message: string,
  details: Record<string, unknown> = {},
): AdapterError {
  const base = { message, details: { upstreamStatus: status, ...details } };
  switch (status) {
    case 401:
      return new AdapterError({ ...base, code: "UNAUTHENTICATED", retryable: false });
    case 403:
      return new AdapterError({ ...base, code: "FORBIDDEN", retryable: false });
    case 404:
    case 410:
      return new AdapterError({ ...base, code: "NOT_FOUND", retryable: false });
    case 408:
    case 504:
      return new AdapterError({ ...base, code: "ADAPTER_TIMEOUT", retryable: true });
    case 409:
      return new AdapterError({ ...base, code: "CONFLICT", retryable: false });
    case 412:
    case 428:
      return new AdapterError({ ...base, code: "CONFLICT", retryable: false });
    case 422:
    case 400:
      return new AdapterError({ ...base, code: "VALIDATION_FAILED", retryable: false });
    case 429:
      return new AdapterError({ ...base, code: "RATE_LIMITED", retryable: true });
    default:
      if (status >= 500) return new AdapterError({ ...base, code: "ADAPTER_UNAVAILABLE", retryable: true });
      if (status >= 400) return new AdapterError({ ...base, code: "VALIDATION_FAILED", retryable: false });
      return new AdapterError({ ...base, code: "INTERNAL", retryable: false });
  }
}

const NETWORK_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_ABORTED",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
]);
const NETWORK_TIMEOUT_CODES: ReadonlySet<string> = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const readString = (source: unknown, key: string): string | undefined => {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
};

const readNumber = (source: unknown, key: string): number | undefined => {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
};

/** Walks the `cause` chain (fetch wraps the socket error in `TypeError: fetch failed`). */
function* causeChain(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
}

/**
 * Converts anything thrown inside an adapter into an AdapterError with a canonical code.
 * Never swallows: unknown inputs become INTERNAL with the original as `cause`.
 */
export function normalizeError(error: unknown, context?: { operation?: string }): AdapterError {
  if (isAdapterError(error)) return error;
  const operation = context?.operation;
  const prefix = operation ? `${operation}: ` : "";

  // Errors of the SDK client or any foreign error that already carries a canonical code.
  const carriedCode = readString(error, "code");
  if (error instanceof Error && isErrorCode(carriedCode)) {
    const carriedRetryable = (error as { retryable?: unknown }).retryable;
    return new AdapterError({
      code: carriedCode,
      message: error.message,
      retryable: typeof carriedRetryable === "boolean" ? carriedRetryable : undefined,
      cause: error,
    });
  }

  const name = readString(error, "name");
  if (name === "TimeoutError") {
    return new AdapterError({
      code: "ADAPTER_TIMEOUT",
      message: `${prefix}Zeitüberschreitung beim Zugriff auf das Fremdsystem.`,
      cause: error,
    });
  }
  if (name === "AbortError") {
    return new AdapterError({
      code: "ADAPTER_UNAVAILABLE",
      message: `${prefix}Vorgang abgebrochen.`,
      retryable: false,
      cause: error,
    });
  }

  const status =
    readNumber(error, "status") ??
    readNumber(error, "statusCode") ??
    readNumber((error as { response?: unknown })?.response, "status");
  if (status !== undefined && status >= 100 && status < 600) {
    const message = error instanceof Error ? error.message : `HTTP ${status}`;
    return errorFromHttpStatus(status, `${prefix}${message}`);
  }

  for (const link of causeChain(error)) {
    const code = readString(link, "code");
    if (code && NETWORK_TIMEOUT_CODES.has(code)) {
      return new AdapterError({
        code: "ADAPTER_TIMEOUT",
        message: `${prefix}Zeitüberschreitung (${code}).`,
        details: { networkCode: code },
        cause: error,
      });
    }
    if (code && NETWORK_UNAVAILABLE_CODES.has(code)) {
      return new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: `${prefix}Fremdsystem nicht erreichbar (${code}).`,
        details: { networkCode: code },
        cause: error,
      });
    }
  }

  if (error instanceof TypeError && /fetch failed|network|socket|terminated/i.test(error.message)) {
    return new AdapterError({
      code: "ADAPTER_UNAVAILABLE",
      message: `${prefix}Fremdsystem nicht erreichbar.`,
      cause: error,
    });
  }
  if (error instanceof SyntaxError) {
    return new AdapterError({
      code: "VALIDATION_FAILED",
      message: `${prefix}Antwort des Fremdsystems ist kein gültiges JSON.`,
      retryable: false,
      cause: error,
    });
  }

  return new AdapterError({
    code: "INTERNAL",
    message: error instanceof Error ? `${prefix}${error.message}` : `${prefix}Unbekannter Fehler`,
    retryable: false,
    cause: error,
  });
}
