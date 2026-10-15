import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { SCHEMAS, SCHEMA_IDS } from "@friday/sdk";
import type { QueryParamSpec, RouteSpec } from "./route-types";
import { ApiError } from "../util/errors";

const COMPONENT_REF = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/;

/** Rewrites the bundled document's `#/components/schemas/X` references to the SDK registry's schema ids. */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "$ref" && typeof value === "string") {
      const match = COMPONENT_REF.exec(value);
      const id = match ? (SCHEMA_IDS as Record<string, string>)[match[1] as string] : undefined;
      out[key] = id ?? value;
    } else {
      out[key] = rewriteRefs(value);
    }
  }
  return out;
}

/**
 * Validates and coerces query parameters against the operation's declared schemas. Repeated keys and comma-separated
 * lists both fill array parameters (`status=a&status=b`, `status=a,b`); unknown parameters are ignored.
 */
export class QueryValidator {
  private readonly ajv: Ajv2020;
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: "array", useDefaults: true, removeAdditional: false });
    (typeof addFormats === "function" ? addFormats : (addFormats as unknown as { default: typeof addFormats }).default)(this.ajv);
    for (const schema of Object.values(SCHEMAS)) this.ajv.addSchema(schema);
  }

  private compile(spec: RouteSpec): ValidateFunction {
    let validate = this.compiled.get(spec.operationId);
    if (!validate) {
      const schema = {
        type: "object",
        properties: Object.fromEntries(spec.query.map((param) => [param.name, rewriteRefs(param.schema)])),
        required: spec.query.filter((param) => param.required).map((param) => param.name),
      };
      validate = this.ajv.compile(schema);
      this.compiled.set(spec.operationId, validate);
    }
    return validate;
  }

  parse(spec: RouteSpec, search: URLSearchParams): Record<string, unknown> {
    const candidate: Record<string, unknown> = {};
    for (const param of spec.query) {
      const values = search.getAll(param.name);
      if (values.length === 0) continue;
      candidate[param.name] = isArray(param) ? values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter((value) => value !== "") : values[0];
    }
    const validate = this.compile(spec);
    if (!validate(candidate)) {
      throw new ApiError({
        code: "VALIDATION_FAILED",
        status: 400,
        message: "Die Abfrageparameter sind ungültig.",
        details: {
          fieldErrors: (validate.errors ?? []).map((error) => ({
            path: error.instancePath ? error.instancePath.slice(1) : String((error.params as { missingProperty?: string }).missingProperty ?? "query"),
            message: error.message ?? "ungültig",
          })),
        },
      });
    }
    return candidate;
  }
}

function isArray(param: QueryParamSpec): boolean {
  return (param.schema as { type?: unknown }).type === "array";
}
