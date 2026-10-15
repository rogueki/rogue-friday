import { PORT_CATEGORIES, type PortCategory } from "@friday/adapter-core";
import { runConformanceSuite, type FakeUpstream } from "@friday/adapter-testkit";
import { MockWorld, type WorldState } from "@friday/mock-data";
import { MockAdapterBase, createMockAdapterFactory, httpTransport, mockConfigSchema, mockSecretFields } from "../src";

/**
 * Conformance for every mock port wrapper (docs/ADAPTER_CONFORMANCE.md "Grenzen"). The world supplies the data; the
 * fake upstream sits behind `httpTransport()` and injects the transport faults (timeouts, 5xx, 4xx, drops, offline,
 * foreign garbage). Fixtures resize the world's collection so cursor walks see exactly the requested item count.
 */

interface CategoryFixture {
  list: string;
  get?: string;
  /** Collection behind the list method. */
  collection(state: WorldState): unknown[];
  assign(state: WorldState, items: unknown[]): void;
  mutation?: { method: string; params: Record<string, unknown> };
}

const FIXTURES: Record<PortCategory, CategoryFixture> = {
  tasks: {
    list: "listTasks",
    get: "getTask",
    collection: (s) => s.tasks,
    assign: (s, v) => void (s.tasks = v as typeof s.tasks),
    mutation: { method: "createTask", params: { body: { title: "Reisekosten abrechnen", priority: "P1" } } },
  },
  activity: {
    list: "listActivity",
    get: "getActivityEvent",
    collection: (s) => s.activity,
    assign: (s, v) => void (s.activity = v as typeof s.activity),
  },
  memory: {
    list: "listMemory",
    get: "getMemory",
    collection: (s) => s.memory,
    assign: (s, v) => void (s.memory = v as typeof s.memory),
    mutation: { method: "createMemory", params: { body: { type: "fact", content: "Dienstreise im November geplant" } } },
  },
  agents: {
    list: "listAgents",
    get: "getAgent",
    collection: (s) => s.agents,
    assign: (s, v) => void (s.agents = v as typeof s.agents),
  },
  approvals: {
    list: "listApprovals",
    get: "getApproval",
    collection: (s) => s.approvals,
    assign: (s, v) => void (s.approvals = v as typeof s.approvals),
  },
  communication: {
    list: "listThreads",
    get: "getThread",
    collection: (s) => s.threads,
    assign: (s, v) => void (s.threads = v as typeof s.threads),
  },
  calendar: {
    list: "listCalendarEvents",
    get: "getCalendarEvent",
    collection: (s) => s.calendarEvents,
    assign: (s, v) => void (s.calendarEvents = v as typeof s.calendarEvents),
  },
  automations: {
    list: "listAutomations",
    get: "getAutomation",
    collection: (s) => s.automations,
    assign: (s, v) => void (s.automations = v as typeof s.automations),
  },
  research: {
    list: "listResearchProjects",
    get: "getResearchProject",
    collection: (s) => s.researchProjects,
    assign: (s, v) => void (s.researchProjects = v as typeof s.researchProjects),
  },
  files: {
    list: "listFiles",
    get: "getFile",
    collection: (s) => s.files,
    assign: (s, v) => void (s.files = v as typeof s.files),
  },
  voice: {
    list: "listVoiceDevices",
    collection: (s) => s.voice.devices,
    assign: (s, v) => void (s.voice.devices = v as typeof s.voice.devices),
  },
  notifications: {
    list: "listNotifications",
    collection: (s) => s.notifications,
    assign: (s, v) => void (s.notifications = v as typeof s.notifications),
  },
  system: {
    list: "listServices",
    collection: (s) => s.system.services,
    assign: (s, v) => void (s.system.services = v as typeof s.system.services),
  },
  audit: {
    list: "listAuditEvents",
    get: "getAuditEvent",
    collection: (s) => s.audit,
    assign: (s, v) => void (s.audit = v as typeof s.audit),
  },
  commands: {
    list: "listCommandHistory",
    collection: (s) => s.commandHistory,
    assign: (s, v) => void (s.commandHistory = v as typeof s.commandHistory),
  },
};

interface Harness {
  world: MockWorld;
  /** Number of distinct mutations the upstream executed (replays of one idempotency key count once). */
  executed: Set<string>;
  anonymous: number;
}

const harnesses = new WeakMap<object, Harness>();

function resize(world: MockWorld, fixture: CategoryFixture, count: number): void {
  const current = fixture.collection(world.state) as Array<{ id: string }>;
  if (current.length === 0) throw new Error("Welt liefert keine Vorlage für die Kollektion");
  const next: Array<{ id: string }> = current.slice(0, count);
  for (let index = 0; next.length < count; index += 1) {
    const template = current[index % current.length] as { id: string };
    next.push({ ...structuredClone(template), id: world.id(template.id.split("_")[0] ?? "x") });
  }
  fixture.assign(world.state, next);
}

function install(upstream: FakeUpstream, harness: Harness): void {
  upstream.route("GET", "/mock/:method", { body: { ok: true } });
  upstream.route("GET", "/mock/health", { body: { ok: true } });
  upstream.route("POST", "/mock/:method", (request) => {
    const key = request.headers["idempotency-key"];
    harness.executed.add(key ?? `anonymous-${(harness.anonymous += 1)}`);
    return { body: { ok: true } };
  });
}

for (const category of PORT_CATEGORIES) {
  const fixture = FIXTURES[category];
  runConformanceSuite({
    name: `adapter-mock (${category})`,
    category,
    createAdapter: ({ upstream, timing }) => {
      const world = new MockWorld({ seed: 7 });
      harnesses.set(upstream, { world, executed: new Set(), anonymous: 0 });
      const factory = createMockAdapterFactory(category, {
        world,
        transport: httpTransport({ secretFields: mockSecretFields(category) }),
      });
      return {
        adapter: factory.create() as MockAdapterBase,
        configSchema: mockConfigSchema(category),
        config: {
          baseUrl: upstream.url,
          timeoutMs: timing.timeoutMs,
          maxAttempts: timing.maxAttempts,
          retryBaseDelayMs: timing.retryBaseDelayMs,
        },
      };
    },
    fixtures: {
      seed: (upstream, { count }) => {
        const harness = harnesses.get(upstream);
        if (!harness) throw new Error("Harness fehlt");
        resize(harness.world, fixture, count);
        install(upstream, harness);
      },
      list: { method: fixture.list, route: { method: "GET", path: `/mock/${fixture.list}` } },
      healthRoute: { method: "GET", path: "/mock/health" },
      ...(fixture.get
        ? {
            get: {
              method: fixture.get,
              paramsFor: (item: { id: string }) => ({ id: item.id }),
              route: { method: "GET", path: `/mock/${fixture.get}` },
            },
          }
        : {}),
      invalidListBody: () => ({
        items: [{ item_id: "itm_bad", title: "", state: "weird", prio: 99, created_at: "gestern" }],
        next_page_token: null,
      }),
      providerFields: ["item_id", "owner_bot", "next_page_token", "created_at", "pct", "prio", "rev"],
      ...(fixture.mutation
        ? {
            mutation: {
              method: fixture.mutation.method,
              params: fixture.mutation.params,
              route: { method: "POST", path: `/mock/${fixture.mutation.method}` },
              sideEffects: (upstream: FakeUpstream) => harnesses.get(upstream)?.executed.size ?? 0,
            },
          }
        : {}),
    },
  });
}
