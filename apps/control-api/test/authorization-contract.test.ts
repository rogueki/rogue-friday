import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { ROUTE_TABLE } from "../src/http/route-table.generated";

/**
 * DASH-02.02: every contracted operation declares a role, and the generated route table (the thing the API actually
 * enforces) carries exactly that role. A hand-edited table or a schema without `x-required-role` fails here.
 */
const contractsRoot = resolve(import.meta.dirname, "..", "..", "..", "packages", "contracts");
const spec = parse(readFileSync(join(contractsRoot, "openapi", "friday-api.yaml"), "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string; "x-required-role"?: string; "x-capability"?: string }>>;
};

interface ContractOperation {
  operationId: string;
  method: string;
  path: string;
  role: string;
  capability?: string;
}

const operations: ContractOperation[] = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
    .map(([method, op]) => ({
      operationId: op.operationId ?? "",
      method: method.toUpperCase(),
      path,
      role: op["x-required-role"] ?? "",
      capability: op["x-capability"],
    })),
);

/** Operations a session cannot hold a capability for, or that only exist behind explicit owner/dev switches. */
const withoutCapability = new Set([
  "login", "logout", "logoutAll", "reauth", "submitFrontendTelemetry", "playScenario", "controlScenario",
]);

describe("authorization contract", () => {
  it("parses the shared contract and finds the expected breadth", () => {
    expect(operations.length).toBeGreaterThan(250);
    expect(operations.filter((operation) => operation.method !== "GET").length).toBeGreaterThan(140);
  });

  it("declares exactly one known role for every operation", () => {
    // "none" is reserved for the public bootstrap endpoints (login and the anonymous meta read).
    const missing = operations.filter((operation) => !["viewer", "operator", "owner", "none"].includes(operation.role));
    expect(missing.map((operation) => `${operation.method} ${operation.path}`)).toEqual([]);
  });

  it("declares a capability for every write operation, except owner-only and auth/telemetry/dev routes", () => {
    const missing = operations.filter((operation) =>
      operation.method !== "GET" && !operation.capability && operation.role !== "owner" && !withoutCapability.has(operation.operationId));
    expect(missing.map((operation) => `${operation.method} ${operation.path}`)).toEqual([]);
  });

  it("enforces exactly the contracted role and capability in the generated route table", () => {
    const table = new Map<string, (typeof ROUTE_TABLE)[number]>(ROUTE_TABLE.map((route) => [route.operationId, route]));
    expect(table.size).toBe(operations.length);
    const mismatches: string[] = [];
    for (const operation of operations) {
      const route = table.get(operation.operationId);
      if (!route) {
        mismatches.push(`${operation.operationId}: missing in the route table`);
        continue;
      }
      if (route.role !== operation.role) mismatches.push(`${operation.operationId}: role ${route.role} != ${operation.role}`);
      if (route.method !== operation.method || route.path !== operation.path) {
        mismatches.push(`${operation.operationId}: ${route.method} ${route.path} != ${operation.method} ${operation.path}`);
      }
      if ((route.capability ?? undefined) !== operation.capability) {
        mismatches.push(`${operation.operationId}: capability ${String(route.capability)} != ${String(operation.capability)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});