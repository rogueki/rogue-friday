"use client";

import type { Capabilities, Health, FridayStatusResponse, Meta, OrbSnapshotResponse, OverviewResponse, SessionResponse } from "@friday/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { isApiUnreachable } from "../../offlineCache/controller";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

/** Meta, health, capabilities, overview, status and orb: the bootstrap and snapshot endpoints (PLAN §47). */
export const coreQueries = {
  meta: () =>
    queryOptions({
      queryKey: queryKeys.meta,
      queryFn: (): Promise<Meta> => call(getApiClient().GET("/api/v1/meta")),
      staleTime: staleTimes.meta,
      // Scenario runs (dev console) flip UI hints such as forceOrbFallback2D in `features`; pick them up without a reload.
      refetchInterval: (query) => (query.state.data?.features.devScenarios ? 5_000 : false),
    }),
  session: () =>
    queryOptions({
      queryKey: queryKeys.session,
      queryFn: (): Promise<SessionResponse> => call(getApiClient().GET("/api/v1/auth/session")),
      staleTime: staleTimes.session,
      retry: false,
      // Observers that mount while the API is away must not each start another request; the interval below handles recovery.
      retryOnMount: false,
      // An unreachable API: keep asking so the offline cache hands over to live data as soon as it is back.
      refetchInterval: () => (isApiUnreachable() ? 10_000 : false),
    }),
  health: () =>
    queryOptions({
      queryKey: queryKeys.health,
      queryFn: (): Promise<Health> => call(getApiClient().GET("/api/v1/health")),
      staleTime: staleTimes.health,
    }),
  capabilities: () =>
    queryOptions({
      queryKey: queryKeys.capabilities,
      queryFn: (): Promise<Capabilities> => call(getApiClient().GET("/api/v1/capabilities")),
      staleTime: staleTimes.capabilities,
    }),
  overview: () =>
    queryOptions({
      queryKey: queryKeys.overview,
      queryFn: (): Promise<OverviewResponse> => call(getApiClient().GET("/api/v1/overview")),
      staleTime: staleTimes.overview,
    }),
  status: () =>
    queryOptions({
      queryKey: queryKeys.status,
      queryFn: (): Promise<FridayStatusResponse> => call(getApiClient().GET("/api/v1/status")),
      staleTime: staleTimes.status,
    }),
  orb: () =>
    queryOptions({
      queryKey: queryKeys.orb,
      queryFn: (): Promise<OrbSnapshotResponse> => call(getApiClient().GET("/api/v1/orb/status")),
      staleTime: staleTimes.orb,
    }),
};

export const useMeta = () => useQuery(coreQueries.meta());
export const useHealth = () => useQuery(coreQueries.health());
export const useOverview = () => useQuery(coreQueries.overview());
export const useFridayStatus = () => useQuery(coreQueries.status());
export const useOrbStatusQuery = () => useQuery(coreQueries.orb());
