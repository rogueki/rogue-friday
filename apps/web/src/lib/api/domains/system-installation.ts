"use client";

import type { SystemInstallationResponse } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";

export function useSystemInstallation() {
  return useQuery({ queryKey: ["system-installation"] as const, retry: false,
    queryFn: (): Promise<SystemInstallationResponse> => call(getApiClient().GET("/api/v1/system/installation")) });
}
