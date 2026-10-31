"use client";

import type {
  MessengerTargetsResponse,
  NotificationListResponse,
  NotificationResponse,
  Priority,
  QuietModeResponse,
  QuietModeSummaryResponse,
} from "@friday/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface NotificationFilters {
  status?: ("open" | "acknowledged" | "snoozed" | "resolved")[];
  priority?: Priority[];
  category?: string;
  limit?: number;
  cursor?: string;
}

export const notificationQueries = {
  list: (filters: NotificationFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.notifications.list(filters),
      queryFn: (): Promise<NotificationListResponse> => call(getApiClient().GET("/api/v1/notifications", { params: { query: filters } })),
      staleTime: staleTimes.notifications,
    }),
};

export const useNotifications = (filters?: NotificationFilters, enabled = true) => useQuery({ ...notificationQueries.list(filters), enabled });

const invalidate = [queryKeys.notifications.all, queryKeys.overview] as const;
const ifMatch = (version: number | undefined): Record<string, string> => (version === undefined ? {} : { "If-Match": String(version) });

export function useAcknowledgeNotification() {
  return useApiMutation<NotificationResponse, { id: string; version?: number } & IntentVars>({
    label: "Meldung bestätigen",
    mutationFn: ({ id, version, idempotencyKey }) =>
      call(
        getApiClient().POST("/api/v1/notifications/{id}/acknowledge", {
          params: { path: { id }, header: { "Idempotency-Key": idempotencyKey, ...ifMatch(version) } },
        }),
      ),
    invalidate,
    conflictKeys: [queryKeys.notifications.all],
  });
}

export function useSnoozeNotification() {
  return useApiMutation<NotificationResponse, { id: string; version?: number; durationMinutes?: number; until?: string } & IntentVars>({
    label: "Meldung zurückstellen",
    mutationFn: ({ id, version, durationMinutes, until }) =>
      call(
        getApiClient().POST("/api/v1/notifications/{id}/snooze", {
          params: { path: { id }, header: ifMatch(version) },
          body: { durationMinutes, until },
        }),
      ),
    invalidate,
    conflictKeys: [queryKeys.notifications.all],
  });
}

export function useResolveNotification() {
  return useApiMutation<NotificationResponse, { id: string; version?: number } & IntentVars>({
    label: "Meldung auflösen",
    mutationFn: ({ id, version, idempotencyKey }) =>
      call(
        getApiClient().POST("/api/v1/notifications/{id}/resolve", {
          params: { path: { id }, header: { "Idempotency-Key": idempotencyKey, ...ifMatch(version) } },
        }),
      ),
    invalidate,
    conflictKeys: [queryKeys.notifications.all],
  });
}

const quietModeInvalidate = [queryKeys.quietMode, queryKeys.quietModeSummary] as const;

export const useQuietMode = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.quietMode,
    queryFn: (): Promise<QuietModeResponse> => call(getApiClient().GET("/api/v1/quiet-mode")),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled,
  });

export const useQuietModeSummary = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.quietModeSummary,
    queryFn: (): Promise<QuietModeSummaryResponse> => call(getApiClient().GET("/api/v1/quiet-mode/summary")),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled,
  });

export const useMessengerTargets = (enabled = true) =>
  useQuery({
    queryKey: ["messenger", "targets"],
    queryFn: (): Promise<MessengerTargetsResponse> => call(getApiClient().GET("/api/v1/messenger/targets")),
    retry: false,
    enabled,
  });

export function useSetQuietMode() {
  return useApiMutation<QuietModeResponse, { until: string; level?: "silent" | "voice_off" } & IntentVars>({
    label: "Ruhemodus starten",
    mutationFn: ({ until, level }) =>
      call(getApiClient().PUT("/api/v1/quiet-mode", { body: level ? { until, level } : { until } })),
    invalidate: quietModeInvalidate,
  });
}

export function useClearQuietMode() {
  return useApiMutation<QuietModeResponse, IntentVars>({
    label: "Ruhemodus beenden",
    mutationFn: () => call(getApiClient().DELETE("/api/v1/quiet-mode")),
    invalidate: quietModeInvalidate,
  });
}
