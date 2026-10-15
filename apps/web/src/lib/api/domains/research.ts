"use client";

import type {
  ResearchArtifactListResponse,
  ResearchFindingListResponse,
  ResearchProjectListResponse,
  ResearchProjectResponse,
  ResearchSourceListResponse,
} from "@friday/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface ResearchFilters {
  q?: string;
  limit?: number;
  cursor?: string;
}

/** Sub-resource lists are capped by the server page size; research projects stay well below it. */
const CHILD_LIMIT = 200;

export const researchQueries = {
  list: (filters: ResearchFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.research.list(filters),
      queryFn: (): Promise<ResearchProjectListResponse> => call(getApiClient().GET("/api/v1/research/projects", { params: { query: filters } })),
      staleTime: staleTimes.files,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: queryKeys.research.detail(id),
      queryFn: (): Promise<ResearchProjectResponse> => call(getApiClient().GET("/api/v1/research/projects/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.files,
    }),
  sources: (id: string) =>
    queryOptions({
      queryKey: queryKeys.research.sources(id),
      queryFn: (): Promise<ResearchSourceListResponse> =>
        call(getApiClient().GET("/api/v1/research/projects/{id}/sources", { params: { path: { id }, query: { limit: CHILD_LIMIT } } })),
      staleTime: staleTimes.files,
    }),
  findings: (id: string) =>
    queryOptions({
      queryKey: queryKeys.research.findings(id),
      queryFn: (): Promise<ResearchFindingListResponse> =>
        call(getApiClient().GET("/api/v1/research/projects/{id}/findings", { params: { path: { id }, query: { limit: CHILD_LIMIT } } })),
      staleTime: staleTimes.files,
    }),
  artifacts: (id: string) =>
    queryOptions({
      queryKey: queryKeys.research.artifacts(id),
      queryFn: (): Promise<ResearchArtifactListResponse> =>
        call(getApiClient().GET("/api/v1/research/projects/{id}/artifacts", { params: { path: { id }, query: { limit: CHILD_LIMIT } } })),
      staleTime: staleTimes.files,
    }),
};

export const useResearchProjects = (filters?: ResearchFilters) => useQuery(researchQueries.list(filters));
export const useResearchProject = (id: string | null | undefined) => useQuery({ ...researchQueries.detail(id ?? ""), enabled: Boolean(id) });
export const useResearchSources = (id: string | null | undefined) => useQuery({ ...researchQueries.sources(id ?? ""), enabled: Boolean(id) });
export const useResearchFindings = (id: string | null | undefined) => useQuery({ ...researchQueries.findings(id ?? ""), enabled: Boolean(id) });
export const useResearchArtifacts = (id: string | null | undefined) => useQuery({ ...researchQueries.artifacts(id ?? ""), enabled: Boolean(id) });
