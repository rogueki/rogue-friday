import type { Task, TaskActionRequest, TaskCreateRequest, TaskUpdateRequest } from "@friday/sdk";
import {
  AdapterError,
  assertCanonicalEvent,
  createMapContext,
  normalizeError,
  toIso,
  type AdapterEventInput,
  type CallContext,
  type IdParam,
  type ListTasksParams,
  type MutationContext,
  type Page,
  type Single,
  type TaskPort,
} from "@friday/adapter-core";
import { HermesAdapterBase, type HealthProbeResult } from "./base";
import {
  correlationFor,
  createAgentIds,
  createTaskIds,
  notFound,
  type AgentIds,
  type TaskIds,
  type TaskRef,
} from "./ids";
import { manifestFor, PROVIDER_SYSTEM } from "./manifest";
import { priorityRank, toHermesPatchStatus, toHermesPriority, unsupported, wantsArchived } from "./status";
import { createTaskMapper, taskVersion, type TaskMapper } from "./task-mapping";
import type { Json, WireEvent, WireTaskDetail } from "./wire";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PROFILE_TTL_MS = 60_000;
const PROFILE_FAILURE_TTL_MS = 15_000;
const FAILURE_KINDS: ReadonlySet<string> = new Set(["crashed", "timed_out", "gave_up", "spawn_failed"]);
const EVENT_FETCH_CONCURRENCY = 4;

function offsetOf(cursor: string | null | undefined): number {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  const match = /^o(\d+)$/.exec(cursor);
  if (!match) {
    throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungültiger Cursor.", retryable: false });
  }
  return Number(match[1]);
}

/** Canonical event type for a Kanban event kind (mapping doc §6.2; unknown kinds are plain updates). */
export function taskEventType(kind: string, task: Task): AdapterEventInput["type"] {
  if (kind === "created") return "friday.task.created";
  if (kind === "completed") return "friday.task.completed";
  if (kind === "archived") return "friday.task.cancelled";
  if (FAILURE_KINDS.has(kind) && task.status === "failed") return "friday.task.failed";
  return "friday.task.updated";
}

/**
 * Tasks/Kanban on Hermes: dashboard REST of the Kanban plugin (read + create + update) and the Kanban event WebSocket
 * (`tasks.stream`). Cancel archives atomically in Hermes; retry is restricted to non-running terminal/blocked work.
 */
export class HermesTasksAdapter extends HermesAdapterBase implements TaskPort {
  readonly manifest = manifestFor("tasks");

  private readonly taskIds: TaskIds = createTaskIds();
  private readonly agentIds: AgentIds = createAgentIds();
  private mapper: TaskMapper | undefined;
  private profileCache: { at: number; ttl: number; models: Map<string, string | null> } | undefined;

  protected override onInitialize(): void {
    const { context } = this.ready();
    this.mapper = createTaskMapper({
      ids: this.taskIds,
      agentIds: this.agentIds,
      nowMs: () => context.clock.now(),
    });
    this.profileCache = undefined;
  }

  protected override onShutdown(): void {
    this.mapper = undefined;
    this.profileCache = undefined;
  }

  protected probe(): Promise<HealthProbeResult> {
    return this.probeDashboard();
  }

  // ---- TaskPort ------------------------------------------------------------------------------------------------

  async listTasks(params: ListTasksParams, call: CallContext): Promise<Page<Task>> {
    const { kanban, settings, context } = this.ready();
    const includeArchived = wantsArchived(params.status);
    const boards = await Promise.all(
      settings.boards.map(async (board) => ({
        board,
        data: await kanban.board(board, { includeArchived, operation: "listTasks" }, call),
      })),
    );
    const profileModel = await this.profileModel(call);
    const mapContext = createMapContext({
      adapterId: this.manifest.id,
      system: PROVIDER_SYSTEM,
      clock: context.clock,
    });
    const mapper = this.requireMapper();
    let items: Task[] = boards.flatMap(({ board, data }) =>
      data.tasks.map((raw) => mapper.map({ board, raw, profileModel }, mapContext)),
    );

    if (params.status && params.status.length > 0)
      items = items.filter((t) => params.status?.includes(t.status));
    if (params.priority && params.priority.length > 0) {
      items = items.filter((t) => params.priority?.includes(t.priority));
    }
    if (params.agentId !== undefined) items = items.filter((t) => t.agentId === params.agentId);
    if (params.label !== undefined) items = items.filter((t) => t.labels?.includes(params.label as string));
    if (params.q) {
      const needle = params.q.toLowerCase();
      items = items.filter(
        (t) => t.title.toLowerCase().includes(needle) || (t.description ?? "").toLowerCase().includes(needle),
      );
    }
    if (params.dueBefore) {
      const bound = Date.parse(params.dueBefore);
      items = items.filter((t) => t.dueAt !== null && Date.parse(t.dueAt) < bound);
    }
    if (params.updatedSince) {
      const bound = Date.parse(params.updatedSince);
      items = items.filter((t) => Date.parse(t.updatedAt) >= bound);
    }
    const byUpdated = (a: Task, b: Task): number => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    const sorters: Record<NonNullable<ListTasksParams["sort"]>, (a: Task, b: Task) => number> = {
      "-updatedAt": byUpdated,
      updatedAt: (a, b) => byUpdated(b, a),
      priority: (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || byUpdated(a, b),
      dueAt: (a, b) => (a.dueAt === null ? 1 : 0) - (b.dueAt === null ? 1 : 0) || byUpdated(a, b),
    };
    items.sort((a, b) => sorters[params.sort ?? "-updatedAt"](a, b) || a.id.localeCompare(b.id));

    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
    const offset = offsetOf(params.cursor);
    const page = items.slice(offset, offset + limit);
    const nextCursor = offset + limit < items.length ? `o${offset + limit}` : null;
    return {
      items: page,
      pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
      freshness: { state: "fresh", asOf: mapContext.syncedAt },
    };
  }

  async getTask(params: IdParam, call: CallContext): Promise<Single<Task>> {
    const { kanban, context } = this.ready();
    const ref = await this.resolveTask(params.id, call);
    const detail = await kanban.taskDetail(ref, "getTask", call);
    const profileModel = await this.profileModel(call);
    return {
      data: this.mapDetail(ref.board, detail, profileModel),
      freshness: { state: "fresh", asOf: toIso(context.clock) },
    };
  }

  async createTask(params: { body: TaskCreateRequest }, call: MutationContext): Promise<Single<Task>> {
    const { kanban, settings, context } = this.ready();
    const { body } = params;
    if (body.dueAt !== undefined && body.dueAt !== null) {
      throw unsupported("Hermes kennt keine Fälligkeit; dueAt wird nicht unterstützt.");
    }
    let board = settings.boards[0] as string;
    let tenant: string | undefined;
    for (const label of body.labels ?? []) {
      if (label.startsWith("board:")) {
        board = label.slice("board:".length);
        if (!settings.boards.includes(board)) throw unsupported(`Board '${board}' ist nicht konfiguriert.`);
      } else if (label.startsWith("tenant:")) {
        tenant = label.slice("tenant:".length);
      } else {
        throw unsupported("Hermes kennt keine freien Labels (nur 'board:<slug>' und 'tenant:<name>').");
      }
    }
    const payload: Json = {
      title: body.title,
      ...(body.description !== undefined ? { body: body.description } : {}),
      ...(body.agentId ? { assignee: await this.resolveAgent(body.agentId, call) } : {}),
      ...(body.priority ? { priority: toHermesPriority(body.priority) } : {}),
      ...(body.model ? { model_override: body.model } : {}),
      ...(tenant ? { tenant } : {}),
      ...(call.idempotencyKey ? { idempotency_key: call.idempotencyKey } : {}),
    };
    const raw = await kanban.createTask(board, payload, { idempotencyKey: call.idempotencyKey }, call);
    const profileModel = await this.profileModel(call);
    return {
      data: this.requireMapper().map({ board, raw, profileModel }, this.mapContext()),
      freshness: { state: "fresh", asOf: toIso(context.clock) },
    };
  }

  async updateTask(
    params: IdParam & { body: TaskUpdateRequest },
    call: MutationContext,
  ): Promise<Single<Task>> {
    const { kanban, context } = this.ready();
    const { body } = params;
    const ref = await this.resolveTask(params.id, call);
    if (body.dueAt !== undefined && body.dueAt !== null) {
      throw unsupported("Hermes kennt keine Fälligkeit; dueAt wird nicht unterstützt.");
    }

    if (call.ifMatchVersion !== undefined || body.labels !== undefined) {
      const current = await kanban.taskDetail(ref, "updateTask", call);
      if (call.ifMatchVersion !== undefined && taskVersion(current.task) !== call.ifMatchVersion) {
        throw new AdapterError({
          code: "CONFLICT",
          message: "Die Aufgabe wurde in Hermes zwischenzeitlich geändert.",
          retryable: false,
          details: { expectedVersion: call.ifMatchVersion, currentVersion: taskVersion(current.task) },
        });
      }
      if (body.labels !== undefined) {
        const labels = this.mapDetail(ref.board, current, () => null).labels ?? [];
        const same = [...body.labels].sort().join("\n") === [...labels].sort().join("\n");
        if (!same) throw unsupported("Labels sind in Hermes nicht änderbar (Board und Mandant sind fest).");
      }
    }

    const patch: Json = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { body: body.description } : {}),
      ...(body.status !== undefined ? { status: toHermesPatchStatus(body.status) } : {}),
      ...(body.priority !== undefined ? { priority: toHermesPriority(body.priority) } : {}),
      ...(body.agentId !== undefined
        ? { assignee: body.agentId === null ? "" : await this.resolveAgent(body.agentId, call) }
        : {}),
    };
    const profileModel = await this.profileModel(call);
    if (Object.keys(patch).length === 0) {
      const detail = await kanban.taskDetail(ref, "updateTask", call);
      return {
        data: this.mapDetail(ref.board, detail, profileModel),
        freshness: { state: "fresh", asOf: toIso(context.clock) },
      };
    }
    const raw = await kanban.patchTask(ref, patch, { idempotencyKey: call.idempotencyKey }, call);
    return {
      data: this.requireMapper().map({ board: ref.board, raw, profileModel }, this.mapContext()),
      freshness: { state: "fresh", asOf: toIso(context.clock) },
    };
  }

  async cancelTask(params: IdParam & { body?: TaskActionRequest }, call: MutationContext): Promise<Single<Task>> {
    const { kanban, context } = this.ready();
    const ref = await this.resolveTask(params.id, call);
    const before = await kanban.taskDetail(ref, "cancelTask", call);
    this.assertLifecycleVersion(before.task, call);
    if (before.task.status === "archived" || before.task.status === "done") {
      throw new AdapterError({ code: "CONFLICT", message: "Die Aufgabe ist bereits beendet.", retryable: false });
    }
    // Upstream archive_task commits the terminal status, closes an open run, then terminates its
    // worker. Reclaiming first would return it to a dispatchable state and create a race.
    await kanban.patchTask(ref, { status: "archived" }, {}, call);
    const after = await kanban.taskDetail(ref, "cancelTask", call);
    if (after.task.status !== "archived") {
      throw new AdapterError({ code: "CONFLICT", message: "Hermes meldet die Aufgabe nicht als archiviert.", retryable: false });
    }
    return { data: this.mapDetail(ref.board, after, await this.profileModel(call)),
      freshness: { state: "fresh", asOf: toIso(context.clock) } };
  }

  async retryTask(params: IdParam & { body?: TaskActionRequest }, call: MutationContext): Promise<Single<Task>> {
    const { kanban, context } = this.ready();
    const ref = await this.resolveTask(params.id, call);
    const before = await kanban.taskDetail(ref, "retryTask", call);
    this.assertLifecycleVersion(before.task, call);
    // `ready` with last_failure_error is a historical failure marker, not a stopped task:
    // the dispatcher may already be claiming it. Only blocked failures and archived work
    // have a known safe transition to ready in the pinned Hermes workflow.
    if (before.task.status !== "archived" &&
        !(before.task.status === "blocked" &&
          (before.task.lastFailureError || before.task.blockKind === "friday_stopped"))) {
      throw new AdapterError({ code: "CONFLICT", message: "Nur archivierte oder blockierte fehlgeschlagene Aufgaben koennen erneut gestartet werden.", retryable: false });
    }
    await kanban.patchTask(ref, { status: "ready" }, {}, call);
    const after = await kanban.taskDetail(ref, "retryTask", call);
    if (after.task.status !== "ready" && after.task.status !== "running") {
      throw new AdapterError({ code: "CONFLICT", message: "Hermes hat den Neustart nicht bestaetigt.", retryable: false });
    }
    return { data: this.mapDetail(ref.board, after, await this.profileModel(call)),
      freshness: { state: "fresh", asOf: toIso(context.clock) } };
  }

  private assertLifecycleVersion(raw: WireTaskDetail["task"], call: MutationContext): void {
    if (call.ifMatchVersion !== undefined && taskVersion(raw) !== call.ifMatchVersion) {
      throw new AdapterError({ code: "CONFLICT", message: "Die Aufgabe wurde in Hermes zwischenzeitlich geaendert.",
        retryable: false, details: { expectedVersion: call.ifMatchVersion, currentVersion: taskVersion(raw) } });
    }
  }

  // ---- events (tasks.stream) ---------------------------------------------------------------------------------------------

  /**
   * One cycle: drain the Kanban event stream per board, fetch each touched task once, map every raw event to
   * `friday.task.*` carrying the task snapshot at fetch time. Cursors advance only after all events were emitted.
   */
  protected async pollCycle(): Promise<number> {
    const { feed, kanban, context } = this.ready();
    const batches = await feed.fetch();
    if (batches.length === 0) return 0;

    const profileModel = await this.profileModel();
    const mapContext = this.mapContext();
    const wanted = new Map<string, TaskRef>();
    for (const batch of batches) {
      for (const event of batch.events) {
        wanted.set(`${batch.board}/${event.taskId}`, { board: batch.board, taskId: event.taskId });
      }
    }
    const snapshots = new Map<string, Task | null>();
    const queue = [...wanted.entries()];
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [key, ref] = next;
        try {
          const detail = await kanban.taskDetail(ref, "pollEvents");
          snapshots.set(key, this.mapDetail(ref.board, detail, profileModel, mapContext));
        } catch (error) {
          const normalized = normalizeError(error);
          if (normalized.code !== "NOT_FOUND") throw normalized;
          snapshots.set(key, null); // deleted after the event: nothing to publish
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(EVENT_FETCH_CONCURRENCY, queue.length) }, worker));

    const events: AdapterEventInput[] = [];
    for (const batch of batches) {
      for (const event of batch.events) {
        const task = snapshots.get(`${batch.board}/${event.taskId}`);
        if (!task) {
          context.logger.warn("Kanban-Ereignis ohne Aufgabe übersprungen", { kind: event.kind });
          continue;
        }
        events.push(this.toEvent(event, task));
      }
    }
    for (const event of events) assertCanonicalEvent(event, "hermes-tasks event");
    if (this.stopped) return 0;
    for (const event of events) context.emit(event);
    feed.commit(batches);
    return events.length;
  }

  private toEvent(event: WireEvent, task: Task): AdapterEventInput {
    const type = taskEventType(event.kind, task);
    // The type is computed, so TypeScript cannot narrow the union; every `friday.task.*` type here carries a Task.
    return {
      type,
      subject: `task/${task.id}`,
      data: task,
      correlationId: correlationFor(`task:${task.source.externalId ?? task.id}`),
    } as AdapterEventInput;
  }

  // ---- helpers -----------------------------------------------------------------------------------------------------

  private requireMapper(): TaskMapper {
    this.ready();
    if (!this.mapper)
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Der Adapter ist nicht aktiv.",
        retryable: false,
      });
    return this.mapper;
  }

  private mapContext() {
    const { context } = this.ready();
    return createMapContext({ adapterId: this.manifest.id, system: PROVIDER_SYSTEM, clock: context.clock });
  }

  private mapDetail(
    board: string,
    detail: WireTaskDetail,
    profileModel: (assignee: string | null) => string | null,
    mapContext = this.mapContext(),
  ): Task {
    return this.requireMapper().map({ board, raw: detail.task, detail, profileModel }, mapContext);
  }

  /**
   * Contract id -> board + Hermes id. Ids of non-default boards are hashed by the codec; after a restart the table is
   * empty, so a miss triggers one rehydration pass over all configured boards before giving up with NOT_FOUND.
   */
  private async resolveTask(id: string, call: CallContext): Promise<TaskRef> {
    const known = this.taskIds.decode(id);
    if (known) return known;
    const { kanban, settings } = this.ready();
    for (const board of settings.boards) {
      const data = await kanban.board(board, { includeArchived: true, operation: "getTask" }, call);
      for (const task of data.tasks) this.taskIds.encode({ board, taskId: task.id });
    }
    const rehydrated = this.taskIds.decode(id);
    if (!rehydrated) throw notFound("Aufgabe", id);
    return rehydrated;
  }

  private async resolveAgent(id: string, call: CallContext): Promise<string> {
    const known = this.agentIds.decode(id);
    if (known) return known;
    const { kanban, settings } = this.ready();
    for (const board of settings.boards) {
      const data = await kanban.board(board, { operation: "resolveAgent" }, call);
      for (const name of data.assignees) this.agentIds.encode(name);
    }
    for (const profile of await kanban.dashboardProfiles(call)) this.agentIds.encode(profile.name);
    const rehydrated = this.agentIds.decode(id);
    if (!rehydrated) throw notFound("Agent", id);
    return rehydrated;
  }

  /**
   * Profile models for tasks without `model_override`. Best effort: a failing profile list must not hide the tasks,
   * so the failure is logged and retried after a short pause.
   */
  private async profileModel(call?: CallContext): Promise<(assignee: string | null) => string | null> {
    const { kanban, context } = this.ready();
    const now = context.clock.now();
    if (!this.profileCache || now - this.profileCache.at > this.profileCache.ttl) {
      try {
        const profiles = await kanban.profiles(call);
        this.profileCache = {
          at: now,
          ttl: PROFILE_TTL_MS,
          models: new Map(profiles.map((profile) => [profile.name, profile.model])),
        };
      } catch (error) {
        const normalized = normalizeError(error);
        if (normalized.code === "ADAPTER_UNAVAILABLE" && this.stopped) throw normalized;
        context.logger.warn("Hermes-Profile nicht lesbar; Modell bleibt unbekannt", {
          code: normalized.code,
        });
        this.profileCache = {
          at: now,
          ttl: PROFILE_FAILURE_TTL_MS,
          models: this.profileCache?.models ?? new Map(),
        };
      }
    }
    const models = this.profileCache.models;
    return (assignee) => (assignee === null ? null : (models.get(assignee) ?? null));
  }
}
