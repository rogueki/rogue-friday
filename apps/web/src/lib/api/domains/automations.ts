"use client";

import type { components } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

type AutomationListResponse = components["schemas"]["AutomationListResponse"];
type AutomationResponse = components["schemas"]["AutomationResponse"];

export interface AutomationFilters {
  enabled?: boolean;
  q?: string;
  limit?: number;
  cursor?: string;
}

export const automationQueries = {
  list: (filters: AutomationFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.automations.list(filters),
      queryFn: (): Promise<AutomationListResponse> => call(getApiClient().GET("/api/v1/automations", { params: { query: filters } })),
      staleTime: staleTimes.automations,
    }),
};

export const useAutomations = (filters?: AutomationFilters) => useQuery(automationQueries.list(filters));

export function useToggleAutomation(enable: boolean) {
  return useApiMutation<AutomationResponse, { id: string; version?: number } & IntentVars>({
    label: enable ? "Automation aktivieren" : "Automation deaktivieren",
    mutationFn: ({ id, version }) =>
      call(
        getApiClient().POST(enable ? "/api/v1/automations/{id}/enable" : "/api/v1/automations/{id}/disable", {
          params: { path: { id }, header: version === undefined ? {} : { "If-Match": String(version) } },
        }),
      ),
    invalidate: [queryKeys.automations.all],
    conflictKeys: [queryKeys.automations.all],
  });
}

export function useTestAutomation() {
  return useApiMutation<unknown, { id: string; dryRun?: boolean } & IntentVars>({
    label: "Automation testen",
    mutationFn: async ({ id, dryRun }) =>
      call(getApiClient().POST("/api/v1/automations/{id}/test", { params: { path: { id } }, body: { dryRun: dryRun ?? true } })),
    invalidate: [queryKeys.automations.all, queryKeys.activity.all],
  });
}
