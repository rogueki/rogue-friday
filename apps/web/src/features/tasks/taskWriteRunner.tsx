"use client";

import { type TaskActionRequest, type TaskResponse, type TaskUpdateRequest } from "@friday/sdk";
import { useCallback } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { StagedWriteConfirmHost, useRunStagedWrite, useStagedWriteBusy } from "@/lib/api/stagedWrite";

/** One staged task write (status change, field update or cancel) as the Control API gates it since the P9 slice. */
export interface TaskWrite {
  kind: "update" | "cancel";
  id: string;
  version?: number;
  body?: TaskUpdateRequest | TaskActionRequest;
  /** Already-translated toast text for a successful execution. */
  successMessage: string;
  taskTitle: string;
}

/** True while a staged task write is in flight (staging or confirming). */
export const useTaskWriteBusy = useStagedWriteBusy;

function sendTaskWrite(write: TaskWrite, previewId?: string, idempotencyKey?: string): Promise<TaskResponse> {
  const header: Record<string, string> = {};
  if (write.version !== undefined) header["If-Match"] = String(write.version);
  const confirmHeaders = previewId ? { "X-Action-Preview-Id": previewId } : undefined;
  if (write.kind === "cancel") {
    if (idempotencyKey) header["Idempotency-Key"] = idempotencyKey;
    return call(getApiClient().POST("/api/v1/tasks/{id}/cancel", {
      params: { path: { id: write.id }, header },
      ...(write.body ? { body: write.body as TaskActionRequest } : {}),
      ...(confirmHeaders ? { headers: confirmHeaders } : {}),
    }));
  }
  return call(getApiClient().PATCH("/api/v1/tasks/{id}", {
    params: { path: { id: write.id }, header },
    body: write.body as TaskUpdateRequest,
    ...(confirmHeaders ? { headers: confirmHeaders } : {}),
  }));
}

/** Runs a task write through the shared staged preview protocol (see `lib/api/stagedWrite`). */
export function useRunTaskWrite(): (write: TaskWrite, idempotencyKey?: string) => Promise<void> {
  const runStagedWrite = useRunStagedWrite();
  return useCallback(
    async (write, idempotencyKey) => {
      await runStagedWrite({
        send: (previewId) => sendTaskWrite(write, previewId, idempotencyKey),
        successMessage: write.successMessage,
        subject: write.taskTitle,
        invalidateKeys: [queryKeys.tasks.all, queryKeys.overview],
      });
    },
    [runStagedWrite],
  );
}

/** Mounted once in the shell: confirms the staged write with the unchanged action and its preview id. */
export const TaskWriteConfirmHost = StagedWriteConfirmHost;
