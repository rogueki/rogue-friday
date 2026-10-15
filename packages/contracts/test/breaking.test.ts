/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures mutate loosely typed OpenAPI/AsyncAPI documents */
import { describe, expect, it } from "vitest";
import { detectBreaking, diffSchemaNode, majorOf } from "../scripts/lib/breaking.mjs";

type Change = { kind: string; path: string; message: string };

const diff = (before: unknown, after: unknown): Change[] => {
  const out: Change[] = [];
  diffSchemaNode(before, after, "root", out);
  return out;
};
const kinds = (changes: Change[]) => changes.map((c) => c.kind);

const objectSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ["a", "b"] },
    note: { type: "string" },
  },
  required: ["id"],
};

describe("schema breaking-change rules", () => {
  it("accepts identical schemas and purely additive optional properties", () => {
    expect(diff(objectSchema, objectSchema)).toEqual([]);
    const extended = {
      ...objectSchema,
      properties: { ...objectSchema.properties, extra: { type: "integer" } },
    };
    expect(diff(objectSchema, extended)).toEqual([]);
  });

  it("flags removed properties", () => {
    const { note: _note, ...rest } = objectSchema.properties;
    expect(kinds(diff(objectSchema, { ...objectSchema, properties: rest }))).toEqual(["property-removed"]);
  });

  it("flags newly required properties, including brand-new required ones", () => {
    const becameRequired = { ...objectSchema, required: ["id", "note"] };
    expect(kinds(diff(objectSchema, becameRequired))).toEqual(["property-required"]);
    const added = {
      ...objectSchema,
      properties: { ...objectSchema.properties, fresh: { type: "string" } },
      required: ["id", "fresh"],
    };
    const changes = diff(objectSchema, added);
    expect(kinds(changes)).toEqual(["property-required"]);
    expect(changes[0]?.message).toContain("newly added");
  });

  it("flags removed enum values but not added ones", () => {
    const narrowed = {
      ...objectSchema,
      properties: { ...objectSchema.properties, status: { type: "string", enum: ["a"] } },
    };
    expect(kinds(diff(objectSchema, narrowed))).toEqual(["enum-value-removed"]);
    const widened = {
      ...objectSchema,
      properties: { ...objectSchema.properties, status: { type: "string", enum: ["a", "b", "c"] } },
    };
    expect(diff(objectSchema, widened)).toEqual([]);
  });

  it("flags type changes, nullable changes and $ref retargeting", () => {
    expect(kinds(diff({ type: "string" }, { type: "integer" }))).toEqual(["type-changed"]);
    expect(kinds(diff({ type: "string" }, { type: ["string", "null"] }))).toEqual(["type-changed"]);
    expect(kinds(diff({ $ref: "../a.schema.json" }, { $ref: "../b.schema.json" }))).toEqual(["type-changed"]);
    expect(diff({ $ref: "../a.schema.json" }, { $ref: "../a.schema.json" })).toEqual([]);
  });

  it("flags tightened constraints and removed oneOf variants", () => {
    expect(kinds(diff({ type: "string", maxLength: 10 }, { type: "string", maxLength: 5 }))).toEqual([
      "constraint-tightened",
    ]);
    expect(kinds(diff({ type: "integer", minimum: 0 }, { type: "integer", minimum: 1 }))).toEqual([
      "constraint-tightened",
    ]);
    const before = { oneOf: [{ type: "string" }, { type: "integer" }] };
    expect(kinds(diff(before, { oneOf: [{ type: "string" }] }))).toEqual(["variant-removed"]);
  });

  it("recurses into nested properties and array items", () => {
    const before = {
      type: "object",
      properties: {
        list: { type: "array", items: { type: "object", properties: { a: { type: "string" } } } },
      },
    };
    const after = {
      type: "object",
      properties: { list: { type: "array", items: { type: "object", properties: {} } } },
    };
    const changes = diff(before, after);
    expect(kinds(changes)).toEqual(["property-removed"]);
    expect(changes[0]?.path).toBe("root/properties/list/items/properties/a");
  });
});

const baseOpenapi = () => ({
  openapi: "3.1.1",
  info: { version: "1.2.0" },
  paths: {
    "/api/v1/tasks": {
      get: {
        operationId: "listTasks",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }] as Record<
          string,
          unknown
        >[],
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/TaskListResponse" } } },
          },
          "401": {},
        } as Record<string, any>,
      },
      post: {
        operationId: "createTask",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TaskCreateRequest" } } },
        },
        responses: { "201": {} },
      },
    } as Record<string, any>,
  } as Record<string, any>,
  components: { schemas: { TaskListResponse: { $ref: "../schemas/tasks/task-list-response.schema.json" } } },
});
const baseAsyncapi = () => ({
  asyncapi: "3.1.0",
  info: { version: "1.2.0" },
  channels: { events: { address: "/api/v1/events" } },
  components: {
    messages: {
      taskUpdated: {
        name: "friday.task.updated",
        payload: { allOf: [{ properties: { data: { $ref: "../schemas/tasks/task.schema.json" } } }] },
      },
      taskCreated: { name: "friday.task.created", payload: {} },
    } as Record<string, any>,
  },
});
const contract = (
  openapi = baseOpenapi(),
  asyncapi = baseAsyncapi(),
  schemas: Record<string, unknown> = {},
) => ({
  openapi,
  asyncapi,
  schemas,
});

describe("detectBreaking (OpenAPI, AsyncAPI, schema files)", () => {
  it("is ok when nothing changed", () => {
    const result = detectBreaking(contract(), contract());
    expect(result.changes).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("flags removed paths, operations and responses", () => {
    const current = contract();
    delete current.openapi.paths["/api/v1/tasks"].post;
    delete current.openapi.paths["/api/v1/tasks"].get.responses["401"];
    const result = detectBreaking(contract(), current);
    expect(kinds(result.changes as Change[]).sort()).toEqual(["operation-removed", "response-removed"]);
    expect(result.ok).toBe(false);

    const noPath = contract();
    noPath.openapi.paths = {};
    expect(kinds(detectBreaking(contract(), noPath).changes as Change[])).toEqual(["path-removed"]);
  });

  it("flags new required parameters", () => {
    const current = contract();
    current.openapi.paths["/api/v1/tasks"].get.parameters.push({
      name: "tenant",
      in: "query",
      required: true,
      schema: { type: "string" },
    });
    const result = detectBreaking(contract(), current);
    expect(kinds(result.changes as Change[])).toEqual(["parameter-required"]);
  });

  it("flags retargeted response schemas", () => {
    const current = contract();
    current.openapi.paths["/api/v1/tasks"].get.responses["200"].content["application/json"].schema = {
      $ref: "#/components/schemas/Other",
    };
    expect(kinds(detectBreaking(contract(), current).changes as Change[])).toEqual(["type-changed"]);
  });

  it("flags removed event types and retargeted payloads", () => {
    const current = contract();
    delete current.asyncapi.components.messages.taskCreated;
    expect(kinds(detectBreaking(contract(), current).changes as Change[])).toEqual(["event-removed"]);

    const retargeted = contract();
    retargeted.asyncapi.components.messages.taskUpdated.payload.allOf[0].properties.data.$ref =
      "../schemas/tasks/other.schema.json";
    expect(kinds(detectBreaking(contract(), retargeted).changes as Change[])).toEqual(["type-changed"]);
  });

  it("flags removed schema files", () => {
    const before = contract(undefined, undefined, {
      "https://friday.local/schemas/tasks/task.schema.json": { type: "object" },
    });
    expect(kinds(detectBreaking(before, contract()).changes as Change[])).toEqual(["schema-removed"]);
  });

  it("accepts breaking changes only with a major version bump", () => {
    const current = contract();
    current.openapi.paths = {};
    current.openapi.info.version = "2.0.0";
    const result = detectBreaking(contract(), current);
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.majorBumped).toBe(true);
    expect(result.ok).toBe(true);

    current.openapi.info.version = "1.9.0";
    expect(detectBreaking(contract(), current).ok).toBe(false);
  });
});

describe("majorOf", () => {
  it("parses the major component", () => {
    expect(majorOf("3.4.5")).toBe(3);
    expect(majorOf(undefined)).toBe(0);
    expect(majorOf("x")).toBe(0);
  });
});
