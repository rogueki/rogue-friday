/**
 * Pure helpers for the schema-generated adapter configuration form (PLAN §42.2). The adapter delivers a JSON Schema
 * (draft 2020-12 subset: string / number / integer / boolean / enum / object / array); the form is derived from it.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface FieldSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  writeOnly?: boolean;
  readOnly?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, FieldSchema>;
  required?: string[];
  items?: FieldSchema;
  oneOf?: unknown[];
  anyOf?: unknown[];
  allOf?: unknown[];
}

export type FieldKind = "string" | "secret" | "number" | "integer" | "boolean" | "enum" | "object" | "array" | "json";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function asFieldSchema(value: unknown): FieldSchema {
  return isRecord(value) ? (value as FieldSchema) : {};
}

function primaryType(schema: FieldSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== "null");
  return schema.type;
}

/** A field is a secret when the server declares it so (`secretFields`) or the schema marks it write-only / `format: password`. */
export function isSecretField(name: string, schema: FieldSchema, secretNames: ReadonlySet<string>): boolean {
  return secretNames.has(name) || schema.writeOnly === true || schema.format === "password";
}

export function fieldKind(name: string, schema: FieldSchema, secretNames: ReadonlySet<string> = new Set()): FieldKind {
  if (schema.oneOf || schema.anyOf || schema.allOf) return "json";
  if (isSecretField(name, schema, secretNames)) return "secret";
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "enum";
  switch (primaryType(schema)) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "object":
      return schema.properties ? "object" : "json";
    case "array":
      return "array";
    default:
      return "json";
  }
}

export function defaultValueFor(schema: FieldSchema): unknown {
  if (schema.default !== undefined) return structuredCloneSafe(schema.default);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  switch (primaryType(schema)) {
    case "string":
      return "";
    case "number":
    case "integer":
      return schema.minimum ?? 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (isSecretField(key, child, new Set())) continue;
        out[key] = defaultValueFor(child);
      }
      return out;
    }
    default:
      return null;
  }
}

function structuredCloneSafe<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Names of the properties a schema declares as secrets (plus the server-declared ones). Order follows the schema. */
export function secretPropertyNames(schema: FieldSchema, serverSecrets: Iterable<string> = []): string[] {
  const declared = new Set(serverSecrets);
  const names: string[] = [];
  for (const [key, child] of Object.entries(schema.properties ?? {})) if (isSecretField(key, child, declared)) names.push(key);
  for (const key of declared) if (!names.includes(key)) names.push(key);
  return names;
}

/** Removes secret properties so a configuration object can never carry a secret back to the server inside `config`. */
export function stripSecrets(config: Record<string, unknown>, schema: FieldSchema, serverSecrets: Iterable<string> = []): Record<string, unknown> {
  const secrets = new Set(secretPropertyNames(schema, serverSecrets));
  return Object.fromEntries(Object.entries(config).filter(([key]) => !secrets.has(key)));
}

export interface FieldError {
  path: string;
  message: string;
}

/** Light-weight validation of a value against the schema subset the form can render. Returns one message per violating path. */
export function validateConfig(schema: FieldSchema, value: unknown, secretNames: ReadonlySet<string> = new Set(), path = ""): FieldError[] {
  const errors: FieldError[] = [];
  const kind = fieldKind(path.split(".").pop() ?? "", schema, secretNames);
  const add = (message: string): void => void errors.push({ path, message });

  if (kind === "object") {
    const record = isRecord(value) ? value : {};
    for (const key of schema.required ?? []) {
      const child = schema.properties?.[key];
      if (child && isSecretField(key, child, secretNames)) continue; // write-only: its presence is tracked by the server
      const present = record[key];
      if (present === undefined || present === null || present === "") errors.push({ path: path ? `${path}.${key}` : key, message: "Pflichtfeld" });
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (isSecretField(key, child, secretNames)) continue;
      const childValue = record[key];
      if (childValue === undefined || childValue === null || childValue === "") continue;
      errors.push(...validateConfig(child, childValue, secretNames, path ? `${path}.${key}` : key));
    }
    return errors;
  }
  if (kind === "array") {
    if (!Array.isArray(value)) return errors;
    if (schema.minItems !== undefined && value.length < schema.minItems) add(`Mindestens ${schema.minItems} Einträge`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`Höchstens ${schema.maxItems} Einträge`);
    const itemSchema = asFieldSchema(schema.items);
    value.forEach((item, index) => errors.push(...validateConfig(itemSchema, item, secretNames, `${path}[${index}]`)));
    return errors;
  }
  if (kind === "number" || kind === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [...errors, { path, message: "Zahl erwartet" }];
    if (kind === "integer" && !Number.isInteger(value)) add("Ganzzahl erwartet");
    if (schema.minimum !== undefined && value < schema.minimum) add(`Mindestens ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) add(`Höchstens ${schema.maximum}`);
    return errors;
  }
  if (kind === "string") {
    if (typeof value !== "string") return [...errors, { path, message: "Text erwartet" }];
    if (schema.minLength !== undefined && value.length < schema.minLength) add(`Mindestens ${schema.minLength} Zeichen`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add(`Höchstens ${schema.maxLength} Zeichen`);
    if (schema.pattern !== undefined) {
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) add("Format passt nicht");
      } catch {
        // an invalid pattern in the adapter's schema must not block saving
      }
    }
    return errors;
  }
  if (kind === "enum") {
    if (!(schema.enum ?? []).some((option) => option === value)) add("Wert nicht erlaubt");
  }
  return errors;
}

export function errorFor(errors: readonly FieldError[], path: string): string | undefined {
  return errors.find((error) => error.path === path)?.message;
}

/** Deep equality for JSON values (key order independent). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const l = left[key];
    const r = right[key];
    if (l === undefined && r === undefined) continue;
    if (!jsonEqual(l, r)) return false;
  }
  return true;
}
