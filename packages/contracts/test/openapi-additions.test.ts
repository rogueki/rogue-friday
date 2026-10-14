import { describe, expect, it } from "vitest";
import { paths, readYaml } from "../scripts/lib/contract.mjs";

type Header = { $ref?: string };
type Operation = {
  operationId: string;
  parameters?: Array<{ $ref?: string }>;
  responses: Record<string, { headers?: Record<string, Header>; content?: Record<string, unknown> } | { $ref: string }>;
  "x-required-role"?: string;
  "x-max-body-bytes"?: number;
};
const doc = readYaml(paths.openapi) as { paths: Record<string, Record<string, Operation>>; components: { headers: Record<string, unknown> } };
const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
    .map(([method, op]) => ({ path, method, op })),
);

describe("Idempotent-Replayed response header", () => {
  const idempotent = operations.filter(({ op }) => (op.parameters ?? []).some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"));

  it("is declared in components.headers", () => {
    expect(doc.components.headers.IdempotentReplayed).toBeDefined();
  });

  it("is declared on every success response of every operation that accepts an Idempotency-Key", () => {
    expect(idempotent.length).toBeGreaterThanOrEqual(24);
    const missing: string[] = [];
    for (const { op } of idempotent) {
      const successes = Object.entries(op.responses).filter(([status]) => /^2\d\d$/.test(status));
      expect(successes.length, op.operationId).toBeGreaterThan(0);
      for (const [status, response] of successes) {
        const header = (response as { headers?: Record<string, Header> }).headers?.["Idempotent-Replayed"];
        if (header?.$ref !== "#/components/headers/IdempotentReplayed") missing.push(`${op.operationId} ${status}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("is declared nowhere else (operations without an Idempotency-Key never replay)", () => {
    const idempotentIds = new Set(idempotent.map(({ op }) => op.operationId));
    const stray = operations
      .filter(({ op }) => !idempotentIds.has(op.operationId))
      .filter(({ op }) => Object.values(op.responses).some((response) => "headers" in response && response.headers && "Idempotent-Replayed" in response.headers))
      .map(({ op }) => op.operationId);
    expect(stray).toEqual([]);
  });
});

describe("observability operations (PLAN §50.3)", () => {
  const find = (operationId: string) => operations.find(({ op }) => op.operationId === operationId);

  it("getMetrics: GET /api/v1/metrics, owner only, Prometheus text", () => {
    const metrics = find("getMetrics");
    expect(metrics).toMatchObject({ path: "/api/v1/metrics", method: "get" });
    expect(metrics?.op["x-required-role"]).toBe("owner");
    const ok = metrics?.op.responses["200"] as { content?: Record<string, unknown> };
    expect(Object.keys(ok.content ?? {})).toEqual(["text/plain"]);
  });

  it("submitFrontendTelemetry: POST /api/v1/telemetry/frontend, operator+, CSRF, size-limited, 202/413/429", () => {
    const telemetry = find("submitFrontendTelemetry");
    expect(telemetry).toMatchObject({ path: "/api/v1/telemetry/frontend", method: "post" });
    expect(telemetry?.op["x-required-role"]).toBe("operator");
    expect(telemetry?.op["x-max-body-bytes"]).toBe(32768);
    expect((telemetry?.op.parameters ?? []).map((parameter) => parameter.$ref)).toContain("#/components/parameters/CsrfToken");
    expect(Object.keys(telemetry?.op.responses ?? {})).toEqual(expect.arrayContaining(["202", "401", "403", "413", "422", "429"]));
  });

  it("the contract has 109 operations", () => {
    expect(operations).toHaveLength(109);
  });
});
