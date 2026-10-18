"use client";

import { useQuery } from "@tanstack/react-query";
import { getCsrfToken } from "./client";

export interface DashboardUpdateStatus {
  installed: string | null;
  latest: string | null;
  available: boolean;
  installing: boolean;
  error: string | null;
  lastResult: { commit: string; status: "success" | "failed"; time: string; message?: string } | null;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body as T;
}

export function useDashboardUpdateStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard-update"],
    queryFn: async () => responseJson<DashboardUpdateStatus>(await fetch("/api/v1/dashboard-update", { credentials: "same-origin", cache: "no-store" })),
    enabled,
    staleTime: 60_000,
    refetchInterval: 30_000,
  });
}

export async function installDashboardUpdate(commit: string): Promise<void> {
  const token = getCsrfToken();
  await responseJson(await fetch("/api/v1/dashboard-update/install", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
    body: JSON.stringify({ commit }),
  }));
}
