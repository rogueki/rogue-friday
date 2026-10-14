"use client";

import type { Priority, Task, TaskCreateRequest, TaskListResponse, TaskResponse, TaskStatus, TaskUpdateRequest } from "@jarvis/sdk";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { patchQueries, useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface TaskFilters {
  status?: TaskStatus[];
  priority?: Priority[];
  agentId?: string;
  q?: string;
  label?: string;
  dueBefore?: string;
  sort?: "-updatedAt" | "updatedAt" | "priority" | "dueAt";
  limit?: number;
  cursor?: string;
}

export const taskQueries = {
  list: (filters: TaskFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.tasks.list(filters),
      queryFn: (): Promise<TaskListResponse> => call(getApiClient().GET("/api/v1/tasks", { params: { query: filters } })),
      staleTime: staleTimes.tasks,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: queryKeys.tasks.detail(id),
      queryFn: (): Promise<TaskResponse> => call(getApiClient().GET("/api/v1/tasks/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.tasks,
    }),
};

export const useTasks = (filters?: TaskFilters) => useQuery({ ...taskQueries.list(filters), placeholderData: keepPreviousData });
export const useTask = (id: string | null | undefined) => useQuery({ ...taskQueries.detail(id ?? ""), enabled: Boolean(id) });

const invalidateTasks = [queryKeys.tasks.all, queryKeys.overview] as const;

export function useCreateTask() {
  return useApiMutation<TaskResponse, TaskCreateRequest & IntentVars>({
    label: "Aufgabe anlegen",
    mutationFn: ({ idempotencyKey, ...body }) =>
      call(getApiClient().POST("/api/v1/tasks", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
    invalidate: invalidateTasks,
  });
}

/** PATCH with If-Match (PLAN §8.5); a 409 refetches the lists. Kanban moves reuse this via `status`. */
export function useUpdateTask() {
  return useApiMutation<TaskResponse, { id: string; version: number; patch: TaskUpdateRequest } & IntentVars>({
    label: "Aufgabe ändern",
    mutationFn: ({ id, version, patch }) =>
      call(
        getApiClient().PATCH("/api/v1/tasks/{id}", {
          params: { path: { id }, header: { "If-Match": String(version) } },
          body: patch,
        }),
      ),
    // Moving or re-prioritising a task is reversible and has no external side effect, so the card moves immediately.
    optimistic: (queryClient, { id, patch }) =>
      patchQueries<TaskListResponse>(queryClient, queryKeys.tasks.lists(), (old) => ({
        ...old,
        items: old.items.map((task: Task) => (task.id === id ? ({ ...task, ...patch } as Task) : task)),
      })),
    invalidate: invalidateTasks,
    conflictKeys: [queryKeys.tasks.all],
  });
}

type TaskAction = "cancel" | "retry" | "pause" | "resume";

const TASK_ACTION_LABELS: Record<TaskAction, string> = {
  cancel: "Aufgabe abbrechen",
  retry: "Aufgabe wiederholen",
  pause: "Aufgabe pausieren",
  resume: "Aufgabe fortsetzen",
};

const TASK_ACTION_PATHS = {
  cancel: "/api/v1/tasks/{id}/cancel",
  retry: "/api/v1/tasks/{id}/retry",
  pause: "/api/v1/tasks/{id}/pause",
  resume: "/api/v1/tasks/{id}/resume",
} as const;

export function useTaskAction(action: TaskAction) {
  return useApiMutation<TaskResponse, { id: string; version?: number; reason?: string; confirm?: boolean } & IntentVars>({
    label: TASK_ACTION_LABELS[action],
    mutationFn: ({ id, version, reason, confirm, idempotencyKey }) =>
      call(
        getApiClient().POST(TASK_ACTION_PATHS[action], {
          params: {
            path: { id },
            header: { "Idempotency-Key": idempotencyKey, ...(version === undefined ? {} : { "If-Match": String(version) }) },
          },
          body: { reason, confirm },
        }),
      ),
    invalidate: invalidateTasks,
    conflictKeys: [queryKeys.tasks.all],
  });
}
