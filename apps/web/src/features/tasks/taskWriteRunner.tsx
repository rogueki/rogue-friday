"use client";

import { isFridayApiError, type TaskActionRequest, type TaskResponse, type TaskUpdateRequest } from "@friday/sdk";
import { ConfirmDialog, useToast } from "@friday/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { create } from "zustand";
import { useT } from "@/i18n";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";

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

interface PendingTaskWrite {
  write: TaskWrite;
  idempotencyKey?: string;
  previewId: string;
  previewText: string;
}

interface PendingTaskWriteStore {
  pending: PendingTaskWrite | null;
  busy: boolean;
  setPending: (pending: PendingTaskWrite | null) => void;
  setBusy: (busy: boolean) => void;
}

const usePendingTaskWrite = create<PendingTaskWriteStore>((set) => ({
  pending: null,
  busy: false,
  setPending: (pending) => set({ pending }),
  setBusy: (busy) => set({ busy }),
}));

/** True while a staged task write is in flight (staging or confirming). */
export const useTaskWriteBusy = (): boolean => usePendingTaskWrite((s) => s.busy);

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

function stagingOf(error: unknown): { stage: string; previewId?: string; previewText?: string; approvalId?: string } | null {
  if (!isFridayApiError(error) || error.code !== "APPROVAL_REQUIRED") return null;
  const details = error.details as { stage?: unknown; previewId?: unknown; previewText?: unknown; approvalId?: unknown };
  return typeof details.stage === "string" ? {
    stage: details.stage,
    previewId: typeof details.previewId === "string" ? details.previewId : undefined,
    previewText: typeof details.previewText === "string" ? details.previewText : undefined,
    approvalId: typeof details.approvalId === "string" ? details.approvalId : undefined,
  } : null;
}

/**
 * Runs a task write through the staged preview protocol: the first call only stages the exact action
 * (403 APPROVAL_REQUIRED, stage `preview`); the user confirms the shown preview and the repeat carries
 * `X-Action-Preview-Id`. Nothing is patched optimistically — the board changes when the server executed the write.
 */
export function useRunTaskWrite(): (write: TaskWrite, idempotencyKey?: string) => Promise<void> {
  const { toast } = useToast();
  const { t } = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const setPending = usePendingTaskWrite((s) => s.setPending);
  const setBusy = usePendingTaskWrite((s) => s.setBusy);

  return useCallback(
    async (write, idempotencyKey) => {
      setBusy(true);
      try {
        await sendTaskWrite(write, undefined, idempotencyKey);
        toast({ title: write.successMessage, description: write.taskTitle, tone: "green", duration: 3500 });
        for (const key of [queryKeys.tasks.all, queryKeys.overview]) void queryClient.invalidateQueries({ queryKey: key });
      } catch (error) {
        const staged = stagingOf(error);
        if (staged?.stage === "preview" && staged.previewId) {
          setPending({ write, idempotencyKey, previewId: staged.previewId, previewText: staged.previewText ?? write.taskTitle });
        } else if (staged?.stage === "approval") {
          toast({ title: t("command.requiresApproval"), description: staged.previewText ?? write.taskTitle, tone: "amber",
            action: staged.approvalId ? { label: t("command.open"), onClick: () => router.push(`/approvals?approval=${encodeURIComponent(staged.approvalId ?? "")}`) } : undefined });
          for (const key of [queryKeys.approvals.all]) void queryClient.invalidateQueries({ queryKey: key });
        } else {
          toast({ title: t("command.failed"), duration: 9000, tone: "red",
            description: isFridayApiError(error) ? `${error.message} (${error.correlationId})` : String(error) });
          if (isFridayApiError(error) && error.code === "CONFLICT") {
            for (const key of [queryKeys.tasks.all]) void queryClient.invalidateQueries({ queryKey: key });
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [queryClient, router, setBusy, setPending, t, toast],
  );
}

/** Mounted once in the shell: confirms the staged task write with the unchanged action and its preview id. */
export function TaskWriteConfirmHost() {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pending = usePendingTaskWrite((s) => s.pending);
  const busy = usePendingTaskWrite((s) => s.busy);
  const setPending = usePendingTaskWrite((s) => s.setPending);
  const setBusy = usePendingTaskWrite((s) => s.setBusy);

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    setBusy(true);
    try {
      await sendTaskWrite(pending.write, pending.previewId, pending.idempotencyKey);
      setPending(null);
      toast({ title: pending.write.successMessage, description: pending.write.taskTitle, tone: "green", duration: 3500 });
      for (const key of [queryKeys.tasks.all, queryKeys.overview]) void queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      setPending(null);
      const staged = stagingOf(error);
      if (staged?.stage === "approval") {
        toast({ title: t("command.requiresApproval"), description: pending.write.taskTitle, tone: "amber",
          action: staged.approvalId ? { label: t("command.open"), onClick: () => router.push(`/approvals?approval=${encodeURIComponent(staged.approvalId ?? "")}`) } : undefined });
        void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      } else {
        toast({ title: t("command.failed"), duration: 9000, tone: "red",
          description: isFridayApiError(error) ? error.message : String(error) });
        if (isFridayApiError(error) && error.code === "CONFLICT") void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
      title={t("command.confirmTitle")}
      description={pending?.previewText ?? ""}
      confirmLabel={t("command.confirm")}
      cancelLabel={t("common.cancel")}
      loading={busy}
      onConfirm={() => void confirm()}
    />
  );
}
