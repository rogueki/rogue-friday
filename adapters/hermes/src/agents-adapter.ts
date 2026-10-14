import type { Agent } from "@jarvis/sdk";
import {
  AdapterError,
  assertCanonicalEvent,
  createMapContext,
  normalizeError,
  toIso,
  type AdapterEventInput,
  type AgentPort,
  type CallContext,
  type IdParam,
  type ListAgentsParams,
  type MapContext,
  type Page,
  type Single,
} from "@jarvis/adapter-core";
import {
  agentFingerprint,
  createAgentMapper,
  type AgentMapper,
  type AgentTask,
  type AgentWorker,
} from "./agent-mapping";
import { HermesAdapterBase, type HealthProbeResult } from "./base";
import { createAgentIds, createTaskIds, notFound, type AgentIds, type TaskIds } from "./ids";
import { manifestFor, PROVIDER_SYSTEM } from "./manifest";
import { parseToolsets, type WireProfile, type WireWorker } from "./wire";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TOOLSET_TTL_MS = 60_000;
/** Kanban event kinds after which an agent's status may have changed. */
const STATUS_KINDS: ReadonlySet<string> = new Set([
  "spawned",
  "claimed",
  "completed",
  "blocked",
  "unblocked",
  "crashed",
  "timed_out",
  "gave_up",
  "spawn_failed",
  "reclaimed",
  "review_requested",
  "auto_blocked",
  "archived",
]);

function offsetOf(cursor: string | null | undefined): number {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  const match = /^o(\d+)$/.exec(cursor);
  if (!match) {
    throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungültiger Cursor.", retryable: false });
  }
  return Number(match[1]);
}

interface BoardWorkers {
  board: string;
  workers: WireWorker[];
}

/**
 * Agents on Hermes: profiles (`/api/profiles`), Kanban assignees and active workers. Status is derived; pause, resume
 * and stop are not offered (Hermes has no verified interface for them). Events: `jarvis.agent.status_changed` after
 * Kanban events that move an agent, `jarvis.agent.heartbeat` when a worker's heartbeat advances.
 */
export class HermesAgentsAdapter extends HermesAdapterBase implements AgentPort {
  readonly manifest = manifestFor("agents");

  private readonly taskIds: TaskIds = createTaskIds();
  private readonly agentIds: AgentIds = createAgentIds();
  private mapper: AgentMapper | undefined;
  private readonly firstSeen = new Map<string, number>();
  private readonly revisions = new Map<string, { fingerprint: string; version: number }>();
  private readonly heartbeats = new Map<string, number>();
  private toolsetCache: { at: number; names: string[] } | undefined;

  protected override onInitialize(): void {
    const { context } = this.ready();
    this.mapper = createAgentMapper({
      ids: this.agentIds,
      taskIds: this.taskIds,
      nowMs: () => context.clock.now(),
    });
    this.firstSeen.clear();
    this.revisions.clear();
    this.heartbeats.clear();
    this.toolsetCache = undefined;
  }

  protected override onShutdown(): void {
    this.mapper = undefined;
    this.toolsetCache = undefined;
  }

  protected probe(): Promise<HealthProbeResult> {
    return this.probeDashboard();
  }

  // ---- AgentPort -------------------------------------------------------------------------------------------------

  async listAgents(params: ListAgentsParams, call: CallContext): Promise<Page<Agent>> {
    const { context } = this.ready();
    let agents = await this.snapshot(call);
    if (params.status && params.status.length > 0)
      agents = agents.filter((a) => params.status?.includes(a.status));
    if (params.q) {
      const needle = params.q.toLowerCase();
      agents = agents.filter((a) =>
        [a.name, a.role, a.description ?? ""].some((text) => text.toLowerCase().includes(needle)),
      );
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
    const offset = offsetOf(params.cursor);
    const nextCursor = offset + limit < agents.length ? `o${offset + limit}` : null;
    return {
      items: agents.slice(offset, offset + limit),
      pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
      freshness: { state: "fresh", asOf: toIso(context.clock) },
    };
  }

  async getAgent(params: IdParam, call: CallContext): Promise<Single<Agent>> {
    const { context } = this.ready();
    const agent = (await this.snapshot(call)).find((candidate) => candidate.id === params.id);
    if (!agent) throw notFound("Agent", params.id);
    return { data: agent, freshness: { state: "fresh", asOf: toIso(context.clock) } };
  }

  // ---- events --------------------------------------------------------------------------------------------------------

  protected async pollCycle(): Promise<number> {
    const { feed, kanban, settings, context } = this.ready();
    const batches = await feed.fetch();

    // Which agents did the raw events touch? The event row only names the task, the task names the assignee.
    const touched: Array<{ board: string; taskId: string }> = [];
    for (const batch of batches) {
      for (const event of batch.events) {
        if (STATUS_KINDS.has(event.kind)) touched.push({ board: batch.board, taskId: event.taskId });
      }
    }
    const assignees = new Map<string, string | null>();
    for (const ref of touched) {
      const key = `${ref.board}/${ref.taskId}`;
      if (assignees.has(key)) continue;
      try {
        assignees.set(key, (await kanban.taskDetail(ref, "pollEvents")).task.assignee);
      } catch (error) {
        if (normalizeError(error).code !== "NOT_FOUND") throw error;
        assignees.set(key, null);
      }
    }
    const agents =
      touched.length > 0
        ? new Map((await this.snapshot()).map((agent) => [agent.source.externalId, agent]))
        : undefined;

    const events: AdapterEventInput[] = [];
    for (const batch of batches) {
      for (const event of batch.events) {
        if (!STATUS_KINDS.has(event.kind)) continue;
        const name = assignees.get(`${batch.board}/${event.taskId}`);
        const agent = name ? agents?.get(name) : undefined;
        if (agent) {
          events.push({ type: "jarvis.agent.status_changed", subject: `agent/${agent.id}`, data: agent });
        }
      }
    }

    // Heartbeats: workers whose last heartbeat advanced since the previous cycle.
    const seen = new Map<string, number>();
    const boardWorkers: BoardWorkers[] = await Promise.all(
      settings.boards.map(async (board) => ({ board, workers: await kanban.workers(board) })),
    );
    for (const { board, workers } of boardWorkers) {
      for (const worker of workers) {
        const name = worker.taskAssignee ?? worker.profile;
        if (!name || worker.lastHeartbeatAt === null) continue;
        const key = `${board}#${worker.runId}`;
        seen.set(key, worker.lastHeartbeatAt);
        if (worker.lastHeartbeatAt <= (this.heartbeats.get(key) ?? 0)) continue;
        events.push({
          type: "jarvis.agent.heartbeat",
          subject: `agent/${this.agentIds.encode(name)}`,
          data: {
            agentId: this.agentIds.encode(name),
            heartbeatAt: new Date(worker.lastHeartbeatAt * 1000).toISOString(),
            status: "working",
            currentTaskId: this.taskIds.encode({ board, taskId: worker.taskId }),
          },
        });
      }
    }

    for (const event of events) assertCanonicalEvent(event, "hermes-agents event");
    if (this.stopped) return 0;
    for (const event of events) context.emit(event);
    feed.commit(batches);
    this.heartbeats.clear();
    for (const [key, value] of seen) this.heartbeats.set(key, value);
    return events.length;
  }

  // ---- snapshot -----------------------------------------------------------------------------------------------------

  private mapContext(): MapContext {
    const { context } = this.ready();
    return createMapContext({ adapterId: this.manifest.id, system: PROVIDER_SYSTEM, clock: context.clock });
  }

  /** Complete agent list: profiles + Kanban assignees + workers (sorted: default first, then by name). */
  private async snapshot(call?: CallContext): Promise<Agent[]> {
    const { kanban, settings, context } = this.ready();
    if (!this.mapper) {
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Der Adapter ist nicht aktiv.",
        retryable: false,
      });
    }
    const [profiles, status, boards, toolsets] = await Promise.all([
      kanban.dashboardProfiles(call),
      kanban.status(call),
      Promise.all(
        settings.boards.map(async (board) => ({
          board,
          data: await kanban.board(board, { operation: "listAgents" }, call),
          workers: await kanban.workers(board, call),
        })),
      ),
      this.toolsets(call),
    ]);

    const byProfile = new Map<string, WireProfile>(profiles.map((profile) => [profile.name, profile]));
    const names = new Set<string>(byProfile.keys());
    for (const { data, workers } of boards) {
      for (const name of data.assignees) names.add(name);
      for (const worker of workers) {
        if (worker.taskAssignee) names.add(worker.taskAssignee);
        if (worker.profile) names.add(worker.profile);
      }
    }

    const now = context.clock.now();
    const mapContext = this.mapContext();
    const agents: Agent[] = [];
    for (const name of [...names].sort((a, b) =>
      a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b),
    )) {
      const tasks: AgentTask[] = boards.flatMap(({ board, data }) =>
        data.tasks.filter((task) => task.assignee === name).map((task) => ({ board, task })),
      );
      const workers: AgentWorker[] = boards.flatMap(({ board, workers: active }) =>
        active
          .filter((worker) => worker.taskAssignee === name || worker.profile === name)
          .map((worker) => ({
            board,
            taskId: worker.taskId,
            startedAt: worker.startedAt,
            lastHeartbeatAt: worker.lastHeartbeatAt,
          })),
      );
      const input = {
        name,
        profile: byProfile.get(name) ?? null,
        workers,
        tasks,
        gatewayRunning: status.gatewayRunning,
        toolsets,
      };
      const fingerprint = agentFingerprint(input);
      const previous = this.revisions.get(name);
      const revision =
        previous && previous.fingerprint === fingerprint
          ? previous
          : { fingerprint, version: (previous?.version ?? 0) + 1 };
      this.revisions.set(name, revision);
      if (!this.firstSeen.has(name)) this.firstSeen.set(name, now);
      agents.push(
        this.mapper.map(
          { ...input, firstSeenMs: this.firstSeen.get(name) ?? now, version: revision.version },
          mapContext,
        ),
      );
    }
    return agents;
  }

  /** Enabled toolsets of the API server (`/v1/toolsets`); optional enrichment, cached, never fatal. */
  private async toolsets(call?: CallContext): Promise<string[]> {
    const { clients, context } = this.ready();
    const now = context.clock.now();
    if (this.toolsetCache && now - this.toolsetCache.at < TOOLSET_TTL_MS) return this.toolsetCache.names;
    let names: string[] = [];
    try {
      const response = await clients.api.request({
        method: "GET",
        path: "/v1/toolsets",
        operation: "listAgents",
        ...(call?.correlationId ? { correlationId: call.correlationId } : {}),
        ...(call?.signal ? { signal: call.signal } : {}),
      });
      names = parseToolsets(response.body)
        .filter((toolset) => toolset.enabled)
        .map((toolset) => toolset.name);
    } catch (error) {
      const normalized = normalizeError(error);
      if (this.stopped) throw normalized;
      context.logger.warn("Hermes-Toolsets nicht lesbar; Fähigkeiten bleiben leer", {
        code: normalized.code,
      });
    }
    this.toolsetCache = { at: now, names };
    return names;
  }
}
