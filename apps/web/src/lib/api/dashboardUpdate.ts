"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardUpdateStatus } from "@friday/sdk";
import { call } from "./call";
import { getApiClient } from "./client";

export type { DashboardUpdateStatus } from "@friday/sdk";

export function useDashboardUpdateStatus(enabled: boolean, starting = false) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["dashboard-update"],
    queryFn: () => call(getApiClient().GET("/api/v1/dashboard-update")),
    enabled,
    staleTime: 0,
    refetchInterval: (query) => starting || query.state.data?.installing ? 2_000 : 30_000,
    retry: false,
  });
  return { ...query, refresh: async (): Promise<DashboardUpdateStatus> => {
    const status = await call(getApiClient().GET("/api/v1/dashboard-update", { params: { query: { refresh: "1" } } }));
    client.setQueryData(["dashboard-update"], status);
    return status;
  } };
}

export async function installDashboardUpdate(commit: string): Promise<void> {
  await call(getApiClient().POST("/api/v1/dashboard-update/install", { body: { commit } }));
}
