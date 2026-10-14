"use client";

import type {
  ActionResult,
  MemoryCreateRequest,
  MemoryListResponse,
  MemoryResponse,
  MemorySearchRequest,
  MemorySearchResponse,
  MemorySensitivity,
  MemoryType,
  MemoryUpdateRequest,
} from "@jarvis/sdk";
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

const invalidate = [queryKeys.memory.all, queryKeys.overview] as const;

export function useCreateMemory() {
  return useApiMutation<MemoryResponse, MemoryCreateRequest & IntentVars>({
    label: "Gedächtniseintrag anlegen",
    mutationFn: ({ idempotencyKey, ...body }) =>
      call(getApiClient().POST("/api/v1/memory", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
    invalidate,
  });
}

export function useUpdateMemory() {
  return useApiMutation<MemoryResponse, { id: string; version: number; patch: MemoryUpdateRequest } & IntentVars>({
    label: "Gedächtniseintrag ändern",
    mutationFn: ({ id, version, patch }) =>
      call(getApiClient().PATCH("/api/v1/memory/{id}", { params: { path: { id }, header: { "If-Match": String(version) } }, body: patch })),
    invalidate,
    conflictKeys: [queryKeys.memory.all],
  });
}

/** Forgetting is traceable: the server writes an audit event for every deletion (PLAN §30.4). */
export function useDeleteMemory() {
  return useApiMutation<ActionResult, { id: string; version: number } & IntentVars>({
    label: "Gedächtniseintrag vergessen",
    mutationFn: ({ id, version }) =>
      call(getApiClient().DELETE("/api/v1/memory/{id}", { params: { path: { id }, header: { "If-Match": String(version) } } })),
    invalidate: [...invalidate, queryKeys.audit.all],
    conflictKeys: [queryKeys.memory.all],
  });
}
