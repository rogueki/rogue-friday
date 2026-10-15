// Step 8: run the conformance suite. `pnpm test:conformance` discovers adapters/*/test/conformance.test.ts.
import { runConformanceSuite, type FakeUpstream } from "@friday/adapter-testkit";
import { ThingsAdapter, configSchema } from "../src";

/** Fake "Things API": GET /things (cursor paging) and GET /things/:id. */
function seedThings(upstream: FakeUpstream, { count, pageSize }: { count: number; pageSize: number }): void {
  const things = Array.from({ length: count }, (_, index) => ({
    thing_id: `thing-${index + 1}`,
    label: `Ding ${index + 1}`,
    phase: (["new", "doing", "finished"] as const)[index % 3],
    changed: "2026-10-13T20:00:00.000Z",
  }));
  upstream.route("GET", "/things", (request) => {
    const offset = Number(request.query.cursor ?? 0);
    const limit = Math.min(Number(request.query.limit ?? pageSize), pageSize);
    return {
      body: {
        data: things.slice(offset, offset + limit),
        next: offset + limit < count ? String(offset + limit) : null,
      },
    };
  });
  upstream.route("GET", "/things/:id", (request) => {
    const thing = things.find((entry) => entry.thing_id === request.params.id);
    return thing ? { body: thing } : { status: 404, body: { error: "not found" } };
  });
}

runConformanceSuite({
  name: "things-http (template)",
  category: "tasks",
  createAdapter: ({ upstream, timing }) => ({
    adapter: new ThingsAdapter(),
    configSchema,
    config: {
      baseUrl: upstream.url,
      timeoutMs: timing.timeoutMs,
      maxAttempts: timing.maxAttempts,
      retryBaseDelayMs: timing.retryBaseDelayMs,
    },
  }),
  fixtures: {
    seed: seedThings,
    list: { method: "listTasks", route: { method: "GET", path: "/things" } },
    get: {
      method: "getTask",
      paramsFor: (item) => ({ id: item.id }),
      route: { method: "GET", path: "/things/:id" },
    },
    invalidListBody: () => ({
      data: [{ thing_id: "bad", label: "", phase: "unknown", changed: "gestern" }],
      next: null,
    }),
    providerFields: ["thing_id", "label", "phase", "changed"],
  },
});
