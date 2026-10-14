"use client";

import type {
  AdapterHealthResponse,
  AdapterInfoListResponse,
  AdapterTestResultResponse,
  HealthcheckResultResponse,
  ModelProviderListResponse,
  ServiceListResponse,
  StorageVolumeListResponse,
  SystemMetricsResponse,
} from "@jarvis/sdk";
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
  adapters: () =>
    queryOptions({
      queryKey: queryKeys.adapters.list({}),
      queryFn: (): Promise<AdapterInfoListResponse> => call(getApiClient().GET("/api/v1/adapters", { params: { query: { limit: 100 } } })),
      staleTime: staleTimes.system,
    }),
};

export const useSystemMetrics = () => useQuery(systemQueries.metrics());
export const useServices = () => useQuery(systemQueries.services());
export const useStorage = () => useQuery(systemQueries.storage());
export const useModelProviders = () => useQuery(systemQueries.models());
export const useAdapters = () => useQuery(systemQueries.adapters());

export function useServiceHealthcheck() {
  return useApiMutation<HealthcheckResultResponse, { id: string } & IntentVars>({
    label: "Health-Check",
    mutationFn: ({ id }) =>
      call(getApiClient().POST("/api/v1/system/services/{id}/healthcheck", { params: { path: { id } } })),
    invalidate: [queryKeys.system.services, queryKeys.health],
  });
}

/** Fresh health probe of one adapter (GET /adapters/{id}/health); the result also patches the adapter matrix. */
export function useAdapterHealthCheck() {
  return useApiMutation<AdapterHealthResponse, { id: string } & IntentVars>({
    label: "Adapter-Healthcheck",
    mutationFn: ({ id }) => call(getApiClient().GET("/api/v1/adapters/{id}/health", { params: { path: { id } } })),
    invalidate: [queryKeys.adapters.all, queryKeys.health],
  });
}

/** Re-establishes the connection of an adapter by running its connection test (POST /settings/adapters/{id}/test). */
export function useAdapterReconnect() {
  return useApiMutation<AdapterTestResultResponse, { id: string } & IntentVars>({
    label: "Adapter neu verbinden",
    mutationFn: ({ id }) => call(getApiClient().POST("/api/v1/settings/adapters/{id}/test", { params: { path: { id } } })),
    invalidate: [queryKeys.adapters.all, queryKeys.health, queryKeys.system.services],
  });
}
