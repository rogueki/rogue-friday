"use client";

import type { ModifiedSkillsResponse, SkillReportResponse, OnboardingResponse, OnboardingUpdate, SkillCatalogResponse, SkillHubSearchResponse, SkillMarkdownResponse, SkillResponse, PowerPointDeckRequest, PowerPointDeckResponse, PowerPointDeckListResponse } from "@friday/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";

export const skillsQueries = {
  catalog: () => queryOptions({
    queryKey: queryKeys.skills,
    queryFn: (): Promise<SkillCatalogResponse> => call(getApiClient().GET("/api/v1/skills")),
    staleTime: 30_000,
  }),
  onboarding: () => queryOptions({
    queryKey: queryKeys.onboarding,
    queryFn: (): Promise<OnboardingResponse> => call(getApiClient().GET("/api/v1/onboarding")),
    staleTime: 10_000,
  }),
};

export const useSkillsCatalog = (enabled = true) => useQuery({ ...skillsQueries.catalog(), enabled });

/** Registry search is a real CLI call with a network timeout; it only runs for an explicit query. */
export const useSkillHubSearch = (query: string, enabled = true) => useQuery({
  queryKey: ["skills", "hub-search", query],
  queryFn: (): Promise<SkillHubSearchResponse> => call(getApiClient().GET("/api/v1/skills/hub/search",
    { params: { query: { query, limit: 10 } } })),
  enabled: enabled && query.trim().length > 0,
  staleTime: 60_000,
  retry: false,
});

export const useModifiedSkills = (enabled = true) => useQuery({
  queryKey: ["skills", "modified"],
  queryFn: (): Promise<ModifiedSkillsResponse> => call(getApiClient().GET("/api/v1/skills/modified")),
  enabled,
  staleTime: 60_000,
  retry: false,
});
export const useSkillMarkdown = (id: string | null, enabled = true) => useQuery({
  queryKey: ["skills", "markdown", id],
  queryFn: (): Promise<SkillMarkdownResponse> => call(getApiClient().GET("/api/v1/skills/{id}/markdown",
    { params: { path: { id: id ?? "" } } })),
  enabled: enabled && id !== null,
  staleTime: 60_000,
});


/** The CLI's inspect or audit report for one skill or full identifier; a refusal arrives as 409 with the reason. */
export const useSkillReport = (action: "inspect" | "audit", name: string | null) => useQuery({
  queryKey: ["skills", action, name],
  queryFn: (): Promise<SkillReportResponse> => call(getApiClient().GET(
    action === "inspect" ? "/api/v1/skills/{name}/inspect" : "/api/v1/skills/{name}/audit",
    { params: { path: { name: name ?? "" } } })),
  enabled: name !== null,
  staleTime: 60_000,
  retry: false,
});

/** The CLI diff of one skill; 409 means the CLI refused and carries its reason in the error message. */
export const useSkillDiff = (name: string | null) => useQuery({
  queryKey: ["skills", "diff", name],
  queryFn: (): Promise<SkillReportResponse> => call(getApiClient().GET("/api/v1/skills/{name}/diff",
    { params: { path: { name: name ?? "" } } })),
  enabled: name !== null,
  staleTime: 0,
  retry: false,
});

export const useOnboarding = (enabled = true) => useQuery({ ...skillsQueries.onboarding(), enabled });

const powerpointDecksKey = ["powerpoint", "decks"] as const;
export const useRecentPowerPointDecks = () => useQuery({ queryKey: powerpointDecksKey,
  queryFn: (): Promise<PowerPointDeckListResponse> => call(getApiClient().GET("/api/v1/skills/powerpoint/decks")) });

export function useCreatePowerPointDeck() {
  return useApiMutation<PowerPointDeckResponse, PowerPointDeckRequest & IntentVars>({
    label: "PowerPoint erstellen",
    mutationFn: ({ title, slides }) => call(getApiClient().POST("/api/v1/skills/powerpoint/decks", { body: { title, slides } })),
    invalidate: [powerpointDecksKey],
  });
}

export function useSetSkillActivation() {
  return useApiMutation<SkillResponse, { id: string; enabled: boolean } & IntentVars>({
    label: "Skill-Aktivierung ändern",
    mutationFn: ({ id, enabled }) => call(getApiClient().PUT("/api/v1/skills/{id}/activation", { params: { path: { id } }, body: { enabled } })),
    invalidate: [queryKeys.skills],
  });
}

export function useUpdateOnboarding() {
  return useApiMutation<OnboardingResponse, { revision: number; update: OnboardingUpdate } & IntentVars>({
    label: "Einführung speichern",
    mutationFn: ({ revision, update }) => call(getApiClient().PUT("/api/v1/onboarding", {
      params: { header: { "If-Match": String(revision) } }, body: update,
    })),
    invalidate: [queryKeys.onboarding],
    conflictKeys: [queryKeys.onboarding],
  });
}
