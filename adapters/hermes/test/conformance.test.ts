import { runConformanceSuite, type ConformanceFixtures, type FakeUpstream } from "@jarvis/adapter-testkit";
import type { JarvisAdapter } from "@jarvis/adapter-core";
import {
  HermesActivityAdapter,
  HermesAgentsAdapter,
  HermesTasksAdapter,
  configSchemaFor,
  type HermesAdapterOptions,
  type HermesCategory,
} from "../src";
import { installHermes } from "./fake/install";
import { HttpPollKanbanTransport } from "./fake/http-transport";
import type { HermesState } from "./fake/state";

const states = new WeakMap<object, HermesState>();
const stateOf = (upstream: FakeUpstream): HermesState | undefined => states.get(upstream);

const EVENTS_ROUTE = { method: "GET", path: "/api/plugins/kanban/events" };

const create: Record<HermesCategory, (options: HermesAdapterOptions) => JarvisAdapter> = {
  tasks: (options) => new HermesTasksAdapter(options),
  activity: (options) => new HermesActivityAdapter(options),
  agents: (options) => new HermesAgentsAdapter(options),
};

const fixtures: Record<HermesCategory, ConformanceFixtures> = {
  tasks: {
    seed: (upstream, { count }) => {
      states.set(
        upstream,
        installHermes(upstream, (state) => state.seedTasks(count)),
      );
    },
    list: { method: "listTasks", route: { method: "GET", path: "/api/plugins/kanban/board" } },
    healthRoute: { method: "GET", path: "/api/health" },
    get: {
      method: "getTask",
      paramsFor: (item) => ({ id: item.id }),
      route: { method: "GET", path: "/api/plugins/kanban/tasks/:id" },
    },
    invalidListBody: () => ({
      columns: [
        {
          name: "todo",
          tasks: [{ id: "t_bad", title: "", status: "weird", priority: "hoch", created_at: "gestern" }],
        },
      ],
      assignees: [],
      latest_event_id: 0,
    }),
    providerFields: [
      "created_by",
      "created_at",
      "completed_at",
      "started_at",
      "assignee",
      "block_kind",
      "last_failure_error",
      "model_override",
      "current_run_started_at",
      "idempotency_key",
      "consecutive_failures",
      "workspace_kind",
      "link_counts",
      "comment_count",
      "latest_summary",
      "tenant",
      "body",
    ],
    mutation: {
      method: "createTask",
      params: { body: { title: "Reisekosten abrechnen", priority: "P1" } },
      route: { method: "POST", path: "/api/plugins/kanban/tasks" },
      sideEffects: (upstream) => stateOf(upstream)?.createdCount ?? 0,
    },
    events: {
      route: EVENTS_ROUTE,
      publish: (upstream, count) => stateOf(upstream)?.publishTaskLifecycle(count),
      expectedTypes: [
        "jarvis.task.created",
        "jarvis.task.updated",
        "jarvis.task.updated",
        "jarvis.task.completed",
      ],
    },
  },
  activity: {
    seed: (upstream, { count }) => {
      states.set(
        upstream,
        installHermes(upstream, (state) => state.seedSessions(count)),
      );
    },
    list: { method: "listActivity", route: { method: "GET", path: "/api/sessions" } },
    healthRoute: { method: "GET", path: "/health" },
    get: {
      method: "getActivityEvent",
      paramsFor: (item) => ({ id: item.id }),
      route: { method: "GET", path: "/api/sessions/:id/messages" },
    },
    invalidListBody: () => ({
      object: "list",
      data: [{ id: "", model: 5, last_active: "jetzt" }],
      has_more: false,
    }),
    providerFields: [
      "last_active",
      "message_count",
      "tool_call_count",
      "started_at",
      "session_id",
      "parent_session_id",
      "input_tokens",
      "tool_calls",
      "finish_reason",
    ],
    events: {
      route: { method: "GET", path: "/api/sessions" },
      publish: (upstream, count) => stateOf(upstream)?.publishSessionMessages(count),
      expectedTypes: ["jarvis.activity.appended", "jarvis.activity.appended", "jarvis.activity.appended"],
    },
  },
  agents: {
    seed: (upstream, { count }) => {
      states.set(
        upstream,
        installHermes(upstream, (state) => {
          state.profiles.length = 0;
          for (let index = 0; index < count; index += 1) {
            state.profiles.push({
              name: `agent-${String(index + 1).padStart(2, "0")}`,
              is_default: index === 0,
              model: "k3",
              provider: "kimi-coding",
              description: index === 0 ? "" : `Spezialist ${index + 1}`,
              skill_count: 10 + index,
            });
          }
        }),
      );
    },
    list: { method: "listAgents", route: { method: "GET", path: "/api/profiles" } },
    healthRoute: { method: "GET", path: "/api/health" },
    get: {
      method: "getAgent",
      paramsFor: (item) => ({ id: item.id }),
      route: { method: "GET", path: "/api/profiles" },
    },
    invalidListBody: () => ({ profiles: [{ name: "", model: 5 }] }),
    providerFields: [
      "is_default",
      "display_name",
      "skill_count",
      "has_env",
      "gateway_running",
      "description_auto",
      "task_assignee",
      "last_heartbeat_at",
    ],
    events: {
      route: EVENTS_ROUTE,
      publish: (upstream, count) => stateOf(upstream)?.publishAgentEvents(count),
      expectedTypes: [
        "jarvis.agent.status_changed",
        "jarvis.agent.status_changed",
        "jarvis.agent.status_changed",
      ],
    },
  },
};

for (const category of ["tasks", "activity", "agents"] as const) {
  runConformanceSuite({
    name: `hermes-${category} (fake Hermes: API server + dashboard)`,
    category,
    createAdapter: ({ upstream, timing }) => ({
      // The testkit upstream is HTTP-only, so the event stream is read through its HTTP twin (see fake/http-transport).
      adapter: create[category]({ eventTransport: new HttpPollKanbanTransport() }),
      configSchema: configSchemaFor(category),
      config: {
        apiBaseUrl: upstream.url,
        dashboardBaseUrl: upstream.url,
        boards: ["default"],
        timeoutMs: timing.timeoutMs,
        maxAttempts: timing.maxAttempts,
        retryBaseDelayMs: timing.retryBaseDelayMs,
        pollIntervalMs: timing.pollIntervalMs,
        // Seeded history has ids below these cursors; only published events are "new" (see state.ts).
        eventsStartCursor: category === "activity" ? 999 : 0,
        eventsDrainMs: 50,
      },
    }),
    fixtures: fixtures[category],
    faults: { slowDelayMs: 1000 },
  });
}
