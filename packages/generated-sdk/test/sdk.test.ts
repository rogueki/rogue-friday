import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  JARVIS_EVENT_DATA_SCHEMA_IDS,
  JARVIS_EVENT_TYPES,
  JarvisApiError,
  SCHEMA_IDS,
  createJarvisClient,
  createSchemaValidator,
  isControlFrame,
  isJarvisEvent,
  type JarvisEvent,
} from "../src/index";

const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../contracts/examples");
const readExample = (rel: string): Record<string, unknown> => {
  const { $schema: _schema, ...payload } = JSON.parse(
    fs.readFileSync(path.join(examples, rel), "utf8"),
  ) as Record<string, unknown>;
  return payload;
};

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

describe("createJarvisClient", () => {
  it("sends credentials, correlation id and CSRF token on mutating requests only", async () => {
    const fetchMock = vi.fn(async (_request: Request) =>
      jsonResponse(readExample("tasks/task-response.json")),
    );
    const client = createJarvisClient({
      baseUrl: "http://localhost:3100",
      fetch: fetchMock as unknown as typeof fetch,
      getCsrfToken: () => "csrf-token",
      getCorrelationId: () => "corr_01JCW5E9R2Q7T4M8N3B6V00001",
    });

    await client.GET("/api/v1/tasks/{id}", { params: { path: { id: "task_01JCW5E9R2Q7T4M8N3B6V00001" } } });
    await client.POST("/api/v1/tasks/{id}/cancel", {
      params: { path: { id: "task_01JCW5E9R2Q7T4M8N3B6V00001" } },
    });

    const [getRequest, postRequest] = fetchMock.mock.calls.map(([request]) => request);
    expect(getRequest?.headers.get("X-Correlation-Id")).toBe("corr_01JCW5E9R2Q7T4M8N3B6V00001");
    expect(getRequest?.headers.get("X-CSRF-Token")).toBeNull();
    expect(getRequest?.credentials).toBe("include");
    expect(postRequest?.method).toBe("POST");
    expect(postRequest?.headers.get("X-CSRF-Token")).toBe("csrf-token");
    expect(new URL(postRequest?.url ?? "").pathname).toBe(
      "/api/v1/tasks/task_01JCW5E9R2Q7T4M8N3B6V00001/cancel",
    );
  });

  it("generates a contract-conformant correlation id when none is supplied", async () => {
    const fetchMock = vi.fn(async (_request: Request) => jsonResponse(readExample("meta/meta.json")));
    const client = createJarvisClient({
      baseUrl: "http://localhost:3100",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.GET("/api/v1/meta");
    expect(fetchMock.mock.calls[0]?.[0].headers.get("X-Correlation-Id")).toMatch(/^corr_[0-9A-Z]{26}$/);
  });

  it("maps contract errors to a typed JarvisApiError", async () => {
    const body = readExample("common/error-adapter-unavailable.json");
    const fetchMock = vi.fn(async () =>
      jsonResponse(body, {
        status: 503,
        headers: { "content-type": "application/json", "X-Correlation-Id": "corr_HEADER" },
      }),
    );
    const client = createJarvisClient({
      baseUrl: "http://localhost:3100",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const error = await client.GET("/api/v1/calendar/events").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JarvisApiError);
    const api = error as JarvisApiError;
    expect(api.code).toBe("ADAPTER_UNAVAILABLE");
    expect(api.status).toBe(503);
    expect(api.retryable).toBe(true);
    expect(api.severity).toBe("warning");
    expect(api.message).toContain("Kalender-Adapter");
    expect(api.correlationId).toMatch(/^corr_/);
  });

  it("derives an error from the status when the body is not a contract error", async () => {
    const fetchMock = vi.fn(
      async () => new Response("<html>bad gateway</html>", { status: 429, statusText: "Too Many Requests" }),
    );
    const client = createJarvisClient({
      baseUrl: "http://localhost:3100",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const api = (await client.GET("/api/v1/tasks").catch((e: unknown) => e)) as JarvisApiError;
    expect(api.code).toBe("RATE_LIMITED");
    expect(api.retryable).toBe(true);
    expect(api.status).toBe(429);
  });

  it("maps network failures to a retryable JarvisApiError with status 0", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createJarvisClient({
      baseUrl: "http://localhost:3100",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const api = (await client.GET("/api/v1/health").catch((e: unknown) => e)) as JarvisApiError;
    expect(api).toBeInstanceOf(JarvisApiError);
    expect(api.status).toBe(0);
    expect(api.retryable).toBe(true);
  });
});

describe("createSchemaValidator", () => {
  const validator = createSchemaValidator();

  it("validates examples by title and by $id", () => {
    const task = readExample("tasks/task.json");
    expect(validator.validate("Task", task)).toMatchObject({ valid: true, errors: [] });
    expect(validator.validate(SCHEMA_IDS.OrbStatus, readExample("orb/orb-status-working.json")).valid).toBe(
      true,
    );
  });

  it("reports readable errors for invalid data", () => {
    const task = { ...readExample("tasks/task.json"), status: "kaputt" };
    const result = validator.validate("Task", task);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "/status")).toBe(true);
  });

  it("throws for unknown schemas", () => {
    expect(() => validator.validate("DoesNotExist", {})).toThrow(/Unknown contract schema/);
    expect(validator.has("Task")).toBe(true);
    expect(validator.has("DoesNotExist")).toBe(false);
  });

  it("validates event payloads through the event schema map", () => {
    const event = readExample("events/event-task-updated.json");
    const type = event.type as keyof typeof JARVIS_EVENT_DATA_SCHEMA_IDS;
    expect(validator.validate("EventEnvelope", event).valid).toBe(true);
    expect(validator.validate(JARVIS_EVENT_DATA_SCHEMA_IDS[type], event.data).valid).toBe(true);
  });
});

describe("event helpers and constants", () => {
  it("exposes the contract version and a complete event type list", () => {
    expect(CONTRACT_VERSION).toBe("1.0.0");
    expect(JARVIS_EVENT_TYPES).toContain("jarvis.orb.status_changed");
    expect(JARVIS_EVENT_TYPES).toContain("jarvis.status.resync_required");
    expect(new Set(JARVIS_EVENT_TYPES).size).toBe(JARVIS_EVENT_TYPES.length);
  });

  it("recognises events and control frames structurally", () => {
    const event = readExample("events/event-task-updated.json");
    expect(isJarvisEvent(event)).toBe(true);
    expect(isJarvisEvent({ ...event, type: "jarvis.unknown.thing" })).toBe(false);
    expect(isJarvisEvent({ ...event, sequence: 1.5 })).toBe(false);
    expect(isJarvisEvent(null)).toBe(false);
    expect(isControlFrame({ kind: "ping", ts: 1 })).toBe(true);
    expect(isControlFrame(event)).toBe(false);
  });

  it("types event payloads (compile-time check)", () => {
    const event = readExample(
      "events/event-orb-status-changed.json",
    ) as unknown as JarvisEvent<"jarvis.orb.status_changed">;
    expect(event.data.status.mode).toBe("working");
    expect(event.data.layers.activeAgentIds).toHaveLength(3);
  });
});
