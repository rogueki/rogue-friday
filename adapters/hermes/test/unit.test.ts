import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { createIdCodec } from "@friday/adapter-core";
import {
  HERMES_CATEGORIES,
  adapterIdFor,
  configSchemaFor,
  createTaskIds,
  externalTaskId,
  hermesFactories,
  manifestFor,
  parseExternalTaskId,
  readSettings,
  toAgentStatus,
  toHermesPriority,
  toPriority,
  toTaskStatus,
} from "../src";
import { taskEventType } from "../src";
import { toHermesPatchStatus, HERMES_STATUSES } from "../src/status";
import { parseTask, parseBoard } from "../src/wire";
import { kanbanSeverity, kanbanStatus, kanbanTitle } from "../src/activity-mapping";

describe("status mapping (docs/MAPPING/hermes.md §6.4)", () => {
  it.each([
    ["triage", "triage"],
    ["todo", "todo"],
    ["scheduled", "waiting"],
    ["ready", "ready"],
    ["running", "running"],
    ["blocked", "waiting"],
    ["review", "review"],
    ["done", "done"],
    ["archived", "cancelled"],
  ])("maps Hermes %s to %s", (hermes, canonical) => {
    expect(toTaskStatus(hermes, null)).toBe(canonical);
  });

  it("derives failed from a failure on tasks that are back in ready/blocked only", () => {
    expect(toTaskStatus("ready", "Absturz")).toBe("failed");
    expect(toTaskStatus("blocked", "Absturz")).toBe("failed");
    expect(toTaskStatus("done", "alter Fehler")).toBe("done");
    expect(toTaskStatus("running", "alter Fehler")).toBe("running");
    expect(toTaskStatus("ready", "")).toBe("ready");
  });

  it("rejects unknown statuses", () => {
    expect(() => toTaskStatus("quantum", null)).toThrowError(/quantum/);
    expect(HERMES_STATUSES).toHaveLength(9);
  });

  it("offers only the writable canonical statuses to PATCH", () => {
    expect(toHermesPatchStatus("waiting")).toBe("blocked");
    for (const status of ["triage", "todo", "ready", "review", "done"] as const) {
      expect(toHermesPatchStatus(status)).toBe(status);
    }
    for (const status of ["running", "failed", "cancelled"] as const) {
      expect(() => toHermesPatchStatus(status)).toThrowError();
    }
  });

  it("derives agent status in the documented order", () => {
    expect(toAgentStatus({ gatewayRunning: false, hasWorker: true, waitingForInput: true })).toBe("offline");
    expect(toAgentStatus({ gatewayRunning: true, hasWorker: true, waitingForInput: true })).toBe("working");
    expect(toAgentStatus({ gatewayRunning: null, hasWorker: false, waitingForInput: true })).toBe("waiting");
    expect(toAgentStatus({ gatewayRunning: true, hasWorker: false, waitingForInput: false })).toBe("idle");
  });
});

describe("priority mapping (proposal 4..0 -> P0..P4)", () => {
  it.each([
    [4, "P0"],
    [3, "P1"],
    [2, "P2"],
    [1, "P3"],
    [0, "P4"],
    [9, "P0"],
    [-3, "P4"],
  ])("Hermes %i -> %s", (value, priority) => {
    expect(toPriority(value)).toBe(priority);
  });

  it("round-trips every canonical priority", () => {
    for (const priority of ["P0", "P1", "P2", "P3", "P4"] as const) {
      expect(toPriority(toHermesPriority(priority))).toBe(priority);
    }
  });
});

describe("task ids include the board", () => {
  it("uses the plain Hermes id for the default board and board/id otherwise", () => {
    expect(externalTaskId({ board: "default", taskId: "t_a90d372a" })).toBe("t_a90d372a");
    expect(externalTaskId({ board: "business", taskId: "t_a90d372a" })).toBe("business/t_a90d372a");
    expect(parseExternalTaskId("business/t_a90d372a")).toEqual({ board: "business", taskId: "t_a90d372a" });
    expect(parseExternalTaskId("t_a90d372a")).toEqual({ board: "default", taskId: "t_a90d372a" });
  });

  it("round-trips through the adapter-core codec (default board reversible without state)", () => {
    const first = createTaskIds();
    const id = first.encode({ board: "default", taskId: "t_a90d372a" });
    expect(id).toMatch(/^task_[0-9A-Za-z]{26}$/);
    expect(createTaskIds().decode(id)).toEqual({ board: "default", taskId: "t_a90d372a" }); // fresh codec, no memory
    const hashed = first.encode({ board: "business", taskId: "t_a90d372a" });
    expect(first.decode(hashed)).toEqual({ board: "business", taskId: "t_a90d372a" });
    expect(createTaskIds().decode(hashed)).toBeUndefined(); // needs rehydration, handled by the adapter
  });

  it("gives the same task in two boards two different ids", () => {
    const ids = createTaskIds(createIdCodec("task"));
    expect(ids.encode({ board: "default", taskId: "t_00000001" })).not.toBe(
      ids.encode({ board: "b", taskId: "t_00000001" }),
    );
  });
});

describe("wire parsers", () => {
  const card = { id: "t_1", title: "A", status: "todo", priority: 0, created_at: 1791988096 };

  it("tolerates missing optional and unknown fields", () => {
    const task = parseTask({ ...card, future_field: { x: 1 } });
    expect(task).toMatchObject({ id: "t_1", assignee: null, progress: null, consecutiveFailures: 0 });
  });

  it("reads child progress and ignores unknown shapes", () => {
    expect(parseTask({ ...card, progress: { done: 1, total: 4 } }).progress).toEqual({ done: 1, total: 4 });
    expect(parseTask({ ...card, progress: "1/4" }).progress).toBeNull();
    expect(parseTask({ ...card, progress: { done: 1, total: 0 } }).progress).toBeNull();
  });

  it.each([
    ["empty title", { ...card, title: "" }],
    ["text priority", { ...card, priority: "hoch" }],
    ["text timestamp", { ...card, created_at: "gestern" }],
    ["missing status", { ...card, status: undefined }],
    ["fractional priority", { ...card, priority: 1.5 }],
  ])("rejects %s with VALIDATION_FAILED", (_name, value) => {
    expect(() => parseTask(value)).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("rejects a board without columns", () => {
    expect(() => parseBoard({ tasks: [] })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });
});

describe("event mapping tables", () => {
  it("assigns severity and status per Kanban event kind and handles unknown kinds", () => {
    expect(kanbanSeverity("crashed")).toBe("error");
    expect(kanbanSeverity("timed_out")).toBe("warning");
    expect(kanbanSeverity("commented")).toBe("info");
    expect(kanbanStatus("completed")).toBe("succeeded");
    expect(kanbanStatus("archived")).toBe("cancelled");
    expect(kanbanStatus("zukunft")).toBe("info");
    expect(kanbanTitle("blocked")).toBe("Aufgabe blockiert");
    expect(kanbanTitle("zu<kunft>")).toBe("Aufgabenereignis: zukunft");
  });

  it("only labels a failure event failed when the task really is failed", () => {
    const task = (status: string) => ({ status }) as Parameters<typeof taskEventType>[1];
    expect(taskEventType("crashed", task("failed"))).toBe("friday.task.failed");
    expect(taskEventType("crashed", task("ready"))).toBe("friday.task.updated");
    expect(taskEventType("created", task("ready"))).toBe("friday.task.created");
    expect(taskEventType("archived", task("cancelled"))).toBe("friday.task.cancelled");
    expect(taskEventType("zukunft", task("ready"))).toBe("friday.task.updated");
  });
});

describe("configuration and manifests", () => {
  it("compiles the schemas, applies the documented defaults and keeps secrets writeOnly", () => {
    for (const category of HERMES_CATEGORIES) {
      const schema = configSchemaFor(category);
      const validate = new Ajv2020({ strict: false, useDefaults: true }).compile(schema);
      const config: Record<string, unknown> = {};
      expect(validate(config)).toBe(true);
      expect(config).toMatchObject({
        apiBaseUrl: "http://127.0.0.1:43693",
        dashboardBaseUrl: "http://127.0.0.1:43691",
        boards: ["default"],
        dashboardAuth: "scrape",
        eventsStartCursor: "tail",
      });
      const manifest = manifestFor(category);
      expect(manifest.configSchemaRef).toBe(schema.$id);
      for (const field of manifest.secretFields) {
        expect((schema.properties as Record<string, { writeOnly?: boolean }>)[field]?.writeOnly).toBe(true);
      }
      expect(validate({ apiKey: "x".repeat(20), unknownField: 1 })).toBe(false);
    }
  });

  it("validates settings and normalises URLs", () => {
    expect(readSettings({ apiBaseUrl: "http://127.0.0.1:1/" }).apiBaseUrl).toBe("http://127.0.0.1:1");
    expect(readSettings({}).boards).toEqual(["default"]);
    expect(readSettings({ boards: ["a", "a", "b"] }).boards).toEqual(["a", "b"]);
    for (const bad of [
      { apiBaseUrl: "ftp://x" },
      { boards: [] },
      { boards: ["Großes Board"] },
      { timeoutMs: 1 },
      { eventsStartCursor: -1 },
      { dashboardAuth: "magic" },
    ]) {
      expect(() => readSettings(bad)).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    }
  });

  it("exposes one factory per category under the placeholder provider ids", () => {
    expect(hermesFactories.map((factory) => factory.providerId)).toEqual([
      "hermes-tasks",
      "hermes-activity",
      "hermes-agents",
      "hermes-automations",
    ]);
    for (const factory of hermesFactories) {
      expect(factory.providerId).toBe(adapterIdFor(factory.category));
      expect(factory.create().manifest.id).toBe(factory.providerId);
    }
  });

  it("declares only capabilities that are verified", () => {
    expect(manifestFor("tasks").capabilities).toEqual([
      "tasks.read",
      "tasks.create",
      "tasks.update",
      // Comment route + PATCH status ready (unblock_task) checked against the installed Hermes kanban plugin.
      "tasks.input",
      "tasks.cancel",
      "tasks.retry",
      "tasks.stream",
    ]);
    expect(manifestFor("activity").capabilities).toEqual([
      "activity.read",
      "activity.stream",
      "activity.backfill",
    ]);
    expect(manifestFor("agents").capabilities).toEqual(["agents.read", "agents.stop"]);
  });
});
