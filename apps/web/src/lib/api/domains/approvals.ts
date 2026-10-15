"use client";

import type {
  ApprovalContextRequest,
  ApprovalDecisionRequest,
  ApprovalListResponse,
  ApprovalResponse,
  ApprovalStatus,
  ApprovalType,
  ReauthResponse,
  RiskTier,
} from "@friday/sdk";
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";
import { useCursorPages } from "./cursorPages";

export interface ApprovalFilters {
  status?: ApprovalStatus[];
  type?: ApprovalType[];
  riskTier?: RiskTier[];
  agentId?: string;
  taskId?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Short-lived, single-use token that GET /approvals/{id} hands out in the `X-Approval-Token` response header for
 * pending approvals the caller may decide (PLAN §32.5). It must be sent back as `X-Approval-Token` on approve.
 * The token lives only in the query cache (memory), is never logged and is dropped after a minute.
 */
export interface ApprovalDecisionToken {
  approvalId: string;
  /** Header value; `null` when the server issued none (decided approval, missing role, or a backend without tokens). */
  token: string | null;
  /** `X-Approval-Token-Expires` (UTC ISO-8601) or `null`. */
  expiresAt: string | null;
  /** The approval as delivered together with the token. */
  approval: ApprovalResponse;
}

const TOKEN_GC_MS = 60_000;
/** A token that expires within this window is replaced before it is used. */
const TOKEN_EXPIRY_MARGIN_MS = 5_000;

async function fetchApprovalToken(id: string): Promise<ApprovalDecisionToken> {
  const { data, response } = await getApiClient().GET("/api/v1/approvals/{id}", { params: { path: { id } } });
  if (data === undefined) {
    // The SDK middleware throws for every non-2xx status; an empty 2xx body is a broken contract.
    throw new Error(`Leere Antwort beim Öffnen der Freigabe (HTTP ${response.status})`);
  }
  return {
    approvalId: id,
    token: response.headers.get("X-Approval-Token"),
    expiresAt: response.headers.get("X-Approval-Token-Expires"),
    approval: data,
  };
}

/** Tokens that were already sent with an approve: the server consumes them on first use, a retry needs a fresh one. */
const spentTokens = new Set<string>();
const MAX_SPENT_TOKENS = 64;

function markTokenSpent(token: string): void {
  spentTokens.add(token);
  if (spentTokens.size > MAX_SPENT_TOKENS) {
    const oldest = spentTokens.values().next().value;
    if (oldest !== undefined) spentTokens.delete(oldest);
  }
}

/** `true` when a token exists, was not used yet and will not expire within the next seconds. */
export function isApprovalTokenUsable(
  token: ApprovalDecisionToken | undefined,
  now: number = Date.now(),
): token is ApprovalDecisionToken & { token: string } {
  if (!token?.token || spentTokens.has(token.token)) return false;
  if (!token.expiresAt) return true;
  const expires = Date.parse(token.expiresAt);
  return Number.isNaN(expires) || expires - TOKEN_EXPIRY_MARGIN_MS > now;
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
  /** Opens the approval for a decision: the response header carries the approval token. */
  token: (id: string) =>
    queryOptions({
      queryKey: queryKeys.approvals.token(id),
      queryFn: () => fetchApprovalToken(id),
      // Every open of the details issues a fresh token; it is only refetched explicitly (expired, consumed, failed attempt).
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: TOKEN_GC_MS,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};

/** Keeps the previous list while a changed filter loads, so the filter controls never vanish under the user. */
export const useApprovals = (filters?: ApprovalFilters) => useQuery({ ...approvalQueries.list(filters), placeholderData: keepPreviousData });
export const useApproval = (id: string | null | undefined) => useQuery({ ...approvalQueries.detail(id ?? ""), enabled: Boolean(id) });

/** List with cursor pagination ("Mehr laden"); the first page is live-patched by realtime events. */
export function useApprovalPages(filters: ApprovalFilters = {}) {
  const first = useApprovals(filters);
  const pages = useCursorPages<ApprovalResponse["data"], ApprovalListResponse, ReturnType<typeof queryKeys.approvals.list>>(
    first.data,
    (cursor) => approvalQueries.list({ ...filters, cursor }),
    JSON.stringify(filters),
  );
  return { first, ...pages };
}

/**
 * Approval token of the opened approval (issued by the GET). `enabled` should only be true while the details of a
 * pending approval are visible and the caller may decide, so no token is issued needlessly.
 */
export function useApprovalToken(id: string | null | undefined, enabled: boolean) {
  return useQuery({ ...approvalQueries.token(id ?? ""), enabled: Boolean(id) && enabled });
}

/** Returns a function that yields a usable token, refetching the approval when the cached token is missing or expiring. */
export function useEnsureApprovalToken() {
  const queryClient = useQueryClient();
  return useCallback(
    async (id: string): Promise<ApprovalDecisionToken> => {
      const cached = queryClient.getQueryData<ApprovalDecisionToken>(queryKeys.approvals.token(id));
      if (isApprovalTokenUsable(cached)) return cached;
      return queryClient.fetchQuery({ ...approvalQueries.token(id), staleTime: 0 });
    },
    [queryClient],
  );
}

/** Refetches the approval token (and thereby the approval) after a failed or consumed attempt. */
export function useRefreshApprovalToken() {
  const queryClient = useQueryClient();
  return useCallback(
    (id: string) => queryClient.fetchQuery({ ...approvalQueries.token(id), staleTime: 0 }),
    [queryClient],
  );
}

const invalidate = [queryKeys.approvals.all, queryKeys.overview, queryKeys.tasks.all, queryKeys.notifications.all] as const;

/**
 * Approvals are NEVER optimistic (PLAN §48.9): the UI only changes once the server confirmed the decision, because the
 * server re-checks the decision (tier, re-auth, expiry) before anything is executed. An approve carries the approval
 * token (`X-Approval-Token`, §32.5); errors are shown inline by the approval UI (`silent`).
 */
export function useDecideApproval(decision: "approve" | "reject") {
  return useApiMutation<
    ApprovalResponse,
    { id: string; version?: number; body?: ApprovalDecisionRequest; approvalToken?: string } & IntentVars
  >({
    label: decision === "approve" ? "Freigabe erteilen" : "Freigabe ablehnen",
    silent: true,
    mutationFn: ({ id, version, body, approvalToken, idempotencyKey }) => {
      if (decision === "approve" && approvalToken) markTokenSpent(approvalToken);
      return call(
        getApiClient().POST(decision === "approve" ? "/api/v1/approvals/{id}/approve" : "/api/v1/approvals/{id}/reject", {
          params: {
            path: { id },
            header: {
              "Idempotency-Key": idempotencyKey,
              ...(version === undefined ? {} : { "If-Match": String(version) }),
              ...(decision === "approve" && approvalToken ? { "X-Approval-Token": approvalToken } : {}),
            },
          },
          body: { inputChannel: "dashboard", ...body },
        }),
      );
    },
    invalidate,
    conflictKeys: [queryKeys.approvals.all],
  });
}

/** POST /auth/reauth: password re-entry for tier-3 decisions; the returned token is single use. */
export function useReauth() {
  return useApiMutation<ReauthResponse, { password: string } & IntentVars>({
    label: "Erneute Anmeldung",
    silent: true,
    mutationFn: ({ password }) => call(getApiClient().POST("/api/v1/auth/reauth", { body: { password } })),
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
