"use client";

import type { ActivityEvent, ActivityEventListResponse, ActivityEventResponse, ActivityKind, Severity } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface ActivityFilters {
  kind?: ActivityKind[];
  severity?: Severity[];
  agentId?: string;
  taskId?: string;
  adapterId?: string;
  correlationId?: string;
  parentId?: string;
  status?: string;
  sinceSequence?: number;
  limit?: number;
  cursor?: string;
}

export const activityQueries = {
  list: (filters: ActivityFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.activity.list(filters),
      queryFn: (): Promise<ActivityEventListResponse> => call(getApiClient().GET("/api/v1/activity", { params: { query: filters } })),
      staleTime: staleTimes.activity,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: queryKeys.activity.detail(id),
      queryFn: (): Promise<ActivityEventResponse> => call(getApiClient().GET("/api/v1/activity/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.activity,
    }),
};

export const useActivity = (filters?: ActivityFilters) => useQuery(activityQueries.list(filters));

/** Backfill used by the realtime client after a sequence gap (PLAN §12.5): ascending events after `sequence`. */
export async function fetchActivitySince(sequence: number, limit = 200): Promise<ActivityEvent[]> {
  const response = await call(getApiClient().GET("/api/v1/activity", { params: { query: { sinceSequence: sequence, limit } } }));
  return response.items;
}
