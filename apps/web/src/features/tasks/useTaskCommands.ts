"use client";

import type { Task, TaskStatus } from "@friday/sdk";
import { useToast } from "@friday/ui";
import { useMemo } from "react";
import { useT } from "@/i18n";
import { useAssignTask, useTaskAction } from "@/lib/api/domains/tasks";
import { useCapabilityState, type CapabilityState } from "@/lib/capabilities";
import { isFinished } from "./model";
import { useRunTaskWrite, useTaskWriteBusy } from "./taskWriteRunner";

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

/**
 * Mutations of the task actions. Status changes, result approvals, cancels and the update-based assign fallback are
 * staged writes: the server shows a preview first and executes only after the user confirms it (taskWriteRunner).
 * Pause/resume/retry stay one-shot adapter actions.
 */
export function useTaskCommands() {
  const { t } = useT();
  const { toast } = useToast();
  const assignTask = useAssignTask();
  const canAssignOperation = useCapabilityState("agents", "assignTask") === "available";
  const pause = useTaskAction("pause");
  const resume = useTaskAction("resume");
  const retry = useTaskAction("retry");
  const runTaskWrite = useRunTaskWrite();
  const staging = useTaskWriteBusy();

  const done = (message: Parameters<typeof t>[0], task: Task): void => {
    toast({ title: t(message), description: task.title, tone: "green", duration: 3500 });
  };
  // A failure is already shown by the global mutation error toast of the QueryClient, so the rejection is only acknowledged here.
  const settle = (promise: Promise<unknown>, onSuccess: () => void): void => {
    promise.then(onSuccess, () => undefined);
  };

  const move = (task: Task, status: TaskStatus): void => {
    void runTaskWrite({ kind: "update", id: task.id, version: task.version, body: { status },
      successMessage: t("tasks.toast.moved"), taskTitle: task.title });
  };

  const assign = (task: Task, agentId: string | null): void => {
    if (canAssignOperation) {
      settle(assignTask.mutateAsync({ id: task.id, version: task.version, agentId }),
        () => done(agentId === null ? "tasks.toast.unassigned" : "tasks.toast.assigned", task));
      return;
    }
    void runTaskWrite({ kind: "update", id: task.id, version: task.version, body: { agentId },
      successMessage: t(agentId === null ? "tasks.toast.unassigned" : "tasks.toast.assigned"), taskTitle: task.title });
  };

  const approveResult = (task: Task): void => {
    void runTaskWrite({ kind: "update", id: task.id, version: task.version, body: { status: "done" },
      successMessage: t("tasks.toast.resultApproved"), taskTitle: task.title });
  };

  const run = (action: "pause" | "resume" | "cancel" | "retry", task: Task): void => {
    if (action === "cancel") {
      void runTaskWrite({ kind: "cancel", id: task.id, version: task.version,
        successMessage: t("tasks.toast.cancelled"), taskTitle: task.title });
      return;
    }
    const message = { pause: "tasks.toast.paused", resume: "tasks.toast.resumed", retry: "tasks.toast.retried" } as const;
    settle({ pause, resume, retry }[action].mutateAsync({ id: task.id, version: task.version }), () => done(message[action], task));
  };

  return {
    move,
    assign,
    approveResult,
    run,
    pending: staging || assignTask.isPending || pause.isPending || resume.isPending || retry.isPending,
  };
}
