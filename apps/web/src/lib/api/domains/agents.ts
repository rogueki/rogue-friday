"use client";

import type { AgentListResponse, AgentResponse, AgentStatus } from "@friday/sdk";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
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

// Agent pause/resume/stop are staged writes since the P9 agent slice and run through
// `features/agents/useAgentCommands` on the shared staged-write runner.
