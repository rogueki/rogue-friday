"use client";

import type { AuditEventListResponse, AuditEventResponse, Severity } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export type AuditCategory = "user_action" | "agent_action" | "tool_call" | "approval" | "system" | "security";
export type AuditResult = "success" | "failure" | "denied" | "pending";
export type AuditExportFormat = "json" | "ndjson" | "csv";

export interface AuditFilters {
  action?: string;
  actor?: string;
  adapterId?: string;
  agentId?: string;
  category?: AuditCategory[];
  from?: string;
  to?: string;
  result?: AuditResult[];
  severity?: Severity[];
  taskId?: string;
  tool?: string;
  limit?: number;
  cursor?: string;
}

export const auditQueries = {
  list: (filters: AuditFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.audit.list(filters),
      queryFn: (): Promise<AuditEventListResponse> => call(getApiClient().GET("/api/v1/audit/events", { params: { query: filters } })),
      staleTime: staleTimes.activity,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: queryKeys.audit.detail(id),
      queryFn: (): Promise<AuditEventResponse> => call(getApiClient().GET("/api/v1/audit/events/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.activity,
    }),
};

export const useAuditEvents = (filters?: AuditFilters) => useQuery(auditQueries.list(filters));
export const useAuditEvent = (id: string | null | undefined) => useQuery({ ...auditQueries.detail(id ?? ""), enabled: Boolean(id) });

export interface AuditExportVars extends IntentVars {
  format: AuditExportFormat;
  from?: string;
  to?: string;
}

export interface AuditExportResult {
  format: AuditExportFormat;
  /** Raw export body exactly as the Control API delivered it. */
  body: string;
}

/** GET /audit/export; the body is kept as text so the download is byte-identical to the server export. */
export function useAuditExport() {
  return useApiMutation<AuditExportResult, AuditExportVars>({
    label: "Audit-Export",
    mutationFn: async ({ format, from, to }) => {
      const { data } = await getApiClient().GET("/api/v1/audit/export", {
        params: { query: { format, from, to } },
        parseAs: "text",
      });
      return { format, body: typeof data === "string" ? data : JSON.stringify(data ?? null) };
    },
  });
}
