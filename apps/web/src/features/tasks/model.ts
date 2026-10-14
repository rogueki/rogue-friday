import type { EntityRef, Priority, Task, TaskStatus } from "@jarvis/sdk";
import type { Tone } from "@jarvis/ui";

/** Board columns in the order of PLAN §28.2. */
export const BOARD_STATUSES = ["triage", "todo", "ready", "running", "waiting", "review", "done"] as const satisfies readonly TaskStatus[];
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** Finished without success; they stay visible as history (PLAN §28.6) but are not drop targets. */
export const HISTORY_STATUSES = ["failed", "cancelled"] as const satisfies readonly TaskStatus[];

export const ALL_STATUSES: readonly TaskStatus[] = [...BOARD_STATUSES, ...HISTORY_STATUSES];
export const PRIORITIES: readonly Priority[] = ["P0", "P1", "P2", "P3", "P4"];

export const STATUS_TONE: Record<TaskStatus, Tone> = {
  triage: "violet",
  todo: "muted",
  ready: "blue",
  running: "cyan",
  waiting: "amber",
  review: "violet",
  done: "green",
  failed: "red",
  cancelled: "muted",
};

export const PRIORITY_TONE: Record<Priority, Tone> = { P0: "red", P1: "amber", P2: "cyan", P3: "muted", P4: "muted" };

export const isBoardStatus = (status: TaskStatus): status is BoardStatus => (BOARD_STATUSES as readonly string[]).includes(status);
export const isFinished = (status: TaskStatus): boolean => status === "done" || status === "failed" || status === "cancelled";

/** Percent (0..100) of a determinate progress; `null` for unknown progress, which is never turned into a number. */
export function progressPercent(task: Pick<Task, "progress">): number | null {
  const { mode, value } = task.progress;
  if (mode !== "determinate" || value === null || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value * 100)));
}

/** Indeterminate bar for explicitly unknown progress and for running work that reports no progress at all. */
export function showsIndeterminate(task: Pick<Task, "progress" | "status">): boolean {
  if (progressPercent(task) !== null) return false;
  return task.progress.mode === "indeterminate" || (task.progress.mode === "none" && task.status === "running");
}

export function isOverdue(task: Pick<Task, "dueAt" | "status">, now: Date): boolean {
  if (!task.dueAt || isFinished(task.status)) return false;
  const due = Date.parse(task.dueAt);
  return !Number.isNaN(due) && due < now.getTime();
}

/** Tasks that wait for a human decision: result review, an approval or missing input (view "Meine Entscheidungen"). */
export type DecisionKind = "review" | "approval" | "input";

export function decisionKind(task: Task): DecisionKind | null {
  if (task.status === "review") return "review";
  if (task.status === "done" || task.status === "failed" || task.status === "cancelled") return null;
  if (task.blockers.some((blocker) => blocker.kind === "approval")) return "approval";
  if (task.blockers.some((blocker) => blocker.kind === "input_needed")) return "input";
  return null;
}

/** Routes of the pages a task's entity references point to (`/memory?...` pages may not exist yet in every build). */
export function entityRoute(ref: EntityRef): string | null {
  const id = encodeURIComponent(ref.id);
  switch (ref.type) {
    case "task":
      return `/tasks?task=${id}`;
    case "agent":
      return `/agents?agent=${id}`;
    case "approval":
      return `/approvals?approval=${id}`;
    case "activity_event":
      return `/activity?event=${id}`;
    case "memory":
      return `/memory?memory=${id}`;
    case "file":
      return `/files?file=${id}`;
    case "thread":
    case "message":
    case "draft":
      return `/communication?thread=${id}`;
    case "calendar_event":
      return `/calendar?event=${id}`;
    case "automation":
    case "automation_run":
      return `/automations?automation=${id}`;
    case "research_project":
      return `/research?project=${id}`;
    case "notification":
      return `/alerts?notification=${id}`;
    case "service":
    case "adapter":
      return `/system?service=${id}`;
    case "audit_event":
      return `/audit?event=${id}`;
    default:
      return null;
  }
}

export const taskRoute = (id: string): string => `/tasks?task=${encodeURIComponent(id)}`;
