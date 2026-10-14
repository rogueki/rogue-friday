"use client";

import type {
  CalendarBriefingListResponse,
  CalendarConflictListResponse,
  CalendarEventListResponse,
  CalendarEventResponse,
  CalendarProposalRequest,
  CalendarProposalResponse,
} from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { queryKeys } from "../queryKeys";
import { useApiMutation, type IntentVars } from "../mutation";
import { staleTimes } from "../staleTimes";

export interface CalendarEventFilters {
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export const calendarQueries = {
  events: (filters: CalendarEventFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.calendar.events.list(filters),
      queryFn: (): Promise<CalendarEventListResponse> => call(getApiClient().GET("/api/v1/calendar/events", { params: { query: filters } })),
      staleTime: staleTimes.calendar,
    }),
  event: (id: string) =>
    queryOptions({
      queryKey: queryKeys.calendar.events.detail(id),
      queryFn: (): Promise<CalendarEventResponse> => call(getApiClient().GET("/api/v1/calendar/events/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.calendar,
    }),
  conflicts: () =>
    queryOptions({
      queryKey: queryKeys.calendar.conflicts,
      queryFn: (): Promise<CalendarConflictListResponse> => call(getApiClient().GET("/api/v1/calendar/conflicts")),
      staleTime: staleTimes.calendar,
    }),
  briefings: () =>
    queryOptions({
      queryKey: queryKeys.calendar.briefings,
      queryFn: (): Promise<CalendarBriefingListResponse> => call(getApiClient().GET("/api/v1/calendar/briefings")),
      staleTime: staleTimes.calendar,
    }),
};

export const useCalendarEvents = (filters?: CalendarEventFilters) => useQuery(calendarQueries.events(filters));
export const useCalendarEvent = (id: string | null | undefined) => useQuery({ ...calendarQueries.event(id ?? ""), enabled: Boolean(id) });
export const useCalendarConflicts = () => useQuery(calendarQueries.conflicts());
export const useCalendarBriefings = () => useQuery(calendarQueries.briefings());

/**
 * Every calendar write is a proposal that goes through approval (PLAN §34.3): the server answers with the proposal and,
 * for write types, an `approvalId` that is decided on the approvals page.
 */
export function useCreateCalendarProposal() {
  return useApiMutation<CalendarProposalResponse, CalendarProposalRequest & IntentVars>({
    label: "Terminvorschlag erstellen",
    mutationFn: ({ idempotencyKey, ...body }) =>
      call(getApiClient().POST("/api/v1/calendar/proposals", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
    invalidate: [queryKeys.approvals.all, queryKeys.calendar.events.all, queryKeys.calendar.conflicts],
  });
}
