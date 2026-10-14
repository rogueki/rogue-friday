"use client";

import type { MemoryListResponse, MemoryResponse, MemorySearchRequest, MemorySearchResponse, MemoryType } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface MemoryFilters {
  type?: MemoryType[];
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
};

export const useMemories = (filters?: MemoryFilters) => useQuery(memoryQueries.list(filters));

/** Search is a POST by contract but side-effect free; callers use it imperatively (command palette). */
export const searchMemory = (body: MemorySearchRequest): Promise<MemorySearchResponse> =>
  call(getApiClient().POST("/api/v1/memory/search", { body }));
