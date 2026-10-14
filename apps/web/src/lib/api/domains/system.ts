"use client";

import type { HealthcheckResultResponse, ModelProviderListResponse, ServiceListResponse, StorageVolumeListResponse, SystemMetricsResponse } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export const systemQueries = {
  metrics: () =>
    queryOptions({
      queryKey: queryKeys.system.metrics,
      queryFn: (): Promise<SystemMetricsResponse> => call(getApiClient().GET("/api/v1/system/metrics")),
      staleTime: staleTimes.system,
    }),
  services: () =>
    queryOptions({
      queryKey: queryKeys.system.services,
      queryFn: (): Promise<ServiceListResponse> => call(getApiClient().GET("/api/v1/system/services")),
      staleTime: staleTimes.system,
    }),
  storage: () =>
    queryOptions({
      queryKey: queryKeys.system.storage,
      queryFn: (): Promise<StorageVolumeListResponse> => call(getApiClient().GET("/api/v1/system/storage")),
      staleTime: staleTimes.system,
    }),
  models: () =>
    queryOptions({
      queryKey: queryKeys.system.models,
      queryFn: (): Promise<ModelProviderListResponse> => call(getApiClient().GET("/api/v1/system/models")),
      staleTime: staleTimes.system,
    }),
};

export const useSystemMetrics = () => useQuery(systemQueries.metrics());
export const useServices = () => useQuery(systemQueries.services());
export const useStorage = () => useQuery(systemQueries.storage());
export const useModelProviders = () => useQuery(systemQueries.models());

export function useServiceHealthcheck() {
  return useApiMutation<HealthcheckResultResponse, { id: string } & IntentVars>({
    label: "Health-Check",
    mutationFn: ({ id }) =>
      call(getApiClient().POST("/api/v1/system/services/{id}/healthcheck", { params: { path: { id } } })),
    invalidate: [queryKeys.system.services, queryKeys.health],
  });
}
