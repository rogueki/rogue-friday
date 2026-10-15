import { runConformanceSuite } from "@friday/adapter-testkit";
import { ExampleTasksAdapter, configSchema } from "../src";
import { installExampleTasks, type ExampleTasksState } from "./fake-example-tasks";

const states = new WeakMap<object, ExampleTasksState>();

runConformanceSuite({
  name: "example-http (ExampleTasks)",
  category: "tasks",
  createAdapter: ({ upstream, timing }) => ({
    adapter: new ExampleTasksAdapter(),
    configSchema,
    config: {
      baseUrl: upstream.url,
      timeoutMs: timing.timeoutMs,
      maxAttempts: timing.maxAttempts,
      retryBaseDelayMs: timing.retryBaseDelayMs,
      pollIntervalMs: timing.pollIntervalMs,
    },
  }),
  fixtures: {
    seed: (upstream, options) => {
      states.set(upstream, installExampleTasks(upstream, options));
    },
    list: { method: "listTasks", route: { method: "GET", path: "/items" } },
    get: {
      method: "getTask",
      paramsFor: (item) => ({ id: item.id }),
      route: { method: "GET", path: "/items/:id" },
    },
    invalidListBody: () => ({
      items: [
        {
          item_id: "itm_bad",
          title: "",
          state: "weird",
          prio: 99,
          owner_bot: null,
          pct: null,
          rev: 1,
          created_at: "gestern",
          updated_at: "heute",
        },
      ],
      next_page_token: null,
    }),
    providerFields: [
      "item_id",
      "owner_bot",
      "pct",
      "prio",
      "rev",
      "created_at",
      "updated_at",
      "next_page_token",
      "closed_reason",
      "tags",
      "body",
    ],
    mutation: {
      method: "createTask",
      params: { body: { title: "Reisekosten abrechnen", priority: "P1" } },
      route: { method: "POST", path: "/items" },
      sideEffects: (upstream) => states.get(upstream)?.created ?? 0,
    },
    events: {
      route: { method: "GET", path: "/events" },
      publish: (upstream, count) => states.get(upstream)?.publishEvents(count),
      expectedTypes: [
        "friday.task.created",
        "friday.task.updated",
        "friday.task.progress",
        "friday.task.completed",
      ],
    },
  },
});
