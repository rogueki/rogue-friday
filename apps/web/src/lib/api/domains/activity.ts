"use client";

import type { ActivityEvent, ActivityEventListResponse, ActivityEventResponse, ActivityKind, Severity } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";
import { useCursorPages } from "./cursorPages";

export interface ActivityFilters {
  kind?: ActivityKind[];
  severity?: Severity[];
  agentId?: string;
  taskId?: string;
  adapterId?: string;
  tool?: string;
  model?: string;
  /** Time range (UTC ISO-8601). */
  from?: string;
  to?: string;
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
export const useActivityEvent = (id: string | null | undefined) => useQuery({ ...activityQueries.detail(id ?? ""), enabled: Boolean(id) });

/** Events per page of the live feed; the server maximum keeps the number of round trips for 10 000 events small. */
export const ACTIVITY_PAGE_SIZE = 200;

/** Key of the unfiltered head list that `applyEvent` prepends every `activity.appended` event to. */
export const activityHeadKey = () => queryKeys.activity.list({ limit: ACTIVITY_PAGE_SIZE });

/**
 * Data of the Live Activity page. The head list (unfiltered first page) is the live source: `applyEvent` prepends every
 * event to it. The page reads those events from the query cache as they arrive (see `useActivityBuffer`), so this query
 * only notifies for its loading/error state: a burst of events must not re-render the page once per event.
 * `history` is the same list with server-side filters (only fetched when filters are set) and older pages by cursor;
 * a filter change never blanks the page (`head` stays the page's loading/error source, `historyLoading` shows progress).
 */
export function useActivityStream(filters: ActivityFilters = {}) {
  const head = useQuery({ ...activityQueries.list({ limit: ACTIVITY_PAGE_SIZE }), notifyOnChangeProps: ["status", "fetchStatus", "error", "isPending", "isFetching"] });
  const hasServerFilters = Object.values(filters).some((value) => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0));
  const historyFilters: ActivityFilters = { ...filters, limit: ACTIVITY_PAGE_SIZE };
  const filtered = useQuery({ ...activityQueries.list(historyFilters), enabled: hasServerFilters });
  const first = hasServerFilters ? filtered : head;
  const pages = useCursorPages<ActivityEvent, ActivityEventListResponse, ReturnType<typeof queryKeys.activity.list>>(
    first.data,
    (cursor) => activityQueries.list({ ...historyFilters, cursor }),
    JSON.stringify(historyFilters),
  );
  return { head, history: first, hasServerFilters, historyLoading: hasServerFilters && filtered.isFetching, ...pages };
}

/** Backfill used by the realtime client after a sequence gap (PLAN §12.5): ascending events after `sequence`. */
export async function fetchActivitySince(sequence: number, limit = 200): Promise<ActivityEvent[]> {
  const response = await call(getApiClient().GET("/api/v1/activity", { params: { query: { sinceSequence: sequence, limit } } }));
  return response.items;
}
