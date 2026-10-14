"use client";

import { isJarvisApiError, type CommandRequest, type CommandResponse } from "@jarvis/sdk";
import { ConfirmDialog, useToast } from "@jarvis/ui";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { create } from "zustand";
import { useT } from "@/i18n";
import { useExecuteCommand } from "@/lib/api/domains/commands";

export type CommandInput = Pick<CommandRequest, "text" | "source">;

interface PendingCommand {
  input: CommandInput;
  response: CommandResponse;
}

interface PendingStore {
  pending: PendingCommand | null;
  setPending: (pending: PendingCommand | null) => void;
}

const usePendingStore = create<PendingStore>((set) => ({ pending: null, setPending: (pending) => set({ pending }) }));

/**
 * Executes a command through POST /commands and implements the preview protocol of PLAN §43.4: write/critical commands
 * first answer with `requiresConfirmation` + `previewText`; nothing happens until the user confirms the preview, and the
 * confirmed repeat carries the `previewId`. The Control API decides what is critical, not the client.
 */
export function useRunCommand(): (input: CommandInput) => Promise<CommandResponse | null> {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const { t } = useT();
  const execute = useExecuteCommand();
  const setPending = usePendingStore((s) => s.setPending);

  const report = useCallback(
    (response: CommandResponse): void => {
      const route = response.result?.targetRoute;
      const open = route ? { label: t("command.open"), onClick: () => router.push(route) } : undefined;
      switch (response.status) {
        case "requires_confirmation":
          return;
        case "requires_approval":
          toast({
            title: t("command.requiresApproval"),
            description: response.previewText ?? response.result?.message,
            tone: "amber",
            action: response.approvalId
              ? { label: t("command.open"), onClick: () => router.push(`/approvals?approval=${encodeURIComponent(response.approvalId ?? "")}`) }
              : undefined,
          });
          return;
        case "rejected":
        case "failed":
          toast({ title: t("command.failed"), description: response.result?.message, tone: "red", duration: 9000 });
          return;
        default:
          toast({ title: t("command.done"), description: response.result?.message, tone: "green", action: open });
      }
    },
    [router, t, toast],
  );

  return useCallback(
    async (input) => {
      try {
        const response = await execute.mutateAsync({ ...input, context: { route: pathname } });
        if (response.status === "requires_confirmation" || response.requiresConfirmation) {
          setPending({ input, response });
        } else {
          report(response);
        }
        return response;
      } catch (error) {
        toast({
          title: t("command.failed"),
          description: isJarvisApiError(error) ? `${error.message} (${error.correlationId})` : String(error),
          tone: "red",
          duration: 9000,
        });
        return null;
      }
    },
    [execute, pathname, report, setPending, t, toast],
  );
}

/** Mounted once in the shell: shows the server preview and executes only after explicit confirmation. */
export function CommandConfirmHost() {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const pending = usePendingStore((s) => s.pending);
  const setPending = usePendingStore((s) => s.setPending);
  const execute = useExecuteCommand();

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    try {
      const response = await execute.mutateAsync({
        ...pending.input,
        context: { route: pathname },
        confirm: true,
        previewId: pending.response.previewId,
      });
      setPending(null);
      const route = response.result?.targetRoute;
      toast({
        title: response.status === "executed" || response.status === "accepted" ? t("command.done") : t("command.failed"),
        description: response.result?.message,
        tone: response.status === "executed" || response.status === "accepted" ? "green" : "red",
        action: route ? { label: t("command.open"), onClick: () => router.push(route) } : undefined,
      });
    } catch (error) {
      setPending(null);
      toast({ title: t("command.failed"), description: isJarvisApiError(error) ? error.message : String(error), tone: "red", duration: 9000 });
    }
  };

  const details = pending?.response.riskTier ? [t("command.riskTier", { tier: pending.response.riskTier })] : undefined;
  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
      title={t("command.confirmTitle")}
      description={pending?.response.previewText ?? pending?.input.text ?? ""}
      details={details}
      confirmLabel={t("command.confirm")}
      cancelLabel={t("common.cancel")}
      loading={execute.isPending}
      onConfirm={() => void confirm()}
    />
  );
}
