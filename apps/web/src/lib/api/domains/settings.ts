"use client";

import { clearOfflineCache } from "../../offlineCache/controller";
import type {
  ActionResult,
  AdapterConfigPatch,
  AdapterConfigSettingsListResponse,
  AdapterConfigSettingsResponse,
  AdapterTestResultResponse,
  LayoutImportRequest,
  LayoutListResponse,
  LayoutResponse,
  Settings,
  SettingsExport,
  SettingsPatch,
  SettingsResponse,
  ThemeImportRequest,
  ThemeListResponse,
  ThemeResponse,
  HermesConfigPatch,
  HermesConfigStatusResponse,
} from "@friday/sdk";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
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
  adapters: () =>
    queryOptions({
      queryKey: queryKeys.settings.adapters,
      queryFn: (): Promise<AdapterConfigSettingsListResponse> => call(getApiClient().GET("/api/v1/settings/adapters")),
      staleTime: staleTimes.settings,
    }),
};

export const useSettings = (enabled = true) => useQuery({ ...settingsQueries.root(), enabled });
export const useLayouts = (enabled = true) => useQuery({ ...settingsQueries.layouts(), enabled });
export const useThemes = (enabled = true) => useQuery({ ...settingsQueries.themes(), enabled });
export const useHermesConfig = (enabled = true) => useQuery({
  queryKey: ["settings", "hermes-config"],
  queryFn: (): Promise<HermesConfigStatusResponse> => call(getApiClient().GET("/api/v1/settings/hermes-config")),
  enabled,
  staleTime: 15000,
});
export function usePatchHermesConfig() {
  return useApiMutation<HermesConfigStatusResponse, { revision: number; patch: HermesConfigPatch } & IntentVars>({
    label: "Hermes-Konfiguration speichern",
    mutationFn: ({ revision, patch }) => call(getApiClient().PATCH("/api/v1/settings/hermes-config", {
      params: { header: { "If-Match": String(revision) } }, body: patch,
    })),
    invalidate: [["settings", "hermes-config"]],
  });
}
/** Adapter configuration (GET /settings/adapters is owner-only, so callers pass `enabled`). Secrets arrive masked only. */
export const useAdapterSettings = (enabled = true) => useQuery({ ...settingsQueries.adapters(), enabled });

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
    invalidate: [queryKeys.settings.root, ["context-weather"], ["voice", "integration-status"]],
    conflictKeys: [queryKeys.settings.root],
  });
}

/** PATCH /settings/adapters/{id}: `secrets` are write-only; the response only reports `secretFields[name].configured`. */
export function useUpdateAdapterSettings() {
  return useApiMutation<AdapterConfigSettingsResponse, { id: string; version: number; patch: AdapterConfigPatch } & IntentVars>({
    label: "Adapter-Konfiguration speichern",
    mutationFn: ({ id, version, patch }) =>
      call(getApiClient().PATCH("/api/v1/settings/adapters/{id}", { params: { path: { id }, header: { "If-Match": String(version) } }, body: patch })),
    invalidate: [queryKeys.settings.adapters, queryKeys.settings.root, queryKeys.adapters.all, queryKeys.capabilities, queryKeys.overview],
    conflictKeys: [queryKeys.settings.root, queryKeys.settings.adapters],
  });
}

/** Test Connection: the server tests the stored configuration of the adapter (never the browser, never with secrets in the response). */
export function useTestAdapterSettings() {
  return useApiMutation<AdapterTestResultResponse, { id: string } & IntentVars>({
    label: "Verbindungstest",
    silent: true,
    mutationFn: ({ id }) => call(getApiClient().POST("/api/v1/settings/adapters/{id}/test", { params: { path: { id } } })),
    invalidate: [queryKeys.settings.adapters, queryKeys.adapters.all],
  });
}

export function useImportTheme() {
  return useApiMutation<ThemeResponse, ThemeImportRequest & IntentVars>({
    label: "Theme importieren",
    mutationFn: ({ theme, activate }) =>
      call(getApiClient().POST("/api/v1/settings/themes/import", { body: { theme, ...(activate !== undefined ? { activate } : {}) } })),
    invalidate: [queryKeys.settings.themes, queryKeys.settings.root],
  });
}

/** Saves a layout (same `layoutId` replaces the stored one) and optionally makes it the active overview layout. */
export function useImportLayout() {
  return useApiMutation<LayoutResponse, LayoutImportRequest & IntentVars>({
    label: "Layout speichern",
    mutationFn: ({ layout, activate }) =>
      call(getApiClient().POST("/api/v1/settings/layouts/import", { body: { layout, ...(activate !== undefined ? { activate } : {}) } })),
    invalidate: [queryKeys.settings.layouts, queryKeys.settings.root],
  });
}

/** Import of a settings export document (secrets can never be part of it); the server validates against the schema. */
export function useImportSettings() {
  return useApiMutation<SettingsResponse, { document: SettingsExport } & IntentVars>({
    label: "Einstellungen importieren",
    mutationFn: ({ document }) => call(getApiClient().POST("/api/v1/settings/import", { body: document })),
    invalidate: [queryKeys.settings.root, queryKeys.settings.themes, queryKeys.settings.layouts, queryKeys.settings.adapters],
  });
}

/** GET /settings/export (never contains secrets). Imperative because the result is a download, not UI state. */
export function fetchSettingsExport(): Promise<SettingsExport> {
  return call(getApiClient().GET("/api/v1/settings/export"));
}

/** POST /auth/logout-all: ends every session of the current user (including this one). */
export function useLogoutAll() {
  const queryClient = useQueryClient();
  return useApiMutation<ActionResult, IntentVars>({
    label: "Alle Sitzungen beenden",
    mutationFn: () => call(getApiClient().POST("/api/v1/auth/logout-all")),
    invalidate: () => {
      queryClient.clear();
      clearOfflineCache();
      return [];
    },
  });
}
