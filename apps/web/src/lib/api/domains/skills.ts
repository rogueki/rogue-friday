"use client";

import type { OnboardingResponse, OnboardingUpdate, SkillCatalogResponse, SkillResponse } from "@friday/sdk";
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
export const useOnboarding = (enabled = true) => useQuery({ ...skillsQueries.onboarding(), enabled });

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
