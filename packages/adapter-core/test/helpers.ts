import type { AdapterManifest, Task } from "@friday/sdk";
import { CONTRACT_VERSION } from "@friday/sdk";
import { createId } from "../src/ids";
import type {
  AdapterContext,
  AdapterFactory,
  AdapterHealthReport,
  CapabilitySet,
  FridayAdapter,
  PortAdapter,
} from "../src";
import type { CallContext, MutationContext, Page, Single } from "../src";

export const CALL: CallContext = { correlationId: "corr_00000000000000000000000001" };

export function makeTask(index: number, overrides: Partial<Task> = {}): Task {
  const at = "2026-10-13T20:00:00.000Z";
  return {
    id: createId("task", `test-${index}`),
    version: 1,
    createdAt: at,
    updatedAt: at,
    source: { adapterId: "test-tasks", system: "test", externalId: `ext-${index}`, lastSyncedAt: at },
    title: `Aufgabe ${index}`,
    status: "todo",
    priority: "P2",
    agentId: null,
    model: null,
    progress: { mode: "none", value: null },
    startedAt: null,
    runtimeMs: null,
    dueAt: null,
    estimatedCompletionAt: null,
    blockers: [],
    lastActivityAt: null,
    artifactCount: 0,
    artifacts: [],
    steps: [],
    toolCalls: [],
    sourceRefs: [],
    approvalIds: [],
    errors: [],
    createdBy: { type: "system", id: "test" },
    ...overrides,
  };
}

export const FRESH = { state: "fresh", asOf: "2026-10-13T20:00:00.000Z" } as const;

export const TEST_CONFIG_SCHEMA = {
  $id: "urn:friday:test:config",
  type: "object",
  properties: {
    baseUrl: { type: "string", minLength: 1 },
    timeoutMs: { type: "integer", minimum: 1, default: 1000 },
    apiToken: { type: "string", writeOnly: true },
  },
  required: ["baseUrl", "apiToken"],
  additionalProperties: false,
} as const;

export function makeManifest(overrides: Partial<AdapterManifest> = {}): AdapterManifest {
  return {
    id: "test-tasks",
    name: "Test Tasks",
    adapterVersion: "1.0.0",
    contractVersion: CONTRACT_VERSION,
    apiVersion: "v1",
    category: "tasks",
    capabilities: ["tasks.read", "tasks.create", "tasks.stream"],
    configSchemaRef: "urn:friday:test:config",
    secretFields: ["apiToken"],
    ...overrides,
  };
}

export interface TestAdapterControl {
  context: AdapterContext | undefined;
  health: AdapterHealthReport;
  initializeError: Error | undefined;
  listImpl: (callIndex: number) => Promise<Page<Task>> | Page<Task>;
  listCalls: number;
  shutdownCalls: number;
  capabilities: string[];
  createCalls: Array<{ idempotencyKey?: string }>;
}

export function createTestAdapter(manifest: AdapterManifest = makeManifest()): {
  adapter: PortAdapter<"tasks">;
  control: TestAdapterControl;
} {
  const control: TestAdapterControl = {
    context: undefined,
    health: { status: "online", latencyMs: 5 },
    initializeError: undefined,
    listImpl: () => ({
      items: [makeTask(1)],
      pageInfo: { nextCursor: null, hasNextPage: false },
      freshness: FRESH,
    }),
    listCalls: 0,
    shutdownCalls: 0,
    capabilities: [...manifest.capabilities],
    createCalls: [],
  };
  const base: FridayAdapter = {
    manifest,
    async initialize(context) {
      if (control.initializeError) throw control.initializeError;
      control.context = context;
    },
    async healthCheck() {
      return control.health;
    },
    async getCapabilities(): Promise<CapabilitySet> {
      return { capabilities: [...control.capabilities] };
    },
    async shutdown() {
      control.shutdownCalls += 1;
    },
  };
  const adapter = Object.assign(base, {
    async listTasks(): Promise<Page<Task>> {
      control.listCalls += 1;
      return control.listImpl(control.listCalls);
    },
    async getTask(): Promise<Single<Task>> {
      return { data: makeTask(1), freshness: FRESH };
    },
    async createTask(params: { body: { title: string } }, call: MutationContext): Promise<Single<Task>> {
      control.createCalls.push(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {});
      return { data: makeTask(2, { title: params.body.title }), freshness: FRESH };
    },
  });
  return { adapter: adapter as unknown as PortAdapter<"tasks">, control };
}

export function createTestFactory(
  providerId = "test-tasks-provider",
  manifest?: AdapterManifest,
): { factory: AdapterFactory; control: TestAdapterControl; created: () => number } {
  let current = createTestAdapter(manifest);
  let created = 0;
  const controlProxy = new Proxy({} as TestAdapterControl, {
    get: (_, key) => current.control[key as keyof TestAdapterControl],
    set: (_, key, value) => {
      (current.control as unknown as Record<string | symbol, unknown>)[key] = value;
      return true;
    },
  });
  const factory: AdapterFactory = {
    providerId,
    category: "tasks",
    configSchema: TEST_CONFIG_SCHEMA,
    create() {
      created += 1;
      const settings = current.control;
      current = createTestAdapter(manifest);
      // Keep programmed behaviour across restarts.
      current.control.health = settings.health;
      current.control.listImpl = settings.listImpl;
      current.control.capabilities = settings.capabilities;
      current.control.initializeError = settings.initializeError;
      return current.adapter;
    },
  };
  // The first instance is created lazily by `create`; prime with the initial control so tests can configure beforehand.
  return { factory, control: controlProxy, created: () => created };
}
