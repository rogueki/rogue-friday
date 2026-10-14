/**
 * Adapter template: a read-only `tasks` adapter for a fictional REST service ("Things API").
 * Copy this folder to `adapters/<name>/`, then follow docs/ADAPTER_SDK.md ("Neue Anbindung erstellen").
 * The numbered markers below match the ten steps of PLAN §56.1.
 */
import type { AdapterManifest, Task } from "@jarvis/sdk";
import { CONTRACT_VERSION } from "@jarvis/sdk";
import {
  AdapterError,
  createHttpClient,
  createIdCodec,
  createMapContext,
  createRedactor,
  defineMapper,
  toIso,
  type AdapterContext,
  type AdapterFactory,
  type AdapterHealthReport,
  type CallContext,
  type CapabilitySet,
  type HttpClient,
  type IdParam,
  type JarvisAdapter,
  type ListTasksParams,
  type Page,
  type Single,
  type TaskPort,
} from "@jarvis/adapter-core";

// Step 2: manifest ----------------------------------------------------------------------------------------------------
const ADAPTER_ID = "things-http";
const CONFIG_SCHEMA_ID = "urn:jarvis:adapter:things-http:config";

export const manifest: AdapterManifest = {
  id: ADAPTER_ID,
  name: "Things (HTTP)",
  adapterVersion: "0.1.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "tasks",
  // Step 5: only declare what is implemented. The conformance suite checks declaration <-> methods in both directions.
  capabilities: ["tasks.read"],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: ["apiToken"],
};

// Step 3: config schema -----------------------------------------------------------------------------------------------
export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "Things HTTP adapter",
  type: "object",
  properties: {
    baseUrl: { type: "string", format: "uri" },
    apiToken: { type: "string", minLength: 8, writeOnly: true },
    timeoutMs: { type: "integer", minimum: 20, default: 10000 },
    maxAttempts: { type: "integer", minimum: 1, maximum: 5, default: 3 },
    retryBaseDelayMs: { type: "integer", minimum: 1, default: 200 },
  },
  required: ["baseUrl", "apiToken"],
  additionalProperties: false,
} as const;

// Step 6: map foreign data to the canonical model ----------------------------------------------------------------------
interface RawThing {
  thing_id: string;
  label: string;
  phase: "new" | "doing" | "finished";
  changed: string;
}
interface RawThingPage {
  data: RawThing[];
  next: string | null;
}

const ids = createIdCodec("task");

const thingMapper = defineMapper<RawThing, Task>({
  name: "Thing -> Task",
  schema: "Task",
  toCanonical: (raw, context) => ({
    id: ids.encode(raw.thing_id),
    version: 1,
    createdAt: raw.changed,
    updatedAt: raw.changed,
    source: context.source(raw.thing_id),
    title: raw.label,
    status: raw.phase === "new" ? "todo" : raw.phase === "doing" ? "running" : "done",
    priority: "P3",
    agentId: null,
    model: null,
    progress: { mode: "none", value: null },
    startedAt: null,
    runtimeMs: null,
    dueAt: null,
    estimatedCompletionAt: null,
    blockers: [],
    lastActivityAt: raw.changed,
    artifactCount: 0,
    artifacts: [],
    steps: [],
    toolCalls: [],
    sourceRefs: [],
    approvalIds: [],
    errors: [],
    createdBy: { type: "adapter", id: context.adapterId },
  }),
});

// The adapter ---------------------------------------------------------------------------------------------------------
export class ThingsAdapter implements JarvisAdapter, TaskPort {
  readonly manifest = manifest;
  private context: AdapterContext | undefined;
  private http: HttpClient | undefined;
  private abort = new AbortController();

  async initialize(context: AdapterContext): Promise<void> {
    this.context = context;
    this.abort = new AbortController();
    context.signal.addEventListener("abort", () => this.abort.abort(context.signal.reason), { once: true });
    const config = context.config;
    this.http = createHttpClient({
      baseUrl: String(config.baseUrl),
      timeoutMs: typeof config.timeoutMs === "number" ? config.timeoutMs : 10_000,
      retry: {
        maxAttempts: typeof config.maxAttempts === "number" ? config.maxAttempts : 3,
        baseDelayMs: typeof config.retryBaseDelayMs === "number" ? config.retryBaseDelayMs : 200,
      },
      circuitBreaker: false, // the registry owns the breaker
      clock: context.clock,
      logger: context.logger,
      redact: createRedactor(() => [context.getSecret("apiToken")]),
      signal: this.abort.signal,
      headers: () => ({ authorization: `Bearer ${context.getSecret("apiToken") ?? ""}` }),
    });
  }

  // Step 4: health check. Never throws; an unreachable upstream is a report, not an exception.
  async healthCheck(): Promise<AdapterHealthReport> {
    if (!this.http || !this.context)
      return { status: "offline", latencyMs: null, message: "Adapter ist nicht aktiv" };
    const started = this.context.clock.now();
    try {
      await this.http.request({
        method: "GET",
        path: "/things",
        query: { limit: 1 },
        retry: false,
        operation: "healthCheck",
      });
      return { status: "online", latencyMs: Math.round(this.context.clock.now() - started) };
    } catch (error) {
      return {
        status: "offline",
        latencyMs: null,
        message: "Things ist nicht erreichbar",
        errorCode: error instanceof AdapterError ? error.code : "INTERNAL",
      };
    }
  }

  // Step 5: capabilities
  async getCapabilities(): Promise<CapabilitySet> {
    return { capabilities: [...manifest.capabilities] };
  }

  async shutdown(): Promise<void> {
    this.abort.abort(new DOMException("Adapter shutdown", "AbortError"));
    this.http = undefined;
    this.context = undefined;
  }

  // Step 6: one mapped port method per operation of the declared capabilities
  async listTasks(params: ListTasksParams, call: CallContext): Promise<Page<Task>> {
    const { http, context } = this.ready();
    const response = await http.request<RawThingPage>({
      method: "GET",
      path: "/things",
      query: { cursor: params.cursor, limit: params.limit },
      correlationId: call.correlationId,
      operation: "listTasks",
    });
    const mapContext = createMapContext({ adapterId: ADAPTER_ID, system: "things", clock: context.clock });
    return {
      items: thingMapper.mapMany(response.body.data, mapContext),
      pageInfo: { nextCursor: response.body.next, hasNextPage: response.body.next !== null },
      freshness: { state: "fresh", asOf: mapContext.syncedAt },
    };
  }

  async getTask(params: IdParam, call: CallContext): Promise<Single<Task>> {
    const { http, context } = this.ready();
    const response = await http.request<RawThing>({
      method: "GET",
      path: `/things/${encodeURIComponent(ids.require(params.id))}`,
      correlationId: call.correlationId,
      operation: "getTask",
    });
    const mapContext = createMapContext({ adapterId: ADAPTER_ID, system: "things", clock: context.clock });
    return {
      data: thingMapper.map(response.body, mapContext),
      freshness: { state: "fresh", asOf: toIso(context.clock) },
    };
  }

  private ready(): { http: HttpClient; context: AdapterContext } {
    if (!this.http || !this.context) {
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Der Adapter ist nicht aktiv.",
        retryable: false,
      });
    }
    return { http: this.http, context: this.context };
  }
}

// Step 9: the registry creates adapters through this factory (and only for allowlisted provider ids).
export const thingsFactory: AdapterFactory<"tasks"> = {
  providerId: ADAPTER_ID,
  category: "tasks",
  configSchema,
  create: () => new ThingsAdapter(),
};
