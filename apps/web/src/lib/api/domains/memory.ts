"use client";

import type {
  MemoryExport,
  MemoryListResponse,
  MemoryResponse,
  MemorySearchRequest,
  MemorySearchResponse,
  MemorySensitivity,
  MemoryType,
} from "@friday/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface MemoryFilters {
  type?: MemoryType[];
  sensitivity?: MemorySensitivity[];
  q?: string;
  tag?: string;
  pinned?: boolean;
  locked?: boolean;
  limit?: number;
  cursor?: string;
}

export const memoryQueries = {
  list: (filters: MemoryFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.memory.list(filters),
      queryFn: (): Promise<MemoryListResponse> => call(getApiClient().GET("/api/v1/memory", { params: { query: filters } })),
      staleTime: staleTimes.memory,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: queryKeys.memory.detail(id),
      queryFn: (): Promise<MemoryResponse> => call(getApiClient().GET("/api/v1/memory/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.memory,
    }),
  /** Semantic search. The key extends the shared `memory.search` key with the filter part so different filters never collide. */
  search: (request: MemorySearchRequest) =>
    queryOptions({
      queryKey: [
        ...queryKeys.memory.search(request.query, request.limit),
        { types: request.types ?? null, tags: request.tags ?? null, sensitivity: request.sensitivity ?? null, semantic: request.semantic ?? null, minConfidence: request.minConfidence ?? null },
      ] as const,
      queryFn: (): Promise<MemorySearchResponse> => searchMemory(request),
      staleTime: staleTimes.memory,
      enabled: request.query.trim().length > 0,
    }),
};

export const useMemories = (filters?: MemoryFilters) => useQuery(memoryQueries.list(filters));
export const useMemory = (id: string | null | undefined) => useQuery({ ...memoryQueries.detail(id ?? ""), enabled: Boolean(id) });
/** `request === null` disables the query (no search term). */
export const useMemorySearch = (request: MemorySearchRequest | null) =>
  useQuery(request ? memoryQueries.search(request) : { ...memoryQueries.search({ query: "" }), enabled: false });

/** Search is a POST by contract but side-effect free; callers use it imperatively (command palette). */
export const searchMemory = (body: MemorySearchRequest): Promise<MemorySearchResponse> =>
  call(getApiClient().POST("/api/v1/memory/search", { body }));

/**
 * Complete memory export from the server (GET /memory/export, owner, capability `memory.export`). The server leaves
 * restricted memories out and masks secrets; the document is handed to the browser as a file, nothing is stored.
 * A mutation (not a query): it runs on click and is never cached or refetched.
 */
export function useExportMemory() {
  return useApiMutation<MemoryExport, IntentVars>({
    label: "Gedächtnis exportieren",
    mutationFn: () => call(getApiClient().GET("/api/v1/memory/export")),
    invalidate: [queryKeys.audit.all],
  });
}
