"use client";

import type { ApprovalResponse, ChannelListResponse, components, DraftCreateRequest, DraftUpdateRequest, Priority, ThreadListResponse, ThreadResponse } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

type DraftResponse = components["schemas"]["DraftResponse"];

export interface ThreadFilters {
  channelId?: string;
  status?: ("open" | "waiting" | "replied" | "archived")[];
  priority?: Priority[];
  needsReply?: boolean;
  hasDraft?: boolean;
  q?: string;
  limit?: number;
  cursor?: string;
}

export const communicationQueries = {
  channels: () =>
    queryOptions({
      queryKey: queryKeys.communication.channels,
      queryFn: (): Promise<ChannelListResponse> => call(getApiClient().GET("/api/v1/communication/channels")),
      staleTime: staleTimes.communication,
    }),
  threads: (filters: ThreadFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.communication.threads.list(filters),
      queryFn: (): Promise<ThreadListResponse> => call(getApiClient().GET("/api/v1/communication/threads", { params: { query: filters } })),
      staleTime: staleTimes.communication,
    }),
  thread: (id: string) =>
    queryOptions({
      queryKey: queryKeys.communication.threads.detail(id),
      queryFn: (): Promise<ThreadResponse> => call(getApiClient().GET("/api/v1/communication/threads/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.communication,
    }),
};

export const useChannels = () => useQuery(communicationQueries.channels());
export const useThreads = (filters?: ThreadFilters) => useQuery(communicationQueries.threads(filters));
export const useThread = (id: string | null | undefined) => useQuery({ ...communicationQueries.thread(id ?? ""), enabled: Boolean(id) });

const invalidate = [queryKeys.communication.threads.all, queryKeys.communication.drafts.all, queryKeys.overview] as const;

/** Drafts are created freely; sending always goes through `useRequestDraftSend` and an approval (PLAN §33.5). */
export function useCreateDraft() {
  return useApiMutation<DraftResponse, DraftCreateRequest & IntentVars>({
    label: "Entwurf anlegen",
    mutationFn: ({ idempotencyKey, ...body }) =>
      call(getApiClient().POST("/api/v1/communication/drafts", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
    invalidate,
  });
}

export function useUpdateDraft() {
  return useApiMutation<DraftResponse, { id: string; version: number; patch: DraftUpdateRequest } & IntentVars>({
    label: "Entwurf ändern",
    mutationFn: ({ id, version, patch }) =>
      call(
        getApiClient().PATCH("/api/v1/communication/drafts/{id}", {
          params: { path: { id }, header: { "If-Match": String(version) } },
          body: patch,
        }),
      ),
    invalidate,
    conflictKeys: [queryKeys.communication.drafts.all],
  });
}

export function useRequestDraftSend() {
  return useApiMutation<ApprovalResponse, { id: string; comment?: string } & IntentVars>({
    label: "Versand anfragen",
    mutationFn: ({ id, comment, idempotencyKey }) =>
      call(
        getApiClient().POST("/api/v1/communication/drafts/{id}/request-send", {
          params: { path: { id }, header: { "Idempotency-Key": idempotencyKey } },
          body: { comment },
        }),
      ),
    invalidate: [...invalidate, queryKeys.approvals.all],
  });
}
