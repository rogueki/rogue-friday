import type { Task, TaskActionRequest, TaskCreateRequest, TaskUpdateRequest } from "@jarvis/sdk";
import {
  AdapterError,
  createHttpClient,
  createMapContext,
  createRedactor,
  normalizeError,
  toIso,
  type AdapterContext,
  type AdapterHealthReport,
  type CallContext,
  type CapabilitySet,
  type HttpClient,
  type IdParam,
  type JarvisAdapter,
  type ListTasksParams,
  type MutationContext,
  type Page,
  type Single,
  type TaskPort,
} from "@jarvis/adapter-core";
import { PROVIDER_SYSTEM, manifest } from "./manifest";
import { createTaskMapping, type TaskMapping } from "./mapping";
import type { RawEventBatch, RawItem, RawItemPage, RawState } from "./provider-types";

interface AdapterSettings {
  baseUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  pollIntervalMs: number;
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function readSettings(config: Readonly<Record<string, unknown>>): AdapterSettings {
  if (typeof config.baseUrl !== "string" || config.baseUrl.length === 0) {
    throw new AdapterError({
      code: "VALIDATION_FAILED",
      message: "baseUrl fehlt in der Adapter-Konfiguration.",
      retryable: false,
    });
  }
  return {
    baseUrl: config.baseUrl,
    timeoutMs: numberOr(config.timeoutMs, 10_000),
    maxAttempts: numberOr(config.maxAttempts, 3),
    retryBaseDelayMs: numberOr(config.retryBaseDelayMs, 200),
    pollIntervalMs: numberOr(config.pollIntervalMs, 5_000),
  };
}

const STATE_FILTER: Readonly<Record<string, RawState>> = {
  triage: "open",
  todo: "open",
  ready: "open",
  running: "in_progress",
  review: "in_progress",
  waiting: "blocked",
  done: "closed",
  failed: "closed",
  cancelled: "closed",
};
const PRIO_FILTER: Readonly<Record<string, number>> = { P0: 1, P1: 2, P2: 3, P3: 4, P4: 5 };
const SORT_FILTER: Readonly<Record<NonNullable<ListTasksParams["sort"]>, string>> = {
  "-updatedAt": "-updated_at",
  updatedAt: "updated_at",
  priority: "prio",
  dueAt: "due",
};

/**
 * Reference adapter (tasks) for the fictional ExampleTasks REST API. Shows every part an adapter needs: config + secret
 * handling, resilient HTTP, id mapping, contract-validated mapping, idempotency forwarding, event polling and health.
 */
export class ExampleTasksAdapter implements TaskPort, JarvisAdapter {
  readonly manifest = manifest;

  private context: AdapterContext | undefined;
  private http: HttpClient | undefined;
  private mapping: TaskMapping | undefined;
  private settings: AdapterSettings | undefined;
  private abort = new AbortController();
  private lastSeq = 0;
  private inFlightPoll: Promise<number> | undefined;
  private cancelPollTimer: (() => void) | undefined;
  private stopped = true;

  async initialize(context: AdapterContext): Promise<void> {
    const settings = readSettings(context.config);
    this.context = context;
    this.settings = settings;
    this.abort = new AbortController();
    this.stopped = false;
    this.lastSeq = 0;
    this.mapping = createTaskMapping(() => context.clock.now());

    const redact = createRedactor(() => [context.getSecret("apiToken")]);
    this.http = createHttpClient({
      baseUrl: settings.baseUrl,
      timeoutMs: settings.timeoutMs,
      retry: {
        maxAttempts: settings.maxAttempts,
        baseDelayMs: settings.retryBaseDelayMs,
        maxDelayMs: Math.max(settings.retryBaseDelayMs, 5_000),
        factor: 2,
        jitter: "full",
      },
      // The registry owns the circuit breaker; a second one in the adapter would hide failures from health.
      circuitBreaker: false,
      clock: context.clock,
      logger: context.logger,
      redact,
      signal: this.abort.signal,
      headers: () => {
        const token = context.getSecret("apiToken");
        if (!token) {
          throw new AdapterError({
            code: "UNAUTHENTICATED",
            message: "API-Token ist nicht konfiguriert.",
            retryable: false,
          });
        }
        return { authorization: `Bearer ${token}` };
      },
    });
    context.signal.addEventListener("abort", () => this.abort.abort(context.signal.reason), { once: true });
    if (settings.pollIntervalMs > 0) this.schedulePoll();
  }

  async getCapabilities(): Promise<CapabilitySet> {
    return { capabilities: [...manifest.capabilities] };
  }

  async healthCheck(): Promise<AdapterHealthReport> {
    if (this.stopped || !this.http || !this.context) {
      return {
        status: "offline",
        latencyMs: null,
        message: "Adapter ist nicht aktiv",
        errorCode: "ADAPTER_UNAVAILABLE",
      };
    }
    const clock = this.context.clock;
    const started = clock.now();
    try {
      await this.http.request({
        method: "GET",
        path: "/items",
        query: { limit: 1 },
        operation: "healthCheck",
        retry: false,
      });
      return { status: "online", latencyMs: Math.max(0, Math.round(clock.now() - started)) };
    } catch (raw) {
      const error = normalizeError(raw, { operation: "healthCheck" });
      const message =
        error.code === "UNAUTHENTICATED"
          ? "Authentifizierung fehlgeschlagen (API-Token prüfen)"
          : error.code === "FORBIDDEN"
            ? "Zugriff verweigert"
            : error.code === "ADAPTER_TIMEOUT"
              ? "Zeitüberschreitung beim Zugriff auf ExampleTasks"
              : "ExampleTasks ist nicht erreichbar";
      return {
        status: error.code === "RATE_LIMITED" ? "degraded" : "offline",
        latencyMs: null,
        message,
        errorCode: error.code,
      };
    }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.cancelPollTimer?.();
    this.cancelPollTimer = undefined;
    this.abort.abort(new DOMException("Adapter shutdown", "AbortError"));
    await this.inFlightPoll?.catch(() => undefined);
    this.context = undefined;
    this.http = undefined;
  }

  // ---- TaskPort ------------------------------------------------------------------------------------------------

  async listTasks(params: ListTasksParams, call: CallContext): Promise<Page<Task>> {
    const { http, mapping, context } = this.ready();
    const states = [
      ...new Set(
        (params.status ?? [])
          .map((status) => STATE_FILTER[status])
          .filter((s): s is RawState => s !== undefined),
      ),
    ];
    const response = await http.request<RawItemPage>({
      method: "GET",
      path: "/items",
      query: {
        page_token: params.cursor,
        limit: params.limit,
        state: states,
        prio: (params.priority ?? [])
          .map((priority) => PRIO_FILTER[priority])
          .filter((p): p is number => p !== undefined),
        owner_bot: params.agentId ? mapping.ids.agent.require(params.agentId) : undefined,
        tag: params.label,
        q: params.q,
        updated_since: params.updatedSince,
        due_before: params.dueBefore,
        sort: params.sort ? SORT_FILTER[params.sort] : undefined,
      },
      correlationId: call.correlationId,
      operation: "listTasks",
      ...(call.signal ? { signal: call.signal } : {}),
    });
    const mapContext = createMapContext({
      adapterId: manifest.id,
      system: PROVIDER_SYSTEM,
      clock: context.clock,
    });
    this.assertShape(Array.isArray(response.body?.items), "listTasks");
    let items = response.body.items.map((raw) => mapping.mapItem(raw, mapContext));
    // The provider cannot tell "closed because done" from "closed because cancelled"; refine after mapping.
    if (params.status && params.status.length > 0)
      items = items.filter((task) => params.status?.includes(task.status));
    const nextToken = response.body.next_page_token ?? null;
    return {
      items,
      pageInfo: { nextCursor: nextToken, hasNextPage: nextToken !== null },
      freshness: { state: "fresh", asOf: mapContext.syncedAt },
    };
  }

  async getTask(params: IdParam, call: CallContext): Promise<Single<Task>> {
    const { http, mapping, context } = this.ready();
    const response = await http.request<RawItem>({
      method: "GET",
      path: `/items/${encodeURIComponent(mapping.ids.task.require(params.id))}`,
      correlationId: call.correlationId,
      operation: "getTask",
      ...(call.signal ? { signal: call.signal } : {}),
    });
    return this.single(response.body, context, "getTask");
  }

  async createTask(params: { body: TaskCreateRequest }, call: MutationContext): Promise<Single<Task>> {
    const { http, mapping, context } = this.ready();
    const response = await http.request<RawItem>({
      method: "POST",
      path: "/items",
      body: mapping.toCreateWrite(params.body),
      ...(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {}),
      correlationId: call.correlationId,
      operation: "createTask",
      ...(call.signal ? { signal: call.signal } : {}),
    });
    return this.single(response.body, context, "createTask");
  }

  async updateTask(
    params: IdParam & { body: TaskUpdateRequest },
    call: MutationContext,
  ): Promise<Single<Task>> {
    const { http, mapping, context } = this.ready();
    const response = await http.request<RawItem>({
      method: "PATCH",
      path: `/items/${encodeURIComponent(mapping.ids.task.require(params.id))}`,
      body: mapping.toUpdateWrite(params.body),
      ...(call.ifMatchVersion !== undefined ? { ifMatch: call.ifMatchVersion } : {}),
      ...(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {}),
      correlationId: call.correlationId,
      operation: "updateTask",
      ...(call.signal ? { signal: call.signal } : {}),
    });
    return this.single(response.body, context, "updateTask");
  }

  async cancelTask(
    params: IdParam & { body?: TaskActionRequest },
    call: MutationContext,
  ): Promise<Single<Task>> {
    const { http, mapping, context } = this.ready();
    const response = await http.request<RawItem>({
      method: "POST",
      path: `/items/${encodeURIComponent(mapping.ids.task.require(params.id))}/cancel`,
      body: { reason: params.body?.reason ?? null },
      ...(call.ifMatchVersion !== undefined ? { ifMatch: call.ifMatchVersion } : {}),
      ...(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {}),
      correlationId: call.correlationId,
      operation: "cancelTask",
      ...(call.signal ? { signal: call.signal } : {}),
    });
    return this.single(response.body, context, "cancelTask");
  }

  // ---- events ----------------------------------------------------------------------------------------------------

  /**
   * One poll cycle of `GET /events?after=<seq>`. The sequence cursor advances only after all events of the batch were
   * handed to `emit`, so a dropped connection loses nothing and a repeated poll duplicates nothing.
   */
  pollEvents(): Promise<number> {
    this.inFlightPoll ??= this.pollOnce().finally(() => {
      this.inFlightPoll = undefined;
    });
    return this.inFlightPoll;
  }

  private async pollOnce(): Promise<number> {
    const { http, mapping, context } = this.ready();
    const response = await http.request<RawEventBatch>({
      method: "GET",
      path: "/events",
      query: { after: this.lastSeq },
      correlationId: context.correlationId(),
      operation: "pollEvents",
    });
    this.assertShape(Array.isArray(response.body?.events), "pollEvents");
    const mapContext = createMapContext({
      adapterId: manifest.id,
      system: PROVIDER_SYSTEM,
      clock: context.clock,
    });
    let emitted = 0;
    for (const raw of response.body.events) {
      let events;
      try {
        events = mapping.mapEvent(raw, mapContext);
      } catch (error) {
        // A single unmappable event must not stall the stream forever; it is reported and skipped.
        context.logger.error("Provider-Event nicht abbildbar, übersprungen", {
          seq: raw.seq,
          kind: raw.kind,
          code: normalizeError(error).code,
        });
        continue;
      }
      for (const event of events) {
        context.emit({ ...event, correlationId: context.correlationId() });
        emitted += 1;
      }
    }
    this.lastSeq = Math.max(this.lastSeq, response.body.last_seq);
    return emitted;
  }

  private schedulePoll(): void {
    const context = this.context;
    const settings = this.settings;
    if (!context || !settings || this.stopped) return;
    this.cancelPollTimer = context.clock.setTimeout(() => {
      if (this.stopped) return;
      this.pollEvents()
        .catch((error: unknown) =>
          context.logger.warn("Event-Polling fehlgeschlagen", { code: normalizeError(error).code }),
        )
        .finally(() => this.schedulePoll());
    }, settings.pollIntervalMs);
  }

  // ---- helpers -----------------------------------------------------------------------------------------------------

  private ready(): { http: HttpClient; mapping: TaskMapping; context: AdapterContext } {
    if (this.stopped || !this.http || !this.mapping || !this.context) {
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Der Adapter ist nicht aktiv.",
        retryable: false,
      });
    }
    return { http: this.http, mapping: this.mapping, context: this.context };
  }

  private single(raw: RawItem, context: AdapterContext, operation: string): Single<Task> {
    const { mapping } = this.ready();
    this.assertShape(typeof raw === "object" && raw !== null, operation);
    const mapContext = createMapContext({
      adapterId: manifest.id,
      system: PROVIDER_SYSTEM,
      clock: context.clock,
    });
    return {
      data: mapping.mapItem(raw, mapContext),
      freshness: { state: "fresh", asOf: toIso(context.clock) },
    };
  }

  private assertShape(condition: boolean, operation: string): asserts condition {
    if (!condition) {
      throw new AdapterError({
        code: "VALIDATION_FAILED",
        message: `${operation}: unerwartete Antwortstruktur des Fremdsystems.`,
        retryable: false,
      });
    }
  }
}
