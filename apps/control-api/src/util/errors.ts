import { isAdapterError, normalizeError } from "@friday/adapter-core";
import type { ErrorCode, ErrorDetail, Severity } from "@friday/sdk";

/**
 * HTTP status per canonical error code. The contract lists 400/401/403/404/409/422/429/503 only, so unexpected
 * server faults (INTERNAL) travel as 503 like in the mock world; `retryable` tells clients not to retry them.
 */
export const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  ADAPTER_UNAVAILABLE: 503,
  ADAPTER_TIMEOUT: 503,
  CAPABILITY_MISSING: 403,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  APPROVAL_REQUIRED: 403,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  REAUTH_REQUIRED: 401,
  INTERNAL: 503,
};

const DEFAULT_SEVERITY: Readonly<Record<ErrorCode, Severity>> = {
  ADAPTER_UNAVAILABLE: "warning",
  ADAPTER_TIMEOUT: "warning",
  CAPABILITY_MISSING: "info",
  VALIDATION_FAILED: "warning",
  NOT_FOUND: "info",
  CONFLICT: "warning",
  UNAUTHENTICATED: "warning",
  FORBIDDEN: "warning",
  CSRF_INVALID: "error",
  APPROVAL_REQUIRED: "info",
  IDEMPOTENCY_CONFLICT: "warning",
  RATE_LIMITED: "warning",
  REAUTH_REQUIRED: "info",
  INTERNAL: "error",
};

export interface ApiErrorInit {
  code: ErrorCode;
  message: string;
  status?: number;
  severity?: Severity;
  retryable?: boolean;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
  cause?: unknown;
}

/** Error raised by the Control API itself (auth, validation, approvals); adapters throw `AdapterError`. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly severity: Severity;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status ?? HTTP_STATUS_BY_CODE[init.code];
    this.severity = init.severity ?? DEFAULT_SEVERITY[init.code];
    this.retryable = init.retryable ?? (init.code === "RATE_LIMITED");
    this.details = init.details ?? {};
    this.headers = init.headers ?? {};
  }
}

export const notFound = (what: string, id?: string): ApiError =>
  new ApiError({ code: "NOT_FOUND", message: id ? `${what} ${id} wurde nicht gefunden.` : `${what} wurde nicht gefunden.`, details: id ? { id } : {} });

export const validationFailed = (message: string, fieldErrors: Array<{ path: string; message: string }> = []): ApiError =>
  new ApiError({ code: "VALIDATION_FAILED", message, details: { fieldErrors } });

export const forbidden = (message: string, details: Record<string, unknown> = {}): ApiError =>
  new ApiError({ code: "FORBIDDEN", message, details });

export const conflict = (message: string, details: Record<string, unknown> = {}): ApiError =>
  new ApiError({ code: "CONFLICT", message, details });

export interface NormalizedFailure {
  status: number;
  headers: Record<string, string>;
  detail: ErrorDetail;
  cause: unknown;
}

/** Maps anything thrown below the pipeline to the contract error envelope. Never leaks stack traces. */
export function toFailure(error: unknown, correlationId: string): NormalizedFailure {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      headers: error.headers,
      cause: error.cause ?? error,
      detail: {
        code: error.code,
        message: error.message,
        severity: error.severity,
        retryable: error.retryable,
        correlationId,
        details: error.details,
      },
    };
  }
  const adapterError = isAdapterError(error) ? error : normalizeError(error);
  const detail = adapterError.toErrorDetail(correlationId);
  // Adapter faults carry the correlation id of the port call, which is the request's id.
  detail.correlationId = correlationId;
  const retryAfter = adapterError.details?.retryAfterSeconds;
  return {
    status: HTTP_STATUS_BY_CODE[adapterError.code] ?? 503,
    headers: adapterError.code === "RATE_LIMITED" && typeof retryAfter === "number" ? { "Retry-After": String(retryAfter) } : {},
    cause: adapterError.cause ?? adapterError,
    detail,
  };
}
