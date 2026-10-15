import type { ActivityEvent } from "@friday/sdk";
import {
  AdapterError,
  assertCanonicalEvent,
  createMapContext,
  normalizeError,
  toIso,
  type ActivityPort,
  type AdapterEventInput,
  type CallContext,
  type IdParam,
  type ListActivityParams,
  type MapContext,
  type Page,
  type Single,
} from "@friday/adapter-core";
import { ActivityBuffer } from "./activity-buffer";
import { kanbanEventToDraft, sessionMessagesToDrafts, type ActivityDraft } from "./activity-mapping";
import { HermesAdapterBase, healthMessage, type HealthProbeResult } from "./base";
import { createAgentIds, createTaskIds, notFound, type AgentIds, type TaskIds } from "./ids";
import { manifestFor, PROVIDER_SYSTEM } from "./manifest";
import { parseMessages, parseSessionPage, type WireSession } from "./wire";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MESSAGE_PAGE = 500;
const SESSION_PAGE_MAX = 200;
const MESSAGE_FETCH_CONCURRENCY = 4;
const KANBAN_HISTORY_EVENTS = 100;

interface SessionState {
  lastActive: number;
  messageCount: number;
}

interface PendingDraft {
  draft: ActivityDraft;
  messageId: number | null;
  /** Kanban events: id above which an event counts as new (not history). */
  eventId?: number;
  historicUpTo?: number;
}

/**
 * Activity on Hermes. There is no activity feed in Hermes: the adapter assembles one from the API server's session
 * messages (user requests, assistant answers, tool calls) and the Kanban `task_events` stream, keeps it in an
 * in-memory ring buffer and emits `friday.activity.appended` for everything that is new.
 */
export class HermesActivityAdapter extends HermesAdapterBase implements ActivityPort {
  readonly manifest = manifestFor("activity");

  private readonly taskIds: TaskIds = createTaskIds();
  private readonly agentIds: AgentIds = createAgentIds();
  private buffer: ActivityBuffer | undefined;
  private readonly sessions = new Map<string, SessionState>();
  /** Highest session message id already processed; `null` before the first sync. */
  private watermark: number | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  protected override historyDepth(): number {
    return KANBAN_HISTORY_EVENTS;
  }

  protected override onInitialize(): void {
    const { settings } = this.ready();
    this.buffer = new ActivityBuffer(settings.activityBufferSize);
    this.sessions.clear();
    this.watermark = null;
    this.chain = Promise.resolve();
  }

  protected override onShutdown(): void {
    this.buffer = undefined;
    this.sessions.clear();
  }

  protected async probe(): Promise<HealthProbeResult> {
    const { clients } = this.ready();
    // The API server is the primary source: sessions need its Bearer key.
    await clients.api.requestPublic({
      method: "GET",
      path: "/health",
      operation: "healthCheck",
      retry: false,
    });
    await clients.api.request({
      method: "GET",
      path: "/api/sessions",
      query: { limit: 1 },
      operation: "healthCheck",
      retry: false,
    });
    try {
      return await this.probeDashboard();
    } catch (raw) {
      const error = normalizeError(raw, { operation: "healthCheck" });
      return {
        status: "degraded",
        message: `Kanban-Ereignisse fehlen: ${healthMessage(error)}`,
        errorCode: error.code,
      };
    }
  }

  // ---- ActivityPort ----------------------------------------------------------------------------------------------

  async listActivity(params: ListActivityParams, call: CallContext): Promise<Page<ActivityEvent>> {
    const { context } = this.ready();
    await this.serialize(() => this.syncSessions(call));
    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
    const { items, nextCursor } = this.requireBuffer().query(params, limit);
    return {
      items,
      pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
      freshness: { state: "fresh", asOf: toIso(context.clock) },
    };
  }

  async getActivityEvent(params: IdParam, call: CallContext): Promise<Single<ActivityEvent>> {
    const { context } = this.ready();
    let event = this.requireBuffer().get(params.id);
    if (!event) {
      await this.serialize(() => this.syncSessions(call));
      event = this.requireBuffer().get(params.id);
    }
    if (!event) throw notFound("Aktivitätsereignis", params.id);
    return { data: event, freshness: { state: "fresh", asOf: toIso(context.clock) } };
  }

  // ---- events (activity.stream) ------------------------------------------------------------------------------------

  protected async pollCycle(): Promise<number> {
    let emitted = 0;
    let firstError: unknown;
    // Two independent sources: a failure of one must not stop the other, but it still surfaces to the caller.
    try {
      emitted += await this.serialize(() => this.syncSessions());
    } catch (error) {
      firstError ??= error;
    }
    try {
      emitted += await this.serialize(() => this.syncKanban());
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) throw firstError;
    return emitted;
  }

  // ---- sources -----------------------------------------------------------------------------------------------------

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private mapContext(): MapContext {
    const { context } = this.ready();
    return createMapContext({ adapterId: this.manifest.id, system: PROVIDER_SYSTEM, clock: context.clock });
  }

  private requireBuffer(): ActivityBuffer {
    this.ready();
    if (!this.buffer) {
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Der Adapter ist nicht aktiv.",
        retryable: false,
      });
    }
    return this.buffer;
  }

  /** Reads the most recently active sessions and ingests messages that are new or changed since the last sync. */
  private async syncSessions(call?: CallContext): Promise<number> {
    const { clients, settings, context } = this.ready();
    const buffer = this.requireBuffer();
    const correlation = call?.correlationId ? { correlationId: call.correlationId } : {};
    const signal = call?.signal ? { signal: call.signal } : {};

    const sessions: WireSession[] = [];
    for (let offset = 0; sessions.length < settings.activitySessionWindow;) {
      const response = await clients.api.request({
        method: "GET",
        path: "/api/sessions",
        query: {
          limit: Math.min(SESSION_PAGE_MAX, settings.activitySessionWindow - sessions.length),
          offset,
        },
        operation: "listActivity",
        ...correlation,
        ...signal,
      });
      const page = parseSessionPage(response.body);
      for (const session of page.sessions)
        if (!sessions.some((known) => known.id === session.id)) sessions.push(session);
      if (!page.hasMore || page.sessions.length === 0) break;
      offset += page.sessions.length;
    }

    const changed = sessions
      .filter((session) => {
        const state = this.sessions.get(session.id);
        return !state || state.lastActive < session.lastActive || state.messageCount !== session.messageCount;
      })
      .sort((a, b) => a.lastActive - b.lastActive);

    const mapContext = this.mapContext();
    const fetched = new Map<string, PendingDraft[]>();
    const queue = [...changed];
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const response = await clients.api.request({
          method: "GET",
          path: `/api/sessions/${encodeURIComponent(next.id)}/messages`,
          query: { limit: MESSAGE_PAGE, order: "latest" },
          operation: "listActivity",
          ...correlation,
          ...signal,
        });
        fetched.set(
          next.id,
          sessionMessagesToDrafts(next, parseMessages(response.body), mapContext).map(
            ({ draft, messageId }): PendingDraft => ({ draft, messageId }),
          ),
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(MESSAGE_FETCH_CONCURRENCY, queue.length) }, worker));

    // ---- apply (synchronous from here: validate everything first, then mutate, emit, commit) ----
    const ordered = changed.flatMap((session) => fetched.get(session.id) ?? []);
    for (const entry of ordered) buffer.validate(entry.draft, mapContext);
    const maxMessageId = Math.max(0, ...ordered.map((entry) => entry.messageId ?? 0));
    const startCursor = settings.eventsStartCursor;
    const threshold = this.watermark ?? (startCursor === "tail" ? maxMessageId : startCursor);
    const events: AdapterEventInput[] = [];
    const created: ActivityEvent[] = [];
    for (const entry of ordered) {
      const result = buffer.upsert(entry.draft, mapContext);
      if (result.created && (entry.messageId ?? 0) > threshold) created.push(result.event);
    }
    for (const event of created) events.push(this.toEvent(event));
    for (const event of events) assertCanonicalEvent(event, "hermes-activity event");
    if (this.stopped) return 0;
    for (const event of events) context.emit(event);
    this.watermark = Math.max(threshold, maxMessageId);
    for (const session of changed) {
      this.sessions.set(session.id, { lastActive: session.lastActive, messageCount: session.messageCount });
    }
    return events.length;
  }

  /** Drains the Kanban event stream into the buffer; history before the adapter start is buffered but not emitted. */
  private async syncKanban(): Promise<number> {
    const { feed, context } = this.ready();
    const buffer = this.requireBuffer();
    const batches = await feed.fetch();
    if (batches.length === 0) return 0;
    const mapContext = this.mapContext();
    const pending: PendingDraft[] = batches.flatMap((batch) =>
      batch.events.map((event) => ({
        draft: kanbanEventToDraft(batch.board, event, mapContext, {
          taskIds: this.taskIds,
          agentIds: this.agentIds,
        }),
        messageId: null,
        eventId: event.id,
        historicUpTo: batch.historicUpTo,
      })),
    );
    for (const entry of pending) buffer.validate(entry.draft, mapContext);
    const created: ActivityEvent[] = [];
    for (const entry of pending) {
      const result = buffer.upsert(entry.draft, mapContext);
      if (result.created && (entry.eventId ?? 0) > (entry.historicUpTo ?? 0)) created.push(result.event);
    }
    const events = created.map((event) => this.toEvent(event));
    for (const event of events) assertCanonicalEvent(event, "hermes-activity event");
    if (this.stopped) return 0;
    for (const event of events) context.emit(event);
    feed.commit(batches);
    return events.length;
  }

  private toEvent(event: ActivityEvent): AdapterEventInput {
    return {
      type: "friday.activity.appended",
      subject: `activity/${event.id}`,
      data: event,
      correlationId: event.correlationId,
    };
  }
}
