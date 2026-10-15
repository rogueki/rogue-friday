import type { AdapterCategory, ErrorCode, ErrorDetail, ErrorResponse, Severity } from "@friday/sdk";

/** HTTP status per canonical error code (OpenAPI error responses). */
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

export interface MockApiErrorInit {
  code: ErrorCode;
  message: string;
  severity?: Severity;
  retryable?: boolean;
  details?: Record<string, unknown>;
  status?: number;
}

/** Contract error raised by the mock world. `toResponse` yields the exact wire envelope. */
export class MockApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly severity: Severity;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(init: MockApiErrorInit) {
    super(init.message);
    this.name = "MockApiError";
    this.code = init.code;
    this.status = init.status ?? HTTP_STATUS_BY_CODE[init.code];
    this.severity = init.severity ?? (this.status >= 500 ? "error" : "warning");
    this.retryable = init.retryable ?? (this.status >= 500 || this.status === 429);
    this.details = init.details ?? {};
  }

  toDetail(correlationId: string): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      severity: this.severity,
      retryable: this.retryable,
      correlationId,
      details: this.details,
    };
  }

  toResponse(correlationId: string): ErrorResponse {
    return { error: this.toDetail(correlationId) };
  }
}

/** Availability / capability failure of a mock adapter (ADAPTER_UNAVAILABLE, ADAPTER_TIMEOUT, CAPABILITY_MISSING). */
export class MockAdapterError extends MockApiError {
  readonly category: AdapterCategory;
  readonly adapterId: string;

  constructor(
    init: MockApiErrorInit & { category: AdapterCategory; adapterId: string },
  ) {
    super({ ...init, details: { ...init.details, adapterId: init.adapterId, category: init.category } });
    this.name = "MockAdapterError";
    this.category = init.category;
    this.adapterId = init.adapterId;
  }
}

export const isMockApiError = (value: unknown): value is MockApiError => value instanceof MockApiError;

export const notFound = (kind: string, id: string): MockApiError =>
  new MockApiError({ code: "NOT_FOUND", message: `${kind} ${id} wurde nicht gefunden.`, details: { kind, id } });

export const conflict = (message: string, details: Record<string, unknown> = {}): MockApiError =>
  new MockApiError({ code: "CONFLICT", message, details });

export const validationFailed = (
  message: string,
  fieldErrors: { path: string; message: string }[] = [],
): MockApiError =>
  new MockApiError({ code: "VALIDATION_FAILED", message, details: { fieldErrors } });
