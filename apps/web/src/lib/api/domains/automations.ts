"use client";

import type {
  AutomationCreateRequest,
  AutomationPauseAllRequest,
  AutomationPauseAllResponse,
  AutomationRunListResponse,
  AutomationRunResponse,
  AutomationTestRequest,
  AutomationUpdateRequest,
  components,
} from "@friday/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

/** The OpenAPI shape of an automation (condition `value` is `unknown` there; the JSON-Schema model narrows it, see PROJECT_STATUS gap 2). */
export type AutomationDto = components["schemas"]["Automation"];
type AutomationListResponse = components["schemas"]["AutomationListResponse"];
type AutomationResponse = components["schemas"]["AutomationResponse"];
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
      queryFn: (): Promise<AutomationRunListResponse> =>
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

/** Dry run / test with mock data (PLAN §35.3): the server evaluates the trigger against `sampleData` and records a run. */
export function useTestAutomation() {
  return useApiMutation<AutomationRunResponse, { id: string } & AutomationTestRequest & IntentVars>({
    label: "Automation testen",
    mutationFn: ({ id, dryRun, sampleData }) =>
      call(
        getApiClient().POST("/api/v1/automations/{id}/test", {
          params: { path: { id } },
          body: { dryRun: dryRun ?? true, ...(sampleData ? { sampleData } : {}) },
        }),
      ),
    invalidate: (data) => [queryKeys.automations.runs(data.data.automationId), queryKeys.automations.lists(), queryKeys.activity.all],
  });
}

export function useCreateAutomation() {
  return useApiMutation<AutomationResponse, AutomationCreateRequest & IntentVars>({
    label: "Automation anlegen",
    mutationFn: ({ idempotencyKey, ...body }) =>
      call(getApiClient().POST("/api/v1/automations", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
    invalidate: [queryKeys.automations.all],
  });
}

/** Every definition change increments `version`; `If-Match` makes a concurrent edit a 409 instead of a silent overwrite. */
export function useUpdateAutomation() {
  return useApiMutation<AutomationResponse, { id: string; version: number; patch: AutomationUpdateRequest } & IntentVars>({
    label: "Automation ändern",
    mutationFn: ({ id, version, patch }) =>
      call(getApiClient().PATCH("/api/v1/automations/{id}", { params: { path: { id }, header: { "If-Match": String(version) } }, body: patch })),
    invalidate: [queryKeys.automations.all],
    conflictKeys: [queryKeys.automations.all],
  });
}

/**
 * "Pause All" (PLAN §35.3): one request (POST /automations/pause-all, capability `automations.pauseAll`). The server
 * pauses every enabled automation, writes one audit entry and answers with the outcome per automation.
 */
export function usePauseAllAutomations() {
  return useApiMutation<AutomationPauseAllResponse, AutomationPauseAllRequest & IntentVars>({
    label: "Alle Automationen pausieren",
    mutationFn: ({ reason, idempotencyKey }) =>
      call(
        getApiClient().POST("/api/v1/automations/pause-all", {
          params: { header: { "Idempotency-Key": idempotencyKey } },
          body: reason ? { reason } : {},
        }),
      ),
    invalidate: [queryKeys.automations.all, queryKeys.overview],
    conflictKeys: [queryKeys.automations.all],
  });
}

export interface ResumeAllResult {
  succeeded: string[];
  failed: { id: string; message: string }[];
}

/**
 * "Alle fortsetzen". The contract only has a bulk operation for pausing, so resuming is one `PATCH { paused: false }` per
 * automation, each with its own `If-Match`. Failures are collected per automation instead of aborting the rest.
 */
export function useResumeAllAutomations() {
  return useApiMutation<ResumeAllResult, { targets: readonly { id: string; version: number }[] } & IntentVars>({
    label: "Alle Automationen fortsetzen",
    mutationFn: async ({ targets }) => {
      const outcomes = await Promise.allSettled(
        targets.map(({ id, version }) =>
          call(getApiClient().PATCH("/api/v1/automations/{id}", { params: { path: { id }, header: { "If-Match": String(version) } }, body: { paused: false } })),
        ),
      );
      const result: ResumeAllResult = { succeeded: [], failed: [] };
      outcomes.forEach((outcome, index) => {
        const id = targets[index]?.id ?? "";
        if (outcome.status === "fulfilled") result.succeeded.push(id);
        else result.failed.push({ id, message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) });
      });
      return result;
    },
    invalidate: [queryKeys.automations.all, queryKeys.overview],
    conflictKeys: [queryKeys.automations.all],
  });
}
