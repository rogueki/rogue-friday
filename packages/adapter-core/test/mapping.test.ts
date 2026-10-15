import { describe, expect, it } from "vitest";
import {
  PORT_CATEGORIES,
  PORT_SPEC,
  allowedCapabilities,
  assertNoProviderFields,
  createId,
  createIdCodec,
  createManualClock,
  createMapContext,
  defineEventMapper,
  defineMapper,
  findForbiddenKeys,
  methodsOf,
  sourceDescriptor,
} from "../src";
import { makeTask } from "./helpers";
import type { Task } from "@friday/sdk";

interface RawItem {
  item_id: string;
  state: "open" | "closed";
  owner_bot: string;
}

const context = createMapContext({ adapterId: "test-tasks", system: "test", clock: createManualClock() });

const taskMapper = defineMapper<RawItem, Task>({
  name: "RawItem -> Task",
  schema: "Task",
  toCanonical: (raw, ctx) => ({
    ...makeTask(1),
    id: createId("task", raw.item_id),
    status: raw.state === "open" ? "todo" : "done",
    source: ctx.source(raw.item_id),
  }),
});

describe("createId / createIdCodec", () => {
  it("is deterministic with a seed, random without, and matches the contract pattern", () => {
    expect(createId("task", "a")).toBe(createId("task", "a"));
    expect(createId("task", "a")).not.toBe(createId("task", "b"));
    expect(createId("task")).not.toBe(createId("task"));
    expect(createId("appr", "x")).toMatch(/^appr_[0-9A-Za-z]{26}$/);
  });

  it("round-trips short external ids and hashes long ones with a remembered reverse mapping", () => {
    const codec = createIdCodec("task");
    const short = codec.encode("item_42");
    expect(short).toMatch(/^task_[0-9A-Za-z]{26}$/);
    expect(codec.decode(short)).toBe("item_42");
    const long = "https://example.invalid/items/with/a/very/long/identifier";
    const encoded = codec.encode(long);
    expect(encoded).toMatch(/^task_[0-9A-Za-z]{26}$/);
    expect(codec.decode(encoded)).toBe(long);
    expect(createIdCodec("task").decode(encoded)).toBeUndefined();
    expect(codec.decode(createId("task", "never-seen-by-codec"))).toBeUndefined();
    expect(() => codec.require("task_00000000000000000000000000")).toThrowError(/Unbekannte ID/);
    expect(codec.decode(short.replace("task_", "agent_"))).toBeUndefined();
  });
});

describe("defineMapper", () => {
  it("maps provider objects to valid canonical objects and stamps the source descriptor", () => {
    const task = taskMapper.map({ item_id: "i-1", state: "open", owner_bot: "hermes" }, context);
    expect(task.source).toEqual(sourceDescriptor("test-tasks", "test", "i-1", context.syncedAt));
    expect(task.status).toBe("todo");
  });

  it("rejects canonical objects that carry provider-specific fields", () => {
    const leaking = defineMapper<RawItem, Task>({
      name: "leaky",
      schema: "Task",
      toCanonical: (raw) => ({ ...makeTask(1), owner_bot: raw.owner_bot }) as Task,
    });
    expect(() => leaking.map({ item_id: "i", state: "open", owner_bot: "x" }, context)).toThrowError(
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        details: expect.objectContaining({ providerFieldLeak: true }),
      }),
    );
    expect(() => assertNoProviderFields("Task", { ...makeTask(1), item_id: "i" })).toThrowError(
      /provider-specific/,
    );
    expect(() => assertNoProviderFields("Task", makeTask(1))).not.toThrow();
  });

  it("rejects values outside the contract enums and wraps mapper exceptions", () => {
    const invalid = defineMapper<RawItem, Task>({
      name: "invalid",
      schema: "Task",
      toCanonical: () => ({ ...makeTask(1), status: "open" }) as unknown as Task,
    });
    expect(() => invalid.map({ item_id: "i", state: "open", owner_bot: "x" }, context)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    const crashing = defineMapper<RawItem, Task>({
      name: "crashing",
      schema: "Task",
      toCanonical: () => {
        throw new TypeError("boom");
      },
    });
    expect(() => crashing.map({ item_id: "i", state: "open", owner_bot: "x" }, context)).toThrowError(
      expect.objectContaining({ code: "INTERNAL" }),
    );
  });

  it("findForbiddenKeys locates provider keys anywhere in a tree", () => {
    expect(findForbiddenKeys({ a: [{ item_id: 1 }], b: { owner_bot: 2 } }, ["item_id", "owner_bot"])).toEqual(
      [".a[0].item_id", ".b.owner_bot"],
    );
  });
});

describe("defineEventMapper", () => {
  const mapper = defineEventMapper<{ kind: string; item: RawItem }>({
    name: "raw event -> task event",
    toCanonical: (raw, ctx) => {
      if (raw.kind === "ignore") return null;
      const task = taskMapper.map(raw.item, ctx);
      return {
        type: raw.kind === "created" ? "friday.task.created" : "friday.task.updated",
        subject: `task/${task.id}`,
        data: task,
      };
    },
  });
  const item: RawItem = { item_id: "i-1", state: "open", owner_bot: "x" };

  it("maps provider events to validated canonical events and drops unmapped ones on purpose", () => {
    const events = mapper.mapMany(
      [
        { kind: "created", item },
        { kind: "ignore", item },
        { kind: "updated", item },
      ],
      context,
    );
    expect(events.map((e) => e.type)).toEqual(["friday.task.created", "friday.task.updated"]);
  });

  it("rejects events whose payload violates the event schema or that lack a subject", () => {
    const broken = defineEventMapper<unknown>({
      name: "broken",
      toCanonical: () => ({
        type: "friday.task.created",
        subject: "task/x",
        data: { ...makeTask(1), unknown_field: 1 } as never,
      }),
    });
    expect(() => broken.map({}, context)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    const noSubject = defineEventMapper<unknown>({
      name: "nosubject",
      toCanonical: () => ({ type: "friday.task.created", subject: "", data: makeTask(1) }),
    });
    expect(() => noSubject.map({}, context)).toThrowError(/subject/);
  });
});

describe("PORT_SPEC", () => {
  it("covers all 15 categories with unique method names and valid capabilities", () => {
    expect(PORT_CATEGORIES).toHaveLength(15);
    const seen = new Set<string>();
    for (const category of PORT_CATEGORIES) {
      const allowed = allowedCapabilities(category);
      const methods = methodsOf(category);
      expect(
        methods.some(([, spec]) => spec.required),
        category,
      ).toBe(true);
      for (const [name, spec] of methods) {
        expect(seen.has(name), `duplicate ${name}`).toBe(false);
        seen.add(name);
        expect(spec.operationId).toBe(name);
        expect(allowed.has(spec.capability)).toBe(true);
        expect(spec.capability.startsWith(`${category}.`)).toBe(true);
      }
    }
    expect(Object.keys(PORT_SPEC)).toHaveLength(15);
    expect(seen.size).toBe(89);
  });
});
