"use client";

import type { ScenarioControlRequest, ScenarioListResponse, ScenarioState, ScenarioStateResponse } from "@friday/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";

/**
 * Scenario console endpoints (`x-dev-only`, PLAN §44.6). They exist only in development/QA (`meta.features.devScenarios`);
 * callers pass `enabled` so a production build never requests them.
 */
export const devQueries = {
  scenarios: () =>
    queryOptions({
      queryKey: queryKeys.dev.scenarios,
      queryFn: (): Promise<ScenarioListResponse> => call(getApiClient().GET("/api/v1/dev/scenarios")),
      staleTime: 60_000,
    }),
  state: () =>
    queryOptions({
      queryKey: queryKeys.dev.state,
      queryFn: (): Promise<ScenarioStateResponse> => call(getApiClient().GET("/api/v1/dev/scenarios/state")),
      staleTime: 0,
      // The engine advances on its own while a scenario plays, so the console keeps looking.
      refetchInterval: 2_000,
    }),
};

export const useScenarios = (enabled = true) => useQuery({ ...devQueries.scenarios(), enabled });
export const useScenarioState = (enabled = true) => useQuery({ ...devQueries.state(), enabled });

/** Keys that every scenario action can change: the overview, orb, capabilities and activity all follow the engine. */
const AFFECTED = [
  queryKeys.dev.state,
  queryKeys.meta,
  queryKeys.overview,
  queryKeys.status,
  queryKeys.orb,
  queryKeys.capabilities,
  queryKeys.activity.all,
  queryKeys.adapters.all,
  queryKeys.system.services,
  queryKeys.system.models,
] as const;

export interface PlayScenarioVars extends IntentVars {
  id: string;
  /** Playback speed multiplier (> 0). `speed` is an extension of `playScenario`, not part of the generated parameter types. */
  speed?: number;
}

export function usePlayScenario() {
  return useApiMutation<ScenarioStateResponse, PlayScenarioVars>({
    label: "Szenario abspielen",
    mutationFn: ({ id, speed }) =>
      call(
        getApiClient().POST("/api/v1/dev/scenarios/{id}/play", {
          params: { path: { id }, ...(speed !== undefined ? { query: { speed } } : {}) } as never,
        }),
      ),
    invalidate: AFFECTED,
  });
}

export function useControlScenario() {
  return useApiMutation<ScenarioStateResponse, { request: ScenarioControlRequest } & IntentVars>({
    label: "Szenario-Steuerung",
    mutationFn: ({ request }) => call(getApiClient().POST("/api/v1/dev/scenarios/control", { body: request })),
    invalidate: AFFECTED,
  });
}

export type { ScenarioState };
