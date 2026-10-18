"use client";

import type { SystemBackupActionRequest, SystemBackupActionResponse, SystemBackupStatusResponse } from "@friday/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";

const key = ["system-backups"] as const;

export function useSystemBackupStatus(enabled: boolean) {
  return useQuery({ queryKey: key, enabled, retry: false,
    queryFn: (): Promise<SystemBackupStatusResponse> => call(getApiClient().GET("/api/v1/system-backups")) });
}

export function useSystemBackupAction() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (body: SystemBackupActionRequest): Promise<SystemBackupActionResponse> =>
    call(getApiClient().POST("/api/v1/system-backups/actions", { body })),
  onSuccess: () => void client.invalidateQueries({ queryKey: key }) });
}
