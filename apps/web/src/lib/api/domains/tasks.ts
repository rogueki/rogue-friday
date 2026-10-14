"use client";

import type {
  AuditEventListResponse,
  Priority,
  Task,
  TaskAssignRequest,
  TaskCreateRequest,
  TaskInputRequest,
  TaskListResponse,
  TaskResponse,
  TaskStatus,
  TaskUpdateRequest,
} from "@jarvis/sdk";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { patchQueries, useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";
import { useCursorPages } from "./cursorPages";

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

/** Audit trail of one task (tab "Audit"); same key family as the audit module so live audit events patch it. */
export const taskAuditQuery = (taskId: string) =>
  queryOptions({
    queryKey: queryKeys.audit.list({ taskId, limit: 50 }),
    queryFn: (): Promise<AuditEventListResponse> =>
      call(getApiClient().GET("/api/v1/audit/events", { params: { query: { taskId, limit: 50 } } })),
    staleTime: staleTimes.tasks,
  });

export const useTaskAudit = (taskId: string | null | undefined) => useQuery({ ...taskAuditQuery(taskId ?? ""), enabled: Boolean(taskId) });

export const useTasks = (filters?: TaskFilters) => useQuery({ ...taskQueries.list(filters), placeholderData: keepPreviousData });
/** Board/list data: first page live-patched by realtime, further pages by cursor ("Mehr laden"). */
export function useTaskPages(filters: TaskFilters = {}) {
  const first = useTasks(filters);
  const pages = useCursorPages<Task, TaskListResponse, ReturnType<typeof queryKeys.tasks.list>>(
    first.data,
    (cursor) => taskQueries.list({ ...filters, cursor }),
    JSON.stringify(filters),
  );
  return { first, ...pages };
}

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

/**
 * Assigns a task to an agent or releases it (POST /tasks/{id}/assign, capability `agents.assignTask`). Adapters without
 * this operation still accept `agentId` through the task update (see `useTaskCommands`).
 */
export function useAssignTask() {
  return useApiMutation<TaskResponse, { id: string; version?: number } & TaskAssignRequest & IntentVars>({
    label: "Agent zuweisen",
    mutationFn: ({ id, version, agentId, reason, idempotencyKey }) =>
      call(
        getApiClient().POST("/api/v1/tasks/{id}/assign", {
          params: { path: { id }, header: { "Idempotency-Key": idempotencyKey, ...(version === undefined ? {} : { "If-Match": String(version) }) } },
          body: { agentId, ...(reason ? { reason } : {}) },
        }),
      ),
    invalidate: [...invalidateTasks, queryKeys.agents.all],
    conflictKeys: [queryKeys.tasks.all],
  });
}

/**
 * Answers a task that waits for input (POST /tasks/{id}/input, capability `tasks.input`): the server forwards the text to
 * the agent and resolves the `input_needed` blocker. The text itself is never logged or audited.
 */
export function useProvideTaskInput() {
  return useApiMutation<TaskResponse, { id: string; version?: number } & TaskInputRequest & IntentVars>({
    label: "Eingabe senden",
    mutationFn: ({ id, version, input, blockerId, idempotencyKey }) =>
      call(
        getApiClient().POST("/api/v1/tasks/{id}/input", {
          params: { path: { id }, header: { "Idempotency-Key": idempotencyKey, ...(version === undefined ? {} : { "If-Match": String(version) }) } },
          body: { input, ...(blockerId ? { blockerId } : {}) },
        }),
      ),
    invalidate: [...invalidateTasks, queryKeys.approvals.all],
    conflictKeys: [queryKeys.tasks.all],
  });
}
