"use client";

import { isFridayApiError } from "@friday/sdk";
import { ConfirmDialog, useToast } from "@friday/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { create } from "zustand";
import { useT } from "@/i18n";
import { queryKeys } from "@/lib/api/queryKeys";

/**
 * One staged write as the Control API gates it since the P9 slice: the first call only stages the exact action
 * (403 APPROVAL_REQUIRED, stage `preview`), the confirmed repeat carries `X-Action-Preview-Id`.
 * The send closure captures the full request — body, If-Match and idempotency key — so a confirmation
 * can never alter what was previewed.
 */
export interface StagedWrite {
  send: (previewId?: string) => Promise<unknown>;
  /** Invalidates a saved server draft before the preview is dismissed. */
  discard?: (previewId: string) => Promise<unknown>;
  /** Already-translated toast text for a successful execution. */
  successMessage: string;
  /** Subject for toasts and as fallback preview text. */
  subject: string;
  /** Queries invalidated after execution (and on CONFLICT, where the data may have moved). */
  invalidateKeys: readonly (readonly unknown[])[];
  /** Receives the parsed success response, e.g. a send receipt the caller keeps working with. */
  onExecuted?: (response: unknown) => void;
}

export type StagedWriteOutcome = "executed" | "preview" | "approval" | "failed";

interface PendingStagedWrite {
  write: StagedWrite;
  previewId: string;
  previewText: string;
}

interface StagedWriteStore {
  pending: PendingStagedWrite | null;
  busy: boolean;
  setPending: (pending: PendingStagedWrite | null) => void;
  setBusy: (busy: boolean) => void;
}

const useStagedWriteStore = create<StagedWriteStore>((set) => ({
  pending: null,
  busy: false,
  setPending: (pending) => set({ pending }),
  setBusy: (busy) => set({ busy }),
}));

/** True while a staged write is in flight (staging or confirming). */
export const useStagedWriteBusy = (): boolean => useStagedWriteStore((s) => s.busy);

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
 * Runs a write through the staged preview protocol. Nothing is patched optimistically — queries are
 * invalidated only when the server executed the write. Reports the outcome so callers can close editors
 * once the write left their hands (staged or executed) but keep them open on validation errors.
 */
export function useRunStagedWrite(): (write: StagedWrite) => Promise<StagedWriteOutcome> {
  const { toast } = useToast();
  const { t } = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const setPending = useStagedWriteStore((s) => s.setPending);
  const setBusy = useStagedWriteStore((s) => s.setBusy);

  return useCallback(
    async (write) => {
      setBusy(true);
      try {
        const response = await write.send();
        write.onExecuted?.(response);
        toast({ title: write.successMessage, description: write.subject, tone: "green", duration: 3500 });
        for (const key of write.invalidateKeys) void queryClient.invalidateQueries({ queryKey: key });
        return "executed";
      } catch (error) {
        const staged = stagingOf(error);
        if (staged?.stage === "preview" && staged.previewId) {
          setPending({ write, previewId: staged.previewId, previewText: staged.previewText ?? write.subject });
          return "preview";
        }
        if (staged?.stage === "approval") {
          toast({ title: t("command.requiresApproval"), description: staged.previewText ?? write.subject, tone: "amber",
            action: staged.approvalId ? { label: t("command.open"), onClick: () => router.push(`/approvals?approval=${encodeURIComponent(staged.approvalId ?? "")}`) } : undefined });
          void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
          return "approval";
        }
        toast({ title: t("command.failed"), duration: 9000, tone: "red",
          description: isFridayApiError(error) ? `${error.message} (${error.correlationId})` : String(error) });
        if (isFridayApiError(error) && error.code === "CONFLICT") {
          for (const key of write.invalidateKeys) void queryClient.invalidateQueries({ queryKey: key });
        }
        return "failed";
      } finally {
        setBusy(false);
      }
    },
    [queryClient, router, setBusy, setPending, t, toast],
  );
}

/** Mounted once in the shell: confirms the staged write with the unchanged action and its preview id. */
export function StagedWriteConfirmHost() {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pending = useStagedWriteStore((s) => s.pending);
  const busy = useStagedWriteStore((s) => s.busy);
  const setPending = useStagedWriteStore((s) => s.setPending);
  const setBusy = useStagedWriteStore((s) => s.setBusy);

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await pending.write.send(pending.previewId);
      pending.write.onExecuted?.(response);
      setPending(null);
      toast({ title: pending.write.successMessage, description: pending.write.subject, tone: "green", duration: 3500 });
      for (const key of pending.write.invalidateKeys) void queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      setPending(null);
      const staged = stagingOf(error);
      if (staged?.stage === "approval") {
        toast({ title: t("command.requiresApproval"), description: pending.write.subject, tone: "amber",
          action: staged.approvalId ? { label: t("command.open"), onClick: () => router.push(`/approvals?approval=${encodeURIComponent(staged.approvalId ?? "")}`) } : undefined });
        void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      } else {
        toast({ title: t("command.failed"), duration: 9000, tone: "red",
          description: isFridayApiError(error) ? error.message : String(error) });
        if (isFridayApiError(error) && error.code === "CONFLICT") {
          for (const key of pending.write.invalidateKeys) void queryClient.invalidateQueries({ queryKey: key });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (): Promise<void> => {
    if (!pending || busy) return;
    if (!pending.write.discard) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      await pending.write.discard(pending.previewId);
      if (useStagedWriteStore.getState().pending === pending) setPending(null);
    } catch (error) {
      toast({ title: t("command.failed"), duration: 9000, tone: "red",
        description: isFridayApiError(error) ? `${error.message} (${error.correlationId})` : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && void dismiss()}
      title={t("command.confirmTitle")}
      description={pending?.previewText ?? ""}
      confirmLabel={t("command.confirm")}
      cancelLabel={t("common.cancel")}
      loading={busy}
      onConfirm={() => void confirm()}
    />
  );
}
