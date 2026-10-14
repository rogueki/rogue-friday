"use client";

import type { AgentListResponse, AgentResponse, AgentStatus } from "@jarvis/sdk";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface AgentFilters {
  status?: AgentStatus[];
  q?: string;
  limit?: number;
  cursor?: string;
}

export const agentQueries = {
  list: (filters: AgentFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.agents.list(filters),
      queryFn: (): Promise<AgentListResponse> => call(getApiClient().GET("/api/v1/agents", { params: { query: filters } })),
      staleTime: staleTimes.agents,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: queryKeys.agents.detail(id),
      queryFn: (): Promise<AgentResponse> => call(getApiClient().GET("/api/v1/agents/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.agents,
    }),
};

/** Keeps the previous list while a changed filter or search loads, so the search field never loses focus. */
export const useAgents = (filters?: AgentFilters) => useQuery({ ...agentQueries.list(filters), placeholderData: keepPreviousData });
export const useAgent = (id: string | null | undefined) => useQuery({ ...agentQueries.detail(id ?? ""), enabled: Boolean(id) });

type AgentAction = "pause" | "resume" | "stop";

const AGENT_ACTION_LABELS: Record<AgentAction, string> = {
  pause: "Agent pausieren",
  resume: "Agent fortsetzen",
  stop: "Agent stoppen",
};

const AGENT_ACTION_PATHS = {
  pause: "/api/v1/agents/{id}/pause",
  resume: "/api/v1/agents/{id}/resume",
  stop: "/api/v1/agents/{id}/stop",
} as const;

export function useAgentAction(action: AgentAction) {
  return useApiMutation<AgentResponse, { id: string } & IntentVars>({
    label: AGENT_ACTION_LABELS[action],
    mutationFn: ({ id, idempotencyKey }) =>
      call(getApiClient().POST(AGENT_ACTION_PATHS[action], { params: { path: { id }, header: { "Idempotency-Key": idempotencyKey } } })),
    invalidate: [queryKeys.agents.all, queryKeys.overview],
  });
}
