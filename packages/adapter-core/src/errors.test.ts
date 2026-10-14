import { describe, expect, it } from "vitest";
import { AdapterError, errorFromHttpStatus, normalizeError } from "./errors";

const networkError = (code: string) => {
  const cause = Object.assign(new Error(`connect ${code}`), { code });
  return Object.assign(new TypeError("fetch failed"), { cause });
};

describe("normalizeError", () => {
  it("returns AdapterError unchanged", () => {
    const error = new AdapterError({ code: "CONFLICT", message: "x" });
    expect(normalizeError(error)).toBe(error);
  });

  it.each([
    [401, "UNAUTHENTICATED", false],
    [403, "FORBIDDEN", false],
    [404, "NOT_FOUND", false],
    [409, "CONFLICT", false],
    [422, "VALIDATION_FAILED", false],
    [429, "RATE_LIMITED", true],
    [500, "ADAPTER_UNAVAILABLE", true],
    [502, "ADAPTER_UNAVAILABLE", true],
    [503, "ADAPTER_UNAVAILABLE", true],
    [504, "ADAPTER_TIMEOUT", true],
  ] as const)("maps HTTP %i to %s (retryable=%s)", (status, code, retryable) => {
    const error = errorFromHttpStatus(status, "boom");
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.details.upstreamStatus).toBe(status);
  });

  it("maps a status carried by a foreign error", () => {
    expect(normalizeError(Object.assign(new Error("nope"), { status: 403 })).code).toBe("FORBIDDEN");
    expect(normalizeError(Object.assign(new Error("nope"), { response: { status: 401 } })).code).toBe(
      "UNAUTHENTICATED",
    );
  });

  it.each(["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN"])(
    "maps %s to ADAPTER_UNAVAILABLE",
    (code) => {
      const error = normalizeError(networkError(code));
      expect(error.code).toBe("ADAPTER_UNAVAILABLE");
      expect(error.retryable).toBe(true);
      expect(error.details.networkCode).toBe(code);
    },
  );

  it.each(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"])(
    "maps %s to ADAPTER_TIMEOUT",
    (code) => {
      expect(normalizeError(networkError(code)).code).toBe("ADAPTER_TIMEOUT");
    },
  );

  it("maps TimeoutError to ADAPTER_TIMEOUT and AbortError to a non-retryable ADAPTER_UNAVAILABLE", () => {
    expect(normalizeError(new DOMException("t", "TimeoutError")).code).toBe("ADAPTER_TIMEOUT");
    const aborted = normalizeError(new DOMException("a", "AbortError"));
    expect(aborted.code).toBe("ADAPTER_UNAVAILABLE");
    expect(aborted.retryable).toBe(false);
  });

  it("maps JSON syntax errors to VALIDATION_FAILED", () => {
    expect(normalizeError(new SyntaxError("Unexpected token")).code).toBe("VALIDATION_FAILED");
  });

  it("keeps canonical codes of foreign errors (SDK client errors)", () => {
    const error = normalizeError(Object.assign(new Error("denied"), { code: "FORBIDDEN", retryable: false }));
    expect(error.code).toBe("FORBIDDEN");
  });

  it("never swallows unknown input: INTERNAL with the original as cause", () => {
    const original = new Error("kaputt");
    const error = normalizeError(original, { operation: "listTasks" });
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toContain("listTasks");
    expect(error.cause).toBe(original);
    expect(normalizeError("text").code).toBe("INTERNAL");
  });

  it("converts to the contract's ErrorDetail", () => {
    const detail = new AdapterError({ code: "NOT_FOUND", message: "weg" }).toErrorDetail(
      "corr_00000000000000000000000001",
    );
    expect(detail).toMatchObject({
      code: "NOT_FOUND",
      retryable: false,
      severity: "info",
      correlationId: "corr_00000000000000000000000001",
    });
  });
});
