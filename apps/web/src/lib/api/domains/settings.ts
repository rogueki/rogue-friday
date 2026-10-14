"use client";

import type { LayoutListResponse, Settings, SettingsPatch, SettingsResponse, ThemeListResponse } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { patchQueries, useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export const settingsQueries = {
  root: () =>
    queryOptions({
      queryKey: queryKeys.settings.root,
      queryFn: (): Promise<SettingsResponse> => call(getApiClient().GET("/api/v1/settings")),
      staleTime: staleTimes.settings,
    }),
  layouts: () =>
    queryOptions({
      queryKey: queryKeys.settings.layouts,
      queryFn: (): Promise<LayoutListResponse> => call(getApiClient().GET("/api/v1/settings/layouts")),
      staleTime: staleTimes.settings,
    }),
  themes: () =>
    queryOptions({
      queryKey: queryKeys.settings.themes,
      queryFn: (): Promise<ThemeListResponse> => call(getApiClient().GET("/api/v1/settings/themes")),
      staleTime: staleTimes.settings,
    }),
};

export const useSettings = (enabled = true) => useQuery({ ...settingsQueries.root(), enabled });
export const useLayouts = (enabled = true) => useQuery({ ...settingsQueries.layouts(), enabled });
export const useThemes = (enabled = true) => useQuery({ ...settingsQueries.themes(), enabled });

/**
 * PATCH /settings: every supplied area replaces the stored area as a whole. Settings are reversible and local to the
 * operator, so the cache is patched optimistically; this is what makes theme, orb, motion and nav changes apply live.
 */
export function useUpdateSettings() {
  return useApiMutation<SettingsResponse, { version: number; patch: SettingsPatch } & IntentVars>({
    label: "Einstellungen speichern",
    mutationFn: ({ version, patch }) =>
      call(getApiClient().PATCH("/api/v1/settings", { params: { header: { "If-Match": String(version) } }, body: patch })),
    optimistic: (queryClient, { patch }) =>
      patchQueries<SettingsResponse>(queryClient, queryKeys.settings.root, (old) => ({
        ...old,
        data: { ...old.data, ...(patch as Partial<Settings>) },
      })),
    invalidate: [queryKeys.settings.root],
    conflictKeys: [queryKeys.settings.root],
  });
}
