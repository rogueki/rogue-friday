import { SCHEMAS, SCHEMA_IDS, type SchemaName } from "@friday/sdk";

/**
 * Interpreting JSON Schema validator (draft 2020-12 subset used by the contract) for imports in the browser.
 * Ajv would be the obvious choice, but it compiles schemas with `new Function`, which the Control API's strict CSP
 * (`script-src 'self'`, no eval) forbids. This validator only walks the schema data from the `@friday/sdk` registry.
 */

export interface SchemaIssue {
  path: string;
  message: string;
}

type Schema = Record<string, unknown>;

interface Context {
  /** `$id` of the document the current schema belongs to (relative `$ref`s resolve against it). */
  baseId: string;
  root: Schema;
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const isRecord = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value);

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    default:
      return true;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(ref: string, context: Context): { schema: Schema; context: Context } | null {
  if (ref.startsWith("#")) {
    let node: unknown = context.root;
    for (const part of ref.slice(1).split("/").filter(Boolean)) {
      node = isRecord(node) ? node[part.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
    }
    return isRecord(node) ? { schema: node, context } : null;
  }
  let target: URL;
  try {
    target = new URL(ref, context.baseId);
  } catch {
    return null;
  }
  const hash = target.hash;
  target.hash = "";
  const document = SCHEMAS[target.href];
  if (!document) return null;
  const root = document as Schema;
  const next: Context = { baseId: target.href, root };
  if (!hash) return { schema: root, context: next };
  return resolveRef(hash, next);
}

function walk(schema: unknown, value: unknown, context: Context, path: string, issues: SchemaIssue[]): void {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    issues.push({ path, message: "nicht erlaubt" });
    return;
  }
  if (!isRecord(schema)) return;
  const at = path || "/";

  if (typeof schema.$ref === "string") {
    const resolved = resolveRef(schema.$ref, context);
    if (!resolved) issues.push({ path: at, message: `Schema-Referenz nicht auflösbar: ${schema.$ref}` });
    else walk(resolved.schema, value, resolved.context, path, issues);
  }

  if (schema.const !== undefined && !deepEqual(schema.const, value)) issues.push({ path: at, message: `muss ${JSON.stringify(schema.const)} sein` });
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(option, value))) {
    issues.push({ path: at, message: `muss einer von ${schema.enum.map((option) => JSON.stringify(option)).join(", ")} sein` });
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((type) => typeMatches(type, value))) {
      issues.push({ path: at, message: `muss vom Typ ${types.join(" oder ")} sein` });
      return;
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((branch) => {
      const branchIssues: SchemaIssue[] = [];
      walk(branch, value, context, path, branchIssues);
      return branchIssues.length === 0;
    });
    if (!ok) issues.push({ path: at, message: "passt zu keiner der erlaubten Varianten" });
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((branch) => {
      const branchIssues: SchemaIssue[] = [];
      walk(branch, value, context, path, branchIssues);
      return branchIssues.length === 0;
    }).length;
    if (matches !== 1) issues.push({ path: at, message: matches === 0 ? "passt zu keiner der erlaubten Varianten" : "ist mehrdeutig" });
  }
  if (Array.isArray(schema.allOf)) for (const branch of schema.allOf) walk(branch, value, context, path, issues);

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && [...value].length < schema.minLength) issues.push({ path: at, message: `mindestens ${schema.minLength} Zeichen` });
    if (typeof schema.maxLength === "number" && [...value].length > schema.maxLength) issues.push({ path: at, message: `höchstens ${schema.maxLength} Zeichen` });
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) issues.push({ path: at, message: `entspricht nicht dem Muster ${schema.pattern}` });
      } catch {
        // a pattern JS cannot compile is a schema problem, not an import problem
      }
    }
    if (schema.format === "date-time" && !DATE_TIME.test(value)) issues.push({ path: at, message: "kein gültiger Zeitstempel (date-time)" });
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) issues.push({ path: at, message: `mindestens ${schema.minimum}` });
    if (typeof schema.maximum === "number" && value > schema.maximum) issues.push({ path: at, message: `höchstens ${schema.maximum}` });
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push({ path: at, message: `mindestens ${schema.minItems} Einträge` });
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push({ path: at, message: `höchstens ${schema.maxItems} Einträge` });
    if (schema.items !== undefined) value.forEach((item, index) => walk(schema.items, item, context, `${path}/${index}`, issues));
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) issues.push({ path: at, message: `mindestens ${schema.minProperties} Eigenschaften` });
    for (const key of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
      if (!(key in value)) issues.push({ path: `${path}/${key}`, message: "Pflichtfeld fehlt" });
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const key of keys) {
      const child = value[key];
      if (key in properties) walk(properties[key], child, context, `${path}/${key}`, issues);
      else if (schema.additionalProperties === false) issues.push({ path: `${path}/${key}`, message: "unbekannte Eigenschaft" });
      else if (isRecord(schema.additionalProperties)) walk(schema.additionalProperties, child, context, `${path}/${key}`, issues);
      if (schema.propertyNames !== undefined) {
        const nameIssues: SchemaIssue[] = [];
        walk(schema.propertyNames, key, context, path, nameIssues);
        for (const issue of nameIssues) issues.push({ path: `${path}/${key}`, message: `Schlüssel ${issue.message}` });
      }
    }
  }
}

export interface SchemaValidation {
  valid: boolean;
  errors: SchemaIssue[];
}

/** Validates `value` against a contract schema addressed by title (e.g. "Theme", "Layout", "SettingsExport"). */
export function validateContract(name: SchemaName, value: unknown): SchemaValidation {
  const id = SCHEMA_IDS[name];
  const root = SCHEMAS[id] as Schema | undefined;
  if (!root) return { valid: false, errors: [{ path: "/", message: `Unbekanntes Schema ${name}` }] };
  const errors: SchemaIssue[] = [];
  walk(root, value, { baseId: id, root }, "", errors);
  return { valid: errors.length === 0, errors };
}

/** Validates against a schema object that is not part of the registry (e.g. an adapter's `configSchema`). */
export function validateAgainstSchema(schema: unknown, value: unknown): SchemaValidation {
  const errors: SchemaIssue[] = [];
  const root = isRecord(schema) ? schema : {};
  walk(root, value, { baseId: "https://friday.local/schemas/adapter/config.schema.json", root }, "", errors);
  return { valid: errors.length === 0, errors };
}

export function formatIssues(issues: readonly SchemaIssue[], limit = 6): string[] {
  const lines = issues.slice(0, limit).map((issue) => `${issue.path}: ${issue.message}`);
  if (issues.length > limit) lines.push(`… und ${issues.length - limit} weitere`);
  return lines;
}
