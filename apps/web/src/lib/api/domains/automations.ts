"use client";

import type { components } from "@friday/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

/** The OpenAPI shape of an automation (condition `value` is `unknown` there; the JSON-Schema model narrows it, see PROJECT_STATUS gap 2). */
export type AutomationDto = components["schemas"]["Automation"];
type AutomationListResponse = components["schemas"]["AutomationListResponse"];
/** OpenAPI shape of a version entry (same `AutomationCondition.value` caveat as {@link AutomationDto}). */
export type AutomationVersionDto = components["schemas"]["AutomationVersion"];
type AutomationVersionListResponse = components["schemas"]["AutomationVersionListResponse"];

export interface AutomationFilters {
  enabled?: boolean;
  q?: string;
  limit?: number;
  cursor?: string;
}

export const automationQueries = {
  runs: (id: string, filters: { limit?: number; cursor?: string } = {}) =>
    queryOptions({
      queryKey: [...queryKeys.automations.runs(id), filters] as const,
      queryFn: (): Promise<components["schemas"]["AutomationRunListResponse"]> =>
        call(getApiClient().GET("/api/v1/automations/{id}/runs", { params: { path: { id }, query: filters } })),
      staleTime: staleTimes.automations,
    }),
  /** Version history, newest first (capability `automations.versions`). */
  versions: (id: string, filters: { limit?: number; cursor?: string } = {}) =>
    queryOptions({
      queryKey: [...queryKeys.automations.versions(id), filters] as const,
      queryFn: (): Promise<AutomationVersionListResponse> =>
        call(getApiClient().GET("/api/v1/automations/{id}/versions", { params: { path: { id }, query: filters } })),
      staleTime: staleTimes.automations,
    }),
  list: (filters: AutomationFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.automations.list(filters),
      queryFn: (): Promise<AutomationListResponse> => call(getApiClient().GET("/api/v1/automations", { params: { query: filters } })),
      staleTime: staleTimes.automations,
    }),
};

export const useAutomations = (filters?: AutomationFilters) => useQuery(automationQueries.list(filters));
export const useAutomationRuns = (id: string | null | undefined, filters?: { limit?: number; cursor?: string }) =>
  useQuery({ ...automationQueries.runs(id ?? "", filters), enabled: Boolean(id) });
export const useAutomationVersions = (id: string | null | undefined, filters?: { limit?: number; cursor?: string }, enabled = true) =>
  useQuery({ ...automationQueries.versions(id ?? "", filters), enabled: Boolean(id) && enabled });

/**
 * Every automation write (create, update, enable, disable, test, pause all) is a staged write since the P9
 * automation slice: components run it through `useRunStagedWrite` and the server preview binds the confirmation.
 */
