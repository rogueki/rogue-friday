"use client";

import type { ActionResult, ApprovalResponse, FileCategory, FileItemListResponse, FileItemResponse, FilePreviewResponse } from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export interface FileFilters {
  category?: FileCategory[];
  q?: string;
  tag?: string;
  taskId?: string;
  limit?: number;
  cursor?: string;
}

export const fileQueries = {
  list: (filters: FileFilters = {}) =>
    queryOptions({
      queryKey: queryKeys.files.list(filters),
      queryFn: (): Promise<FileItemListResponse> => call(getApiClient().GET("/api/v1/files", { params: { query: filters } })),
      staleTime: staleTimes.files,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: queryKeys.files.detail(id),
      queryFn: (): Promise<FileItemResponse> => call(getApiClient().GET("/api/v1/files/{id}", { params: { path: { id } } })),
      staleTime: staleTimes.files,
    }),
  preview: (id: string) =>
    queryOptions({
      queryKey: queryKeys.files.preview(id),
      queryFn: (): Promise<FilePreviewResponse> => call(getApiClient().GET("/api/v1/files/{id}/preview", { params: { path: { id } } })),
      staleTime: staleTimes.files,
    }),
};

export const useFiles = (filters?: FileFilters) => useQuery(fileQueries.list(filters));
export const useFile = (id: string | null | undefined) => useQuery({ ...fileQueries.detail(id ?? ""), enabled: Boolean(id) });
export const useFilePreview = (id: string | null | undefined, enabled = true) =>
  useQuery({ ...fileQueries.preview(id ?? ""), enabled: Boolean(id) && enabled });
export const searchFiles = (q: string, limit = 6): Promise<FileItemListResponse> =>
  call(getApiClient().GET("/api/v1/files", { params: { query: { q, limit } } }));

/** GET /files/{id}/download through the SDK; the bytes stay in the browser (blob), nothing is rendered from them. */
export async function downloadFileBlob(id: string, version?: number): Promise<Blob> {
  const { data } = await getApiClient().GET("/api/v1/files/{id}/download", {
    params: { path: { id }, query: version === undefined ? {} : { version } },
    parseAs: "blob",
  });
  return data instanceof Blob ? data : new Blob([typeof data === "string" ? data : ""]);
}

export interface DeleteFileVars extends IntentVars {
  id: string;
  /** Current resource version for If-Match. */
  version: number;
}

/** Outcome of DELETE /files/{id}: removed right away (200) or an approval was raised (202). */
export type DeleteFileOutcome = { kind: "deleted"; result: ActionResult } | { kind: "approval"; approval: ApprovalResponse };

export function useDeleteFile() {
  return useApiMutation<DeleteFileOutcome, DeleteFileVars>({
    label: "Datei löschen",
    conflictKeys: [queryKeys.files.all],
    mutationFn: async ({ id, version, idempotencyKey }) => {
      const { data, response } = await getApiClient().DELETE("/api/v1/files/{id}", {
        params: { path: { id }, header: { "Idempotency-Key": idempotencyKey, "If-Match": String(version) } },
      });
      if (data === undefined) throw new Error("Leere Antwort beim Löschen");
      return response.status === 202 ? { kind: "approval", approval: data as ApprovalResponse } : { kind: "deleted", result: data as ActionResult };
    },
    invalidate: (outcome) => (outcome.kind === "approval" ? [queryKeys.approvals.all, queryKeys.overview] : [queryKeys.files.all]),
  });
}
