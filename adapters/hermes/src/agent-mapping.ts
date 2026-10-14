import type { Agent, AgentHeartbeat, ErrorDetail } from "@jarvis/sdk";
import { defineMapper, type MapContext } from "@jarvis/adapter-core";
import { correlationFor, type AgentIds, type TaskIds } from "./ids";
import { toAgentStatus } from "./status";
import { isoFromSeconds, lastChangeSeconds, truncate } from "./task-mapping";
import type { WireProfile, WireTask } from "./wire";

// Field tables: docs/MAPPING/hermes.md §6.3

export interface AgentWorker {
  board: string;
  taskId: string;
  startedAt: number | null;
  lastHeartbeatAt: number | null;
}

export interface AgentTask {
  board: string;
  task: WireTask;
}

export interface AgentInput {
  /** Profile / assignee name; identity of the agent. */
  name: string;
  profile: WireProfile | null;
  workers: readonly AgentWorker[];
  tasks: readonly AgentTask[];
  gatewayRunning: boolean | null;
  toolsets: readonly string[];
  /** First time this process saw the agent (Hermes reports no creation time). */
  firstSeenMs: number;
  /** Per-process revision, bumped by the adapter whenever the derived state changes. */
  version: number;
}

const isFailed = (task: WireTask): boolean =>
  (task.status === "ready" || task.status === "blocked") && !!task.lastFailureError;

/** Everything that, when changed, bumps the agent's revision. */
export function agentFingerprint(input: Omit<AgentInput, "firstSeenMs" | "version">): string {
  return JSON.stringify([
    input.gatewayRunning,
    input.profile?.model ?? null,
    input.workers.map((w) => [w.board, w.taskId]),
    input.tasks.filter((t) => t.task.status === "blocked").length,
    input.tasks.filter((t) => t.task.status === "done").length,
    input.tasks.filter((t) => isFailed(t.task)).length,
  ]);
}

export interface AgentMapper {
  map(input: AgentInput, context: MapContext): Agent;
  heartbeat(agent: Agent): AgentHeartbeat | null;
}

export function createAgentMapper(deps: {
  ids: AgentIds;
  taskIds: TaskIds;
  nowMs: () => number;
}): AgentMapper {
  const toAgent = (input: AgentInput, context: MapContext): Agent => {
    const now = deps.nowMs();
    const workers = [...input.workers].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const active = workers[0];
    const done = input.tasks.filter((t) => t.task.status === "done");
    const failed = input.tasks.filter((t) => isFailed(t.task));
    const durations = done
      .map((t) => t.task.timeToCompleteSeconds)
      .filter((value): value is number => value !== null && value >= 0);
    const finished = done.length + failed.length;

    const lastFailure = [...failed].sort((a, b) => lastChangeSeconds(b.task) - lastChangeSeconds(a.task))[0];
    const lastError: ErrorDetail | null = lastFailure?.task.lastFailureError
      ? {
          code: "INTERNAL",
          message: truncate(lastFailure.task.lastFailureError, 300),
          severity: "error",
          retryable: false,
          correlationId: correlationFor(`task:${lastFailure.board}/${lastFailure.task.id}`),
          details: {},
        }
      : null;

    const activitySeconds = Math.max(
      0,
      ...input.tasks.map((t) => lastChangeSeconds(t.task)),
      ...workers.map((w) => w.lastHeartbeatAt ?? 0),
    );
    const heartbeatSeconds = Math.max(0, ...workers.map((w) => w.lastHeartbeatAt ?? 0));
    const description = input.profile?.description?.trim() ?? "";
    const waitingForInput = input.tasks.some(
      (t) => t.task.status === "blocked" && t.task.blockKind === "needs_input",
    );

    return {
      id: deps.ids.encode(input.name),
      version: Math.max(1, input.version),
      createdAt: new Date(input.firstSeenMs).toISOString(),
      updatedAt: new Date(now).toISOString(),
      source: context.source(input.name),
      name: input.profile?.displayName?.trim() || (input.name === "default" ? "Hermes" : input.name),
      role: description ? truncate(description, 80) : "Assistent",
      ...(description ? { description } : {}),
      status: toAgentStatus({
        gatewayRunning: input.gatewayRunning,
        hasWorker: workers.length > 0,
        waitingForInput,
      }),
      currentTaskId: active ? deps.taskIds.encode({ board: active.board, taskId: active.taskId }) : null,
      model: input.profile?.model ?? null,
      // Hermes exposes no reasoning level per profile (only per task); the contract has no "unknown" value.
      reasoningLevel: "none",
      capabilities: [...input.toolsets],
      // Active tools are only observable for runs the adapter starts itself; none are started here.
      activeTools: [],
      startedAt: active?.startedAt != null ? isoFromSeconds(active.startedAt) : null,
      runtimeMs: active?.startedAt != null ? Math.max(0, now - active.startedAt * 1000) : null,
      heartbeatAt: heartbeatSeconds > 0 ? isoFromSeconds(heartbeatSeconds) : null,
      successRate: finished > 0 ? done.length / finished : null,
      performance: {
        avgTaskDurationMs:
          durations.length > 0
            ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 1000)
            : null,
        tasksCompleted: done.length,
        tasksFailed: failed.length,
      },
      lastActivityAt: activitySeconds > 0 ? isoFromSeconds(activitySeconds) : null,
      lastError,
      configuration: {
        onDisk: input.profile !== null,
        isDefault: input.profile?.isDefault ?? input.name === "default",
        ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
        ...(input.profile?.skillCount != null ? { skillCount: input.profile.skillCount } : {}),
      },
    };
  };

  const mapper = defineMapper<AgentInput, Agent>({
    name: "Hermes Profil -> Agent",
    schema: "Agent",
    toCanonical: toAgent,
  });

  return {
    map: (input, context) => mapper.map(input, context),
    heartbeat: (agent) =>
      agent.heartbeatAt === null
        ? null
        : {
            agentId: agent.id,
            heartbeatAt: agent.heartbeatAt,
            status: agent.status,
            currentTaskId: agent.currentTaskId,
          },
  };
}
