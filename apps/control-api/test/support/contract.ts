/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import type { LightMyRequestResponse } from "fastify";
import { createSchemaValidator } from "@friday/sdk";
import { ROUTE_TABLE } from "../../src/http/route-table.generated";
import type { OperationId, RouteSpec } from "../../src/http/route-types";
import type { ApiClient } from "../helpers";

const validator = createSchemaValidator();
const CORRELATION = /^corr_[0-9A-Za-z]{26}$/;

export const SPECS = new Map<OperationId, RouteSpec>(ROUTE_TABLE.map((spec) => [spec.operationId, spec]));

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Accepted status codes; default: the first declared 2xx. */
  expect?: number | readonly number[];
  csrf?: boolean;
}

export interface CallResult {
  response: LightMyRequestResponse;
  status: number;
  /** Parsed JSON body (`undefined` for non-JSON responses). */
  json: any;
}

export const specOf = (operationId: OperationId): RouteSpec => {
  const spec = SPECS.get(operationId);
  if (!spec) throw new Error(`Unbekannte Operation ${operationId}`);
  return spec;
};

export function pathOf(spec: RouteSpec, params: Record<string, string> = {}): string {
  return spec.path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`${spec.operationId}: Pfadparameter ${name} fehlt`);
    return encodeURIComponent(value);
  });
}

/** Problems found when comparing a response with the contract: undeclared status, wrong body, missing headers. */
export function contractProblems(spec: RouteSpec, response: LightMyRequestResponse): string[] {
  const problems: string[] = [];
  const declared = spec.responses.find((candidate) => candidate.status === response.statusCode);
  if (!declared) {
    problems.push(`Status ${response.statusCode} ist für ${spec.operationId} nicht im Vertrag (${spec.responses.map((r) => r.status).join(", ")})`);
  }
  if (!CORRELATION.test(String(response.headers["x-correlation-id"] ?? ""))) problems.push("X-Correlation-Id fehlt oder ist ungültig");
  const contentType = String(response.headers["content-type"] ?? "");
  const isJson = contentType.includes("application/json");
  if (declared?.contentTypes.length && response.body.length > 0 && !declared.contentTypes.some((type) => contentType.startsWith(type.split(";")[0] as string))) {
    // A JSON-declared operation may legitimately stream NDJSON/CSV (audit export formats); everything else must match.
    if (!(spec.operationId === "exportAudit" && /ndjson|csv/.test(contentType))) {
      problems.push(`Content-Type ${contentType} ist nicht deklariert (${declared.contentTypes.join(", ")})`);
    }
  }
  const schema = declared?.schema ?? (response.statusCode >= 400 ? "ErrorResponse" : null);
  if (schema && schema !== "binary" && isJson) {
    const result = validator.validate(schema, response.json());
    if (!result.valid) problems.push(`Antwort verletzt ${schema}: ${result.errors.slice(0, 4).map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  } else if (schema === "binary" && response.body.length === 0) {
    problems.push("Download ist leer");
  } else if (schema && schema !== "binary" && !isJson && !(spec.operationId === "exportAudit" && /ndjson|csv/.test(contentType))) {
    problems.push(`Erwartete JSON-Antwort (${schema}), erhielt ${contentType || "keinen Content-Type"}`);
  }
  return problems;
}

/** Calls operations by id, validates every response against the contract and records what was covered. */
export class ContractProbe {
  readonly covered = new Map<OperationId, Set<number>>();
  readonly problems: string[] = [];

  async call(client: ApiClient, operationId: OperationId, options: CallOptions = {}): Promise<CallResult> {
    const spec = specOf(operationId);
    const response = await client.request(spec.method, pathOf(spec, options.params), {
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.query ? { query: options.query } : {}),
      ...(options.csrf === false ? { csrf: false } : {}),
    });
    const found = contractProblems(spec, response);
    for (const problem of found) this.problems.push(`${operationId}: ${problem}`);
    const set = this.covered.get(operationId) ?? new Set<number>();
    set.add(response.statusCode);
    this.covered.set(operationId, set);

    const accepted = options.expect === undefined ? [spec.responses.find((r) => r.status < 300)?.status ?? 200] : Array.isArray(options.expect) ? options.expect : [options.expect];
    if (!accepted.includes(response.statusCode) || found.length > 0) {
      throw new Error(`${operationId} → ${response.statusCode} (erwartet ${accepted.join("/")})${found.length ? `\n  ${found.join("\n  ")}` : ""}\n  ${response.body.slice(0, 400)}`);
    }
    let json: unknown;
    try {
      json = response.body.length > 0 && String(response.headers["content-type"] ?? "").includes("json") ? response.json() : undefined;
    } catch {
      json = undefined;
    }
    return { response, status: response.statusCode, json };
  }

  /** Operations never called with a successful (declared 2xx) status. */
  uncovered(): OperationId[] {
    return ROUTE_TABLE.filter((spec) => {
      const seen = this.covered.get(spec.operationId);
      return !seen || ![...seen].some((status) => status >= 200 && status < 300);
    }).map((spec) => spec.operationId);
  }
}
