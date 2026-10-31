import type { AdapterHealth, Approval, FridayEvent, Task } from "@friday/sdk";
import type { NativeNotifications } from "./native-notifications";

const TASK_EVENTS = new Set(["friday.task.created", "friday.task.updated", "friday.task.progress", "friday.task.completed",
  "friday.task.failed", "friday.task.cancelled"]);
// A task that moved on (or was given up) no longer needs the owner: its question or failure alert is closed.
const TASK_SETTLED = new Set<Task["status"]>(["running", "review", "done", "cancelled"]);

const taskRef = (task: Task) => ({ type: "task" as const, id: task.id, label: task.title.slice(0, 200) });

export const BACKUP_SOURCE = { type: "service", id: "system-backup", label: "Systembackup" } as const;
export const UPDATE_SOURCE = { type: "service", id: "dashboard-update", label: "Dashboard-Update" } as const;

/** Failed backup ⇒ P2 alert; a successful one resolves it. */
export function notifyBackupResult(notifications: NativeNotifications, result: { status: "success" | "failed"; error: string | null }): void {
  if (result.status === "failed") {
    notifications.raise({
      priority: "P2",
      category: "system",
      title: "Backup fehlgeschlagen",
      body: result.error ? `Das Systembackup ist fehlgeschlagen: ${result.error}` : "Das Systembackup ist fehlgeschlagen.",
      sourceRef: { ...BACKUP_SOURCE },
      targetRoute: "/settings?area=backups",
    });
    return;
  }
  notifications.resolveBySource("service", "system-backup");
}

/**
 * Reports the last dashboard update result once: returns the key of the result it handled, so the caller can store it
 * and a restart or a periodic check does not raise (or reopen an acknowledged alert) twice for the same run.
 */
export function notifyUpdateResult(notifications: NativeNotifications,
  result: { commit: string; status: "success" | "failed"; time: string; message?: string } | null,
  lastHandled: string | null): string | null {
  if (result === null) return lastHandled;
  const key = `${result.time}|${result.commit}`;
  if (key === lastHandled) return lastHandled;
  if (result.status === "failed") {
    notifications.raise({
      priority: "P2",
      category: "system",
      title: "Update fehlgeschlagen",
      body: result.message
        ? `Das Dashboard-Update auf ${result.commit.slice(0, 7)} ist fehlgeschlagen: ${result.message.slice(0, 300)}`
        : `Das Dashboard-Update auf ${result.commit.slice(0, 7)} ist fehlgeschlagen.`,
      sourceRef: { ...UPDATE_SOURCE },
      targetRoute: "/settings?area=dashboard",
    });
  } else {
    notifications.resolveBySource("service", "dashboard-update");
  }
  return key;
}

/** Alert for a native approval waiting on the owner; tier 3 needs a re-authentication, so it ranks as urgent. */
export function notifyApprovalPending(notifications: NativeNotifications, approval: Approval): void {
  notifications.raise({
    priority: approval.riskTier === 3 ? "P1" : "P2",
    category: "approval",
    title: `Freigabe nötig: ${approval.action}`,
    body: approval.preview.title,
    sourceRef: { type: "approval", id: approval.id, label: approval.action.slice(0, 200) },
    targetRoute: `/approvals?approval=${approval.id}`,
  });
}

function onTask(notifications: NativeNotifications, type: string, task: Task): void {
  if (type === "friday.task.failed" || task.status === "failed") {
    notifications.raise({
      priority: "P2",
      category: "task",
      title: `Auftrag fehlgeschlagen: ${task.title}`,
      body: task.errors[0]?.message ?? task.resultSummary ?? "Der Auftrag wurde mit einem Fehler beendet.",
      sourceRef: taskRef(task),
      targetRoute: `/tasks?task=${task.id}`,
    });
    return;
  }
  // Only a question needs the owner: approval blockers have their own alert, a paused task was paused by the owner.
  const question = task.status === "waiting" ? task.blockers.find((blocker) => blocker.kind === "input_needed") : undefined;
  if (question) {
    notifications.raise({
      priority: "P2",
      category: "task",
      title: `Rückfrage: ${task.title}`,
      body: question.description,
      sourceRef: taskRef(task),
      targetRoute: `/tasks?task=${task.id}`,
    });
    return;
  }
  if (TASK_SETTLED.has(task.status)) notifications.resolveBySource("task", task.id);
}

function onAdapterHealth(notifications: NativeNotifications, health: AdapterHealth): void {
  if (health.status === "offline" && health.lifecycle !== "STOPPING" && health.lifecycle !== "STOPPED") {
    notifications.raise({
      priority: "P1",
      category: "adapter",
      title: `Dienst nicht erreichbar: ${health.adapterId}`,
      body: "Der Dienst antwortet nicht. Was davon abhängt, ist eingeschränkt; Details unter System.",
      sourceRef: { type: "adapter", id: health.adapterId },
      targetRoute: "/system",
    });
  } else if (health.status === "online" || health.status === "paused") {
    notifications.resolveBySource("adapter", health.adapterId);
  }
}

/**
 * Turns live domain events into owner alerts. A failing producer must never break the hub or the other listeners, so
 * every event is handled on its own and errors are reported to the caller's logger.
 */
export function attachNotificationProducers(
  hub: { subscribe(listener: (event: FridayEvent) => void): () => void },
  notifications: NativeNotifications,
  onError: (error: unknown, type: string) => void,
): () => void {
  return hub.subscribe((event) => {
    try {
      if (TASK_EVENTS.has(event.type)) onTask(notifications, event.type, event.data as Task);
      else if (event.type === "friday.adapter.health_changed") onAdapterHealth(notifications, event.data as AdapterHealth);
    } catch (error) {
      onError(error, event.type);
    }
  });
}
