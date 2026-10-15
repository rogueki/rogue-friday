import { isFridayApiError } from "@friday/sdk";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import type { ApiMutationMeta } from "./mutation";

export interface ErrorSink {
  /** Shows a toast. */
  notify: (message: { title: string; description?: string; tone: "red" | "amber" }) => void;
  /** Called when the API reports UNAUTHENTICATED so the session gate can redirect to /login. */
  onUnauthenticated?: () => void;
}

const MAX_RETRIES = 3;

/**
 * Retry policy: respect `FridayApiError.retryable`, never retry 4xx (also not 429; the user-visible rate limit must be
 * respected), at most three attempts for 5xx / network errors.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (isFridayApiError(error)) {
    if (error.status >= 400 && error.status < 500) return false;
    return error.retryable;
  }
  return failureCount < 2;
}

export const retryDelay = (attempt: number): number => Math.min(1000 * 2 ** attempt, 8000);

export function describeError(error: unknown): { title: string; description: string; correlationId?: string } {
  if (isFridayApiError(error)) {
    return { title: error.code, description: error.message, correlationId: error.correlationId };
  }
  return { title: "Fehler", description: error instanceof Error ? error.message : String(error) };
}

export function createQueryClient(sink: () => ErrorSink | null): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay,
        // Realtime events and the polling fallback keep data fresh; focus refetch would only double the traffic.
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (isFridayApiError(error) && error.code === "UNAUTHENTICATED") sink()?.onUnauthenticated?.();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const meta = (mutation.options.meta ?? {}) as ApiMutationMeta;
        if (isFridayApiError(error) && error.code === "UNAUTHENTICATED") {
          sink()?.onUnauthenticated?.();
          return;
        }
        if (isFridayApiError(error) && error.code === "CONFLICT") {
          // If-Match mismatch: somebody (or the assistant itself) changed the resource. Reload instead of overwriting.
          for (const key of meta.conflictKeys ?? []) void client.invalidateQueries({ queryKey: key });
          sink()?.notify({
            title: "Änderung nicht übernommen",
            description: "Der Eintrag wurde zwischenzeitlich geändert. Die aktuelle Version wurde geladen.",
            tone: "amber",
          });
          return;
        }
        if (meta.silent) return;
        const info = describeError(error);
        sink()?.notify({
          title: meta.label ? `${meta.label} fehlgeschlagen` : info.title,
          description: info.correlationId ? `${info.description} (${info.correlationId})` : info.description,
          tone: "red",
        });
      },
    }),
  });
  return client;
}
