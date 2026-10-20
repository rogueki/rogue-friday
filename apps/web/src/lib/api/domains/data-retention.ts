"use client";

import type { DataRetentionActionRequest, DataRetentionActionResponse, DataRetentionStatusResponse } from "@friday/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";

const key = ["data-retention"] as const;

export function useDataRetentionStatus(enabled: boolean) {
  return useQuery({ queryKey: key, enabled, retry: false,
    queryFn: (): Promise<DataRetentionStatusResponse> => call(getApiClient().GET("/api/v1/data-retention")) });
}

export function useDataRetentionAction() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (body: DataRetentionActionRequest): Promise<DataRetentionActionResponse> =>
    call(getApiClient().POST("/api/v1/data-retention/actions", { body })),
  onSuccess: () => void client.invalidateQueries({ queryKey: key }) });
}
