import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { SCHEMAS, SCHEMA_IDS, type SchemaId, type SchemaName } from "./generated/schemas";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T = unknown> {
  valid: boolean;
  errors: ValidationIssue[];
  /** The input, typed as T when valid. */
  data?: T;
}

export interface SchemaValidator {
  /** Validates `data` against a schema, addressed by `$id` or by title (e.g. "Task"). */
  validate<T = unknown>(schema: SchemaId | SchemaName | (string & {}), data: unknown): ValidationResult<T>;
  has(schema: string): boolean;
}

const toIssues = (errors: ErrorObject[] | null | undefined): ValidationIssue[] =>
  (errors ?? []).map((error) => ({ path: error.instancePath || "/", message: error.message ?? "invalid" }));

/** AJV 2020-12 over the embedded schema registry; works in the browser, the API and tests without file system access. */
export function createSchemaValidator(): SchemaValidator {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  // ajv-formats ships a CJS default export; interop differs between bundlers.
  (typeof addFormats === "function"
    ? addFormats
    : (addFormats as unknown as { default: typeof addFormats }).default)(ajv);
  for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
  const compiled = new Map<string, ValidateFunction>();

  const resolve = (schema: string): string =>
    schema in SCHEMA_IDS ? SCHEMA_IDS[schema as SchemaName] : schema;
  const lookup = (schema: string): ValidateFunction => {
    const id = resolve(schema);
    let fn = compiled.get(id);
    if (!fn) {
      fn = ajv.getSchema(id);
      if (!fn) throw new Error(`Unknown contract schema: ${schema}`);
      compiled.set(id, fn);
    }
    return fn;
  };

  return {
    validate<T = unknown>(schema: string, data: unknown): ValidationResult<T> {
      const fn = lookup(schema);
      const valid = fn(data) as boolean;
      return valid ? { valid, errors: [], data: data as T } : { valid, errors: toIssues(fn.errors) };
    },
    has: (schema) => resolve(schema) in SCHEMAS,
  };
}
