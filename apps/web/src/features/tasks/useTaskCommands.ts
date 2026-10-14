"use client";

import type { Task, TaskStatus } from "@jarvis/sdk";
import { useToast } from "@jarvis/ui";
import { useCallback, useMemo } from "react";
import { useT } from "@/i18n";
import { useAssignTask, useTaskAction, useUpdateTask } from "@/lib/api/domains/tasks";
import { useCapabilityState, type CapabilityState } from "@/lib/capabilities";
import { isFinished } from "./model";

export type TaskActionId = "assign" | "move" | "pause" | "resume" | "cancel" | "retry" | "approveResult" | "input";

export interface TaskActionState {
  /** Capability state of the underlying API operation. */
  gate: CapabilityState;
  /** Set when the task's current status does not allow the action (the button stays visible and says why). */
  blockedReason?: string;
}

/** Capability states of all task actions (module `tasks`, PLAN §28.5). */
export function useTaskGates() {
  const create = useCapabilityState("tasks", "create");
  const update = useCapabilityState("tasks", "update");
  const cancel = useCapabilityState("tasks", "cancel");
  const retry = useCapabilityState("tasks", "retry");
  const pause = useCapabilityState("tasks", "pause");
  const resume = useCapabilityState("tasks", "resume");
  const input = useCapabilityState("tasks", "input");
  const assign = useCapabilityState("agents", "assignTask");
  return useMemo(() => ({ create, update, cancel, retry, pause, resume, input, assign }), [create, update, cancel, retry, pause, resume, input, assign]);
}

/** Which actions the task's status allows and how each is gated; one place for drawer, decisions and tests. */
export function useTaskActionStates(task: Task | undefined): Record<TaskActionId, TaskActionState> {
  const { t } = useT();
  const gates = useTaskGates();
  return useMemo(() => {
    const status = task?.status;
    const waitsForInput = task?.blockers.some((blocker) => blocker.kind === "input_needed") ?? false;
    const wrongStatus = t("tasks.action.reason.status");
    const only = (allowed: readonly TaskStatus[]): string | undefined => (status && allowed.includes(status) ? undefined : wrongStatus);
    return {
      // `agents.assignTask` has its own operation; adapters without it still take the agent through the task update.
      assign: { gate: gates.assign === "available" ? gates.assign : gates.update, blockedReason: status && isFinished(status) ? wrongStatus : undefined },
      move: { gate: gates.update },
      pause: { gate: gates.pause, blockedReason: only(["running", "ready"]) },
      resume: { gate: gates.resume, blockedReason: only(["waiting"]) },
      cancel: { gate: gates.cancel, blockedReason: status && isFinished(status) ? wrongStatus : undefined },
      retry: { gate: gates.retry, blockedReason: only(["failed", "cancelled"]) },
      approveResult: { gate: gates.update, blockedReason: only(["review"]) },
      input: { gate: gates.input, blockedReason: waitsForInput ? undefined : t("tasks.action.reason.noInput") },
    };
  }, [task?.status, task?.blockers, gates, t]);
}

/** Mutations of the task actions with success toasts; errors are toasted globally (409 refetches the lists). */
export function useTaskCommands() {
  const { t } = useT();
  const { toast } = useToast();
  const update = useUpdateTask();
  const assignTask = useAssignTask();
  const canAssignOperation = useCapabilityState("agents", "assignTask") === "available";
  const pause = useTaskAction("pause");
  const resume = useTaskAction("resume");
  const cancel = useTaskAction("cancel");
  const retry = useTaskAction("retry");

  const done = useCallback(
    (message: Parameters<typeof t>[0], task: Task): void => {
      toast({ title: t(message), description: task.title, tone: "green", duration: 3500 });
    },
    [t, toast],
  );

  // mutateAsync (not mutate + callbacks) so every one of several quick actions gets its own success toast. A failure is
  // already shown by the global mutation error toast of the QueryClient, so the rejection is only acknowledged here.
  const settle = useCallback((promise: Promise<unknown>, onSuccess: () => void): void => {
    promise.then(onSuccess, () => undefined);
  }, []);

  const move = useCallback(
    (task: Task, status: TaskStatus) => settle(update.mutateAsync({ id: task.id, version: task.version, patch: { status } }), () => done("tasks.toast.moved", task)),
    [update, done, settle],
  );
  const assign = useCallback(
    (task: Task, agentId: string | null) =>
      settle(
        canAssignOperation
          ? assignTask.mutateAsync({ id: task.id, version: task.version, agentId })
          : update.mutateAsync({ id: task.id, version: task.version, patch: { agentId } }),
        () => done(agentId === null ? "tasks.toast.unassigned" : "tasks.toast.assigned", task),
      ),
    [canAssignOperation, assignTask, update, done, settle],
  );
  const approveResult = useCallback(
    (task: Task) => settle(update.mutateAsync({ id: task.id, version: task.version, patch: { status: "done" } }), () => done("tasks.toast.resultApproved", task)),
    [update, done, settle],
  );
  const run = useCallback(
    (action: "pause" | "resume" | "cancel" | "retry", task: Task) => {
      const mutation = { pause, resume, cancel, retry }[action];
      const message = { pause: "tasks.toast.paused", resume: "tasks.toast.resumed", cancel: "tasks.toast.cancelled", retry: "tasks.toast.retried" } as const;
      settle(mutation.mutateAsync({ id: task.id, version: task.version, ...(action === "cancel" ? { confirm: true } : {}) }), () => done(message[action], task));
    },
    [pause, resume, cancel, retry, done, settle],
  );

  return {
    move,
    assign,
    approveResult,
    run,
    pending: update.isPending || assignTask.isPending || pause.isPending || resume.isPending || cancel.isPending || retry.isPending,
  };
}
