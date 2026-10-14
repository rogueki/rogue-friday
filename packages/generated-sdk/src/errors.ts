import type { ErrorCode, ErrorDetail, ErrorResponse, Severity } from "./generated/models";

/** Typed error thrown by the SDK client for every non-2xx response and for network failures. */
export class JarvisApiError extends Error {
  readonly code: ErrorCode;
  readonly severity: Severity;
  readonly retryable: boolean;
  readonly correlationId: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    detail: Pick<ErrorDetail, "code" | "message" | "severity" | "retryable" | "correlationId"> & {
      details?: Record<string, unknown>;
    },
    status: number,
  ) {
    super(detail.message);
    this.name = "JarvisApiError";
    this.code = detail.code;
    this.severity = detail.severity;
    this.retryable = detail.retryable;
    this.correlationId = detail.correlationId;
    this.status = status;
    this.details = detail.details ?? {};
  }
}

export function isJarvisApiError(value: unknown): value is JarvisApiError {
  return value instanceof JarvisApiError;
}

const isErrorResponse = (value: unknown): value is ErrorResponse =>
  typeof value === "object" &&
  value !== null &&
  "error" in value &&
  typeof (value as { error: unknown }).error === "object" &&
  (value as { error: { code?: unknown } }).error !== null &&
  typeof (value as { error: { code?: unknown } }).error.code === "string";

const STATUS_FALLBACK: Readonly<Record<number, ErrorCode>> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  503: "ADAPTER_UNAVAILABLE",
};

/** Builds a JarvisApiError from an HTTP error response; falls back to status-derived values when the body is not a contract error. */
export async function errorFromResponse(
  response: Response,
  fallbackCorrelationId: string,
): Promise<JarvisApiError> {
  const correlationId = response.headers.get("X-Correlation-Id") ?? fallbackCorrelationId;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    body = undefined;
  }
  if (isErrorResponse(body)) {
    return new JarvisApiError(
      { ...body.error, correlationId: body.error.correlationId || correlationId },
      response.status,
    );
  }
  return new JarvisApiError(
    {
      code: STATUS_FALLBACK[response.status] ?? "INTERNAL",
      message: response.statusText || `HTTP ${response.status}`,
      severity: response.status >= 500 ? "error" : "warning",
      retryable: response.status >= 500 || response.status === 429,
      correlationId,
    },
    response.status,
  );
}

/** Network-level failure (control API unreachable, aborted, CORS). Status 0 marks "no HTTP response". */
export function networkError(cause: unknown, correlationId: string): JarvisApiError {
  const error = new JarvisApiError(
    {
      code: "ADAPTER_UNAVAILABLE",
      message: cause instanceof Error ? cause.message : "Control API is not reachable",
      severity: "error",
      retryable: true,
      correlationId,
    },
    0,
  );
  error.cause = cause;
  return error;
}
