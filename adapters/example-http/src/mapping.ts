import type { Priority, Task, TaskCreateRequest, TaskStatus, TaskUpdateRequest } from "@friday/sdk";
import {
  createIdCodec,
  defineEventMapper,
  defineMapper,
  type AdapterEventInput,
  type IdCodec,
  type MapContext,
} from "@friday/adapter-core";
import type { RawClosedReason, RawEvent, RawItem, RawItemWrite, RawState } from "./provider-types";

// Field tables: see docs/MAPPING/example-tasks.md

const PRIORITY_BY_PRIO: Readonly<Record<number, Priority>> = { 1: "P0", 2: "P1", 3: "P2", 4: "P3", 5: "P4" };
const PRIO_BY_PRIORITY: Readonly<Record<Priority, number>> = { P0: 1, P1: 2, P2: 3, P3: 4, P4: 5 };

export function toTaskStatus(state: RawState, closedReason: RawClosedReason | null | undefined): TaskStatus {
  switch (state) {
    case "open":
      return "todo";
    case "in_progress":
      return "running";
    case "blocked":
      return "waiting";
    case "closed":
      return closedReason === "cancelled" ? "cancelled" : closedReason === "failed" ? "failed" : "done";
  }
}

/** Canonical status -> provider write. Statuses without a provider equivalent collapse to the closest state. */
export function toRawState(status: TaskStatus): Pick<RawItemWrite, "state" | "closed_reason"> {
  switch (status) {
    case "triage":
    case "todo":
    case "ready":
      return { state: "open" };
    case "running":
    case "review":
      return { state: "in_progress" };
    case "waiting":
      return { state: "blocked" };
    case "done":
      return { state: "closed", closed_reason: "completed" };
    case "failed":
      return { state: "closed", closed_reason: "failed" };
    case "cancelled":
      return { state: "closed", closed_reason: "cancelled" };
  }
}

export interface TaskMapping {
  readonly ids: { task: IdCodec; agent: IdCodec };
  toTask(raw: RawItem, context: MapContext, nowMs: number): Task;
  mapItem(raw: RawItem, context: MapContext): Task;
  mapEvent(raw: RawEvent, context: MapContext): AdapterEventInput[];
  toCreateWrite(body: TaskCreateRequest): RawItemWrite;
  toUpdateWrite(body: TaskUpdateRequest): RawItemWrite;
}

export function createTaskMapping(nowMs: () => number): TaskMapping {
  const ids = { task: createIdCodec("task"), agent: createIdCodec("agent") };

  const toTask = (raw: RawItem, context: MapContext, now: number): Task => {
    const status = toTaskStatus(raw.state, raw.closed_reason);
    const running = status === "running";
    const startedAt = raw.started_at ?? null;
    return {
      id: ids.task.encode(raw.item_id),
      version: raw.rev,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      labels: raw.tags ?? [],
      source: context.source(raw.item_id),
      title: raw.title,
      ...(raw.body ? { description: raw.body } : {}),
      status,
      priority: PRIORITY_BY_PRIO[raw.prio] ?? "P3",
      agentId: raw.owner_bot ? ids.agent.encode(raw.owner_bot) : null,
      ...(raw.owner_bot ? { agentName: raw.owner_bot } : {}),
      model: null,
      progress:
        raw.pct !== null
          ? { mode: "determinate", value: Math.min(1, Math.max(0, raw.pct / 100)) }
          : running
            ? { mode: "indeterminate", value: null }
            : { mode: "none", value: null },
      startedAt,
      runtimeMs: running && startedAt ? Math.max(0, now - Date.parse(startedAt)) : null,
      dueAt: raw.due ?? null,
      estimatedCompletionAt: null,
      blockers:
        raw.state === "blocked"
          ? [
              {
                id: `blk_${raw.item_id}`,
                kind: "other",
                description: "Vom Fremdsystem als blockiert gemeldet.",
                since: raw.updated_at,
              },
            ]
          : [],
      lastActivityAt: raw.updated_at,
      artifactCount: 0,
      artifacts: [],
      steps: [],
      toolCalls: [],
      sourceRefs: [],
      approvalIds: [],
      errors: [],
      createdBy: { type: "adapter", id: context.adapterId },
    };
  };

  const taskMapper = defineMapper<RawItem, Task>({
    name: "ExampleTasks item -> Task",
    schema: "Task",
    toCanonical: (raw, context) => toTask(raw, context, nowMs()),
  });

  const eventMapper = defineEventMapper<RawEvent>({
    name: "ExampleTasks event -> friday.task.*",
    toCanonical: (raw, context) => {
      const task = taskMapper.map(raw.item, context);
      const subject = `task/${task.id}`;
      switch (raw.kind) {
        case "item.created":
          return { type: "friday.task.created", subject, data: task };
        case "item.updated":
          return { type: "friday.task.updated", subject, data: task };
        case "item.progress":
          return {
            type: "friday.task.progress",
            subject,
            data: {
              taskId: task.id,
              progress: task.progress,
              ...(raw.message ? { message: raw.message } : {}),
              agentId: task.agentId,
            },
          };
        case "item.closed":
          return {
            type:
              task.status === "cancelled"
                ? "friday.task.cancelled"
                : task.status === "failed"
                  ? "friday.task.failed"
                  : "friday.task.completed",
            subject,
            data: task,
          };
        default:
          return null; // unknown future event kinds are ignored on purpose
      }
    },
  });

  return {
    ids,
    toTask,
    mapItem: (raw, context) => taskMapper.map(raw, context),
    mapEvent: (raw, context) => eventMapper.map(raw, context),
    toCreateWrite: (body) => ({
      title: body.title,
      ...(body.description !== undefined ? { body: body.description } : {}),
      ...(body.priority ? { prio: PRIO_BY_PRIORITY[body.priority] } : {}),
      ...(body.agentId ? { owner_bot: ids.agent.require(body.agentId) } : {}),
      ...(body.dueAt !== undefined ? { due: body.dueAt } : {}),
      ...(body.labels ? { tags: body.labels } : {}),
    }),
    toUpdateWrite: (body) => ({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { body: body.description } : {}),
      ...(body.status ? toRawState(body.status) : {}),
      ...(body.priority ? { prio: PRIO_BY_PRIORITY[body.priority] } : {}),
      ...(body.agentId !== undefined
        ? { owner_bot: body.agentId === null ? null : ids.agent.require(body.agentId) }
        : {}),
      ...(body.dueAt !== undefined ? { due: body.dueAt } : {}),
      ...(body.labels ? { tags: body.labels } : {}),
    }),
  };
}
