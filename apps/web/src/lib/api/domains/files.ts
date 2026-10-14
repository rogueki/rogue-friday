"use client";

import type { FileCategory, FileItemListResponse } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface FileFilters {
  category?: FileCategory[];
  q?: string;
  tag?: string;
  taskId?: string;
  limit?: number;
  cursor?: string;
}

export const fileQueries = {
  list: (filters: FileFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.files.list(filters),
      queryFn: (): Promise<FileItemListResponse> => call(getApiClient().GET("/api/v1/files", { params: { query: filters } })),
      staleTime: staleTimes.files,
    }),
};

export const useFiles = (filters?: FileFilters) => useQuery(fileQueries.list(filters));
export const searchFiles = (q: string, limit = 6): Promise<FileItemListResponse> =>
  call(getApiClient().GET("/api/v1/files", { params: { query: { q, limit } } }));
