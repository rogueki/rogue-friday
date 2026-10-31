"use client";

import { clearOfflineCache } from "../../offlineCache/controller";
import type {
  ActionResult,
  AdapterConfigPatch,
  AdapterConfigSettingsListResponse,
  AdapterConfigSettingsResponse,
  AdapterTestResultResponse,
  HermesAccessResponse,
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
  HermesModelCatalogResponse,
  HermesMcpProbeResponse,
  HermesApprovalTestResponse,
  HermesMcpOAuthResponse,
  HermesProviderOAuthResponse,
  HermesCronJobsResponse,
  HermesCronMutationRequest,
  HermesCronMutationResponse,
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

export const useHermesCronJobs = (enabled = true) => useQuery({
  queryKey: ["settings", "hermes-cron-jobs"],
  queryFn: (): Promise<HermesCronJobsResponse> => call(getApiClient().GET("/api/v1/settings/hermes-cron/jobs"))
    .then((response) => response as unknown as HermesCronJobsResponse),
  enabled,
  staleTime: 15000,
});

export function sendHermesCronMutation(body: HermesCronMutationRequest, previewId?: string, discard = false) {
  const headers = previewId ? { "X-Action-Preview-Id": previewId,
    ...(discard ? { "X-Action-Preview-Cancel": "true" } : {}) } : undefined;
  return call(getApiClient().POST("/api/v1/settings/hermes-cron/jobs", { body, ...(headers ? { headers } : {}) })) as Promise<HermesCronMutationResponse>;
}

export const useHermesModelCatalog = (providerId?: string, enabled = true) => useQuery({
  queryKey: ["hermes-model-catalog", providerId ?? null],
  queryFn: (): Promise<HermesModelCatalogResponse> => call(getApiClient().GET(
    "/api/v1/settings/hermes-model-catalog", { params: { query: providerId ? { providerId } : {} } })),
  enabled,
  staleTime: 0,
});
export const useHermesAccess = (enabled = true) => useQuery({
  queryKey: ["settings", "hermes-access"],
  queryFn: (): Promise<HermesAccessResponse> => call(getApiClient().GET("/api/v1/settings/hermes-access")),
  enabled,
  staleTime: 0,
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
export function useProbeHermesMcp() {
  return useApiMutation<HermesMcpProbeResponse, { name: string; revision: number } & IntentVars>({
    label: "Hermes-MCP-Verbindung pruefen",
    mutationFn: ({ name, revision }) => call(getApiClient().POST("/api/v1/settings/hermes-config/mcp-probe", {
      params: { header: { "If-Match": String(revision) } }, body: { name },
    })).then((response) => {
      if (!("runtimeApplied" in response.data) || response.data.runtimeApplied !== null)
        throw new Error("Hermes-MCP-Probe ohne Laufzeitkennzeichnung.");
      return response as HermesMcpProbeResponse;
    }),
  });
}
export function useTestHermesApproval() {
  return useApiMutation<HermesApprovalTestResponse, { command: string; revision: number } & IntentVars>({
    label: "Hermes-Befehlsfreigabe pruefen",
    mutationFn: ({ command, revision }) => call(getApiClient().POST("/api/v1/settings/hermes-config/approval-test", {
      params: { header: { "If-Match": String(revision) } }, body: { command },
    })).then((response) => {
      if (!("runtimeApplied" in response.data) || response.data.runtimeApplied !== null)
        throw new Error("Hermes-Freigabevorschau ohne Laufzeitkennzeichnung.");
      return response as HermesApprovalTestResponse;
    }),
  });
}
export function useManageHermesMcpOAuth() {
  return useApiMutation<HermesMcpOAuthResponse,
    ({ action: "start"; name: string } | { action: "status" | "cancel"; flowId: string }) &
    { revision: number } & IntentVars>({
    label: "Hermes-MCP-OAuth",
    mutationFn: ({ revision, ...body }) => call(getApiClient().POST("/api/v1/settings/hermes-config/mcp-oauth", {
      params: { header: { "If-Match": String(revision) } }, body,
    })).then((response) => {
      if (!("runtimeApplied" in response.data) || response.data.runtimeApplied !== null)
        throw new Error("Hermes-MCP-OAuth ohne Laufzeitkennzeichnung.");
      return response as HermesMcpOAuthResponse;
    }),
    invalidate: [["settings", "hermes-config"]],
  });
}
export function useHermesMcpOAuthFlow(flowId: string | null, revision: number | null) {
  return useQuery({
    queryKey: ["settings", "hermes-mcp-oauth", flowId],
    queryFn: (): Promise<HermesMcpOAuthResponse> => call(getApiClient().POST("/api/v1/settings/hermes-config/mcp-oauth", {
      params: { header: { "If-Match": String(revision) } }, body: { action: "status", flowId: flowId! },
    })).then((response) => {
      if (!("runtimeApplied" in response.data) || response.data.runtimeApplied !== null)
        throw new Error("Hermes-MCP-OAuth ohne Laufzeitkennzeichnung.");
      return response as HermesMcpOAuthResponse;
    }),
    enabled: flowId !== null && revision !== null,
    refetchInterval: (query) => ["configured", "failed"].includes(query.state.data?.data.status ?? "") ? false : 2000,
  });
}
export type HermesOAuthProvider = "nous" | "openai-codex" | "xai-oauth" | "minimax-oauth";
/** Starts or cancels a provider login that Hermes runs as a device-code flow; Hermes stores the credential itself. */
export function useManageHermesProviderOAuth() {
  return useApiMutation<HermesProviderOAuthResponse,
    ({ action: "start"; provider: HermesOAuthProvider } | { action: "cancel"; flowId: string }) & IntentVars>({
    label: "Hermes-Anmeldung",
    mutationFn: (vars) => call(getApiClient().POST("/api/v1/settings/hermes-access/oauth", {
      body: vars.action === "start" ? { action: "start", provider: vars.provider } : { action: "cancel", flowId: vars.flowId },
    })) as Promise<HermesProviderOAuthResponse>,
    invalidate: [["settings", "hermes-access"]],
  });
}
export function useHermesProviderOAuthFlow(flowId: string | null) {
  return useQuery({
    queryKey: ["settings", "hermes-provider-oauth", flowId],
    queryFn: (): Promise<HermesProviderOAuthResponse> => call(getApiClient().POST("/api/v1/settings/hermes-access/oauth", {
      body: { action: "status", flowId: flowId! },
    })) as Promise<HermesProviderOAuthResponse>,
    enabled: flowId !== null,
    refetchInterval: (query) => ["configured", "failed"].includes(query.state.data?.data.status ?? "") ? false : 3000,
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
    invalidate: (_data, { patch }) => [
      queryKeys.settings.root,
      ["context-weather"],
      ["voice", "integration-status"],
      ...(patch.developer ? [queryKeys.meta] : []),
    ],
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
