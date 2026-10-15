"use client";

import type { ActionResult, CommandControlRequest, CommandHistoryEntryListResponse, CommandRequest, CommandResponse } from "@friday/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export const commandQueries = {
  history: (limit = 10) =>
    queryOptions({
      queryKey: [...queryKeys.commands.history, limit] as const,
      queryFn: (): Promise<CommandHistoryEntryListResponse> => call(getApiClient().GET("/api/v1/commands/history", { params: { query: { limit } } })),
      staleTime: staleTimes.commands,
    }),
};

export const useCommandHistory = (limit?: number, enabled = true) => useQuery({ ...commandQueries.history(limit), enabled });

/**
 * POST /commands. Write/critical commands answer with `requiresConfirmation` + `previewText` first (PLAN §43.4); the UI
 * shows the preview and repeats the call with `confirm: true` and the returned `previewId`.
 */
export function useExecuteCommand() {
  return useApiMutation<CommandResponse, CommandRequest & IntentVars>({
    label: "Befehl",
    silent: true,
    mutationFn: ({ idempotencyKey, ...body }) => call(getApiClient().POST("/api/v1/commands", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
    invalidate: (response) =>
      response.status === "requires_confirmation"
        ? []
        : [queryKeys.commands.history, queryKeys.tasks.all, queryKeys.overview, queryKeys.orb, queryKeys.approvals.all],
  });
}

export type CommandControl = "stop" | "pause" | "resume";

const CONTROL_PATHS = {
  stop: "/api/v1/commands/stop",
  pause: "/api/v1/commands/pause",
  resume: "/api/v1/commands/resume",
} as const;

const CONTROL_LABELS: Record<CommandControl, string> = { stop: "Stopp", pause: "Pause", resume: "Fortsetzen" };

export function useCommandControl(kind: CommandControl) {
  return useApiMutation<ActionResult, Partial<CommandControlRequest> & IntentVars>({
    label: CONTROL_LABELS[kind],
    mutationFn: ({ scope, targetId, reason, idempotencyKey }) =>
      call(
        getApiClient().POST(CONTROL_PATHS[kind], {
          params: { header: { "Idempotency-Key": idempotencyKey } },
          body: { scope: scope ?? "all", targetId, reason },
        }),
      ),
    invalidate: [queryKeys.orb, queryKeys.overview, queryKeys.status, queryKeys.tasks.all, queryKeys.agents.all, queryKeys.voice.status],
  });
}
