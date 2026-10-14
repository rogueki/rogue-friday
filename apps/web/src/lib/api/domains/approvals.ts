"use client";

import type {
  ApprovalContextRequest,
  ApprovalDecisionRequest,
  ApprovalListResponse,
  ApprovalResponse,
  ApprovalStatus,
  ApprovalType,
  RiskTier,
} from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface ApprovalFilters {
  status?: ApprovalStatus[];
  type?: ApprovalType[];
  riskTier?: RiskTier[];
  agentId?: string;
  taskId?: string;
  limit?: number;
  cursor?: string;
}

export const approvalQueries = {
  list: (filters: ApprovalFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.approvals.list(filters),
      queryFn: (): Promise<ApprovalListResponse> => call(getApiClient().GET("/api/v1/approvals", { params: { query: filters } })),
      staleTime: staleTimes.approvals,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: queryKeys.approvals.detail(id),
      queryFn: (): Promise<ApprovalResponse> => call(getApiClient().GET("/api/v1/approvals/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.approvals,
    }),
};

export const useApprovals = (filters?: ApprovalFilters) => useQuery(approvalQueries.list(filters));
export const useApproval = (id: string | null | undefined) => useQuery({ ...approvalQueries.detail(id ?? ""), enabled: Boolean(id) });

const invalidate = [queryKeys.approvals.all, queryKeys.overview, queryKeys.tasks.all, queryKeys.notifications.all] as const;

/**
 * Approvals are NEVER optimistic (PLAN §48.9): the UI only changes once the server confirmed the decision, because the
 * server re-checks the decision (tier, re-auth, expiry) before anything is executed.
 */
export function useDecideApproval(decision: "approve" | "reject") {
  return useApiMutation<ApprovalResponse, { id: string; version?: number; body?: ApprovalDecisionRequest } & IntentVars>({
    label: decision === "approve" ? "Freigabe erteilen" : "Freigabe ablehnen",
    mutationFn: ({ id, version, body, idempotencyKey }) =>
      call(
        getApiClient().POST(decision === "approve" ? "/api/v1/approvals/{id}/approve" : "/api/v1/approvals/{id}/reject", {
          params: {
            path: { id },
            header: { "Idempotency-Key": idempotencyKey, ...(version === undefined ? {} : { "If-Match": String(version) }) },
          },
          body: { inputChannel: "dashboard", ...body },
        }),
      ),
    invalidate,
    conflictKeys: [queryKeys.approvals.all],
  });
}

export function useRequestApprovalContext() {
  return useApiMutation<ApprovalResponse, { id: string } & ApprovalContextRequest & IntentVars>({
    label: "Kontext anfordern",
    mutationFn: ({ id, question, idempotencyKey }) =>
      call(
        getApiClient().POST("/api/v1/approvals/{id}/request-context", {
          params: { path: { id }, header: { "Idempotency-Key": idempotencyKey } },
          body: { question },
        }),
      ),
    invalidate: [queryKeys.approvals.all],
  });
}
