import type { ArtifactRef, ErrorDetail, Task, TaskBlocker, TaskStep } from "@friday/sdk";
import { defineMapper, type MapContext } from "@friday/adapter-core";
import { correlationFor, nestedId, type AgentIds, type TaskIds } from "./ids";
import { toPriority, toTaskStatus } from "./status";
import type { WireRun, WireTask, WireTaskDetail } from "./wire";

// Field tables: docs/MAPPING/hermes.md §6.1

const TITLE_MAX = 300;
const TEXT_MAX = 300;

export const isoFromSeconds = (seconds: number): string => new Date(Math.round(seconds * 1000)).toISOString();

export function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Hermes has no revision counter. The revision is derived from the last timestamp on the task row (seconds), which
 * moves on claim, heartbeat, completion and retry but not on title/priority edits. `If-Match` is therefore best effort.
 */
export function lastChangeSeconds(raw: WireTask): number {
  return Math.max(
    raw.createdAt,
    raw.startedAt ?? 0,
    raw.completedAt ?? 0,
    raw.lastHeartbeatAt ?? 0,
    raw.currentRunStartedAt ?? 0,
  );
}

export const taskVersion = (raw: WireTask): number => Math.max(1, Math.trunc(lastChangeSeconds(raw)));

function blockerText(kind: string | null, reason: string | null): string {
  const base =
    kind === "needs_input"
      ? "Wartet auf Eingabe"
      : kind === "capability"
        ? "Benötigte Fähigkeit fehlt"
        : kind === "dependency"
          ? "Wartet auf eine Abhängigkeit"
          : kind === "transient"
            ? "Vorübergehend blockiert"
            : "Blockiert";
  return reason ? `${base}: ${truncate(reason, 200)}` : base;
}

function runStepStatus(run: WireRun): TaskStep["status"] {
  switch (run.status) {
    case "running":
      return "running";
    case "done":
    case "completed":
      return "done";
    case "failed":
    case "crashed":
    case "timed_out":
      return "failed";
    case "blocked":
      return "pending";
    default:
      return "skipped"; // released, reclaimed and anything newer
  }
}

export interface TaskMappingInput {
  board: string;
  raw: WireTask;
  detail?: WireTaskDetail | undefined;
  /** Profile model for tasks without an override, by assignee name. */
  profileModel(assignee: string | null): string | null;
}

export interface TaskMapper {
  map(input: TaskMappingInput, context: MapContext): Task;
}

export function createTaskMapper(deps: {
  ids: TaskIds;
  agentIds: AgentIds;
  nowMs: () => number;
}): TaskMapper {
  const { ids, agentIds, nowMs } = deps;

  const toTask = ({ board, raw, detail, profileModel }: TaskMappingInput, context: MapContext): Task => {
    const status = toTaskStatus(raw.status, raw.lastFailureError);
    const running = status === "running";
    const startedSeconds = raw.currentRunStartedAt ?? raw.startedAt;
    const updatedSeconds = lastChangeSeconds(raw);
    const ref = { board, taskId: raw.id };
    const id = ids.encode(ref);

    let lastActivitySeconds = updatedSeconds;
    for (const event of detail?.events ?? [])
      lastActivitySeconds = Math.max(lastActivitySeconds, event.createdAt);
    for (const comment of detail?.comments ?? []) {
      lastActivitySeconds = Math.max(lastActivitySeconds, comment.createdAt);
    }

    const blockers: TaskBlocker[] = [];
    if (raw.status === "blocked") {
      const blockedEvent = detail?.events.filter((event) => event.kind === "blocked").at(-1);
      const reason = blockedEvent?.payload?.reason;
      blockers.push({
        id: `blk_${raw.id}`,
        kind:
          raw.blockKind === "needs_input"
            ? "input_needed"
            : raw.blockKind === "dependency"
              ? "dependency"
              : "other",
        description: blockerText(raw.blockKind, typeof reason === "string" ? reason : null),
        since: isoFromSeconds(blockedEvent?.createdAt ?? updatedSeconds),
      });
    } else if (raw.status === "scheduled") {
      blockers.push({
        id: `blk_${raw.id}`,
        kind: "other",
        description: "Geplant: wartet auf einen Zeitpunkt",
        since: isoFromSeconds(updatedSeconds),
      });
    } else if (raw.status === "todo" && (raw.parentCount ?? detail?.parents.length ?? 0) > 0) {
      blockers.push({
        id: `blk_${raw.id}`,
        kind: "dependency",
        description: "Wartet auf übergeordnete Aufgaben",
        since: isoFromSeconds(updatedSeconds),
      });
    }

    const errors: ErrorDetail[] = [];
    const seen = new Set<string>();
    const pushError = (message: string): void => {
      const text = truncate(message, TEXT_MAX);
      if (seen.has(text)) return;
      seen.add(text);
      errors.push({
        code: "INTERNAL",
        message: text,
        severity: "error",
        retryable: false,
        correlationId: correlationFor(`task:${externalSeed(ref)}`),
        details: {},
      });
    };
    if (raw.lastFailureError) pushError(raw.lastFailureError);
    for (const run of detail?.runs ?? []) if (run.error) pushError(run.error);

    const steps: TaskStep[] = (detail?.runs ?? []).map((run, index) => ({
      id: nestedId("step", `${externalSeed(ref)}/run-${run.id}`),
      index,
      title: `Lauf ${index + 1}${run.profile ? ` (${run.profile})` : ""}`,
      status: runStepStatus(run),
      ...(run.startedAt !== null ? { startedAt: isoFromSeconds(run.startedAt) } : {}),
      ...(run.endedAt !== null ? { finishedAt: isoFromSeconds(run.endedAt) } : {}),
      ...(run.summary || run.error ? { detail: truncate(run.summary ?? run.error ?? "", TEXT_MAX) } : {}),
    }));

    const artifacts: ArtifactRef[] = (detail?.attachments ?? []).map((attachment) => ({
      id: nestedId("art", `${externalSeed(ref)}/attachment-${attachment.id}`),
      name: attachment.filename,
      kind: "file",
      ...(attachment.size !== null && attachment.size >= 0 ? { sizeBytes: Math.trunc(attachment.size) } : {}),
    }));

    const createdBy = raw.createdBy;
    const labels = [`board:${board}`, ...(raw.tenant ? [`tenant:${raw.tenant}`] : [])];

    const task: Task = {
      id,
      version: taskVersion(raw),
      createdAt: isoFromSeconds(raw.createdAt),
      updatedAt: isoFromSeconds(updatedSeconds),
      labels,
      source: context.source(`${board}/${raw.id}`),
      title: truncate(raw.title, TITLE_MAX) || raw.id,
      ...(raw.body ? { description: raw.body } : {}),
      status,
      priority: toPriority(raw.priority),
      agentId: raw.assignee ? agentIds.encode(raw.assignee) : null,
      ...(raw.assignee ? { agentName: raw.assignee } : {}),
      model: raw.modelOverride
        ? raw.providerOverride ? `${raw.providerOverride}:${raw.modelOverride}` : raw.modelOverride
        : profileModel(raw.assignee),
      ...(["none", "low", "medium", "high", "max"].includes(raw.reasoningEffort ?? "")
        ? { reasoningLevel: raw.reasoningEffort as "none" | "low" | "medium" | "high" | "max" } : {}),
      progress: raw.progress
        ? { mode: "determinate", value: raw.progress.done / raw.progress.total }
        : running
          ? { mode: "indeterminate", value: null }
          : { mode: "none", value: null },
      startedAt: startedSeconds === null ? null : isoFromSeconds(startedSeconds),
      runtimeMs:
        running && startedSeconds !== null
          ? Math.max(0, nowMs() - startedSeconds * 1000)
          : raw.completedAt !== null && startedSeconds !== null
            ? Math.max(0, Math.round((raw.completedAt - startedSeconds) * 1000))
            : null,
      dueAt: null,
      estimatedCompletionAt: null,
      blockers,
      lastActivityAt: isoFromSeconds(lastActivitySeconds),
      artifactCount: artifacts.length,
      artifacts,
      steps,
      toolCalls: [],
      sourceRefs: [
        ...(detail?.parents ?? []).map((taskId) => ({
          type: "task" as const,
          id: ids.encode({ board, taskId }),
        })),
        ...(detail?.children ?? []).map((taskId) => ({
          type: "task" as const,
          id: ids.encode({ board, taskId }),
        })),
      ],
      approvalIds: [],
      errors,
      createdBy:
        createdBy === null
          ? { type: "adapter", id: context.adapterId }
          : createdBy === "user" || createdBy === "dashboard"
            ? { type: "user", id: createdBy }
            : { type: "agent", id: createdBy },
    };
    if (detail)
      task.parentTaskId = detail.parents[0] ? ids.encode({ board, taskId: detail.parents[0] }) : null;
    return task;
  };

  const mapper = defineMapper<TaskMappingInput, Task>({
    name: "Hermes Kanban-Aufgabe -> Task",
    schema: "Task",
    toCanonical: toTask,
  });
  return { map: (input, context) => mapper.map(input, context) };
}

const externalSeed = (ref: { board: string; taskId: string }): string => `${ref.board}/${ref.taskId}`;
