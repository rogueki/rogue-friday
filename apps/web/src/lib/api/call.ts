import { FridayApiError } from "@friday/sdk";

interface FetchResult<T> {
  data?: T;
  response: Response;
}

/**
 * Unwraps an openapi-fetch result. The SDK middleware already throws a `FridayApiError` for every non-2xx response, so
 * the only remaining failure is a 2xx without a body, which is reported as an INTERNAL contract error.
 */
export async function call<T>(request: Promise<FetchResult<T>>): Promise<T> {
  const { data, response } = await request;
  if (data === undefined) {
    throw new FridayApiError(
      {
        code: "INTERNAL",
        message: `Leere Antwort (HTTP ${response.status})`,
        severity: "error",
        retryable: false,
        correlationId: response.headers.get("X-Correlation-Id") ?? "corr_unknown",
      },
      response.status,
    );
  }
  return data;
}
