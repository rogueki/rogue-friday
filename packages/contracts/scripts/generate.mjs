// Generates the typed SDK sources from the contract:
//   openapi.ts  (openapi-typescript over the bundled OpenAPI document)
//   models.ts   (json-schema-to-typescript over every JSON Schema, one export per schema title)
//   events.ts   (event type union / map derived from the AsyncAPI document)
//   schemas.ts  (all JSON Schemas as data, so runtime packages can validate without file system access)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { bundleOpenapi } from "./bundle.mjs";
import { loadSchemas, paths, readContractVersion, readText, parseYaml } from "./lib/contract.mjs";

const require = createRequire(import.meta.url);
const HEADER =
  "// GENERATED — do not edit. Source of truth: packages/contracts (run `pnpm contracts:generate`).\n";
const toLf = (text) => text.replace(/\r\n/g, "\n");

/** Replaces cross-file $refs by in-document pointers into a shared $defs table. */
export function buildCombinedSchema(schemas) {
  const titleByPath = new Map(schemas.map(({ rel, schema }) => [rel, schema.title]));
  const rewrite = (node, ownTitle) => {
    if (Array.isArray(node)) return node.map((n) => rewrite(n, ownTitle));
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        if (value.startsWith("#/$defs/")) {
          out[key] = `#/$defs/${ownTitle}/$defs/${value.slice("#/$defs/".length)}`;
        } else {
          const title = titleByPath.get(value.replace(/^\.\.\//, ""));
          if (!title) throw new Error(`unresolved $ref ${value} in ${ownTitle}`);
          out[key] = `#/$defs/${title}`;
        }
      } else if (key === "minItems" || key === "maxItems") {
        // Tuple types ([T, ...T[]]) are unusable for callers; the constraint is enforced by AJV at runtime.
      } else {
        out[key] = rewrite(value, ownTitle);
      }
    }
    return out;
  };
  const sorted = [...schemas].sort((a, b) => a.schema.title.localeCompare(b.schema.title));
  const defs = {};
  for (const { schema } of sorted) {
    const { $id: _id, $schema: _dialect, ...rest } = schema;
    defs[schema.title] = rewrite(rest, schema.title);
  }
  return {
    title: "JarvisModelMap",
    description: "Maps every contract schema title to its generated type.",
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      sorted.map(({ schema }) => [schema.title, { $ref: `#/$defs/${schema.title}` }]),
    ),
    required: sorted.map(({ schema }) => schema.title),
    $defs: defs,
  };
}

async function generateModels(schemas) {
  const { compile } = require("json-schema-to-typescript");
  const ts = await compile(buildCombinedSchema(schemas), "JarvisModelMap", {
    bannerComment: "",
    additionalProperties: false,
    unreachableDefinitions: false,
    declareExternallyReferenced: true,
    strictIndexSignatures: false,
    format: true,
    style: { singleQuote: false, printWidth: 110, semi: true, trailingComma: "all" },
  });
  return `${HEADER}/* eslint-disable */\n${toLf(ts)}`;
}

async function generateOpenapi(bundled) {
  const { default: openapiTS, astToString } = await import("openapi-typescript");
  const ast = await openapiTS(bundled, { alphabetize: true });
  return `${HEADER}/* eslint-disable */\n${toLf(astToString(ast))}`;
}

function generateEvents(schemas) {
  const asyncapi = parseYaml(readText(paths.asyncapi));
  const titleByPath = new Map(schemas.map(({ rel, schema }) => [rel, schema.title]));
  const schemaIdByTitle = new Map(schemas.map(({ schema }) => [schema.title, schema.$id]));
  const entries = Object.values(asyncapi.components.messages)
    .filter((message) => String(message.name).startsWith("jarvis."))
    .map((message) => {
      const dataRef = message.payload.allOf.find((part) => part.properties?.data)?.properties.data.$ref;
      const title = titleByPath.get(String(dataRef).replace(/^\.\.\/schemas\//, ""));
      if (!title) throw new Error(`event ${message.name}: unresolved data schema ${dataRef}`);
      return { type: message.name, title };
    })
    .sort((a, b) => a.type.localeCompare(b.type));
  const imports = [...new Set(entries.map((e) => e.title))].sort();
  const lines = [HEADER, "/* eslint-disable */"];
  lines.push(`import type { EventEnvelope, ${imports.join(", ")} } from "./models";`, "");
  lines.push("export const JARVIS_EVENT_TYPES = [");
  for (const e of entries) lines.push(`  "${e.type}",`);
  lines.push("] as const;", "", "export type JarvisEventType = (typeof JARVIS_EVENT_TYPES)[number];", "");
  lines.push(
    "/** Event type -> payload type (`data` of the envelope). */",
    "export interface JarvisEventMap {",
  );
  for (const e of entries) lines.push(`  "${e.type}": ${e.title};`);
  lines.push("}", "");
  lines.push(
    "/** Event type -> $id of the JSON Schema that validates `data`. */",
    "export const JARVIS_EVENT_DATA_SCHEMA_IDS: Readonly<Record<JarvisEventType, string>> = {",
  );
  for (const e of entries) lines.push(`  "${e.type}": "${schemaIdByTitle.get(e.title)}",`);
  lines.push("};", "");
  lines.push(
    "/** CloudEvents-inspired envelope; `data` is typed per event type. */",
    'export type JarvisEventEnvelope<T = unknown> = Omit<EventEnvelope, "data"> & { data: T };',
    "",
    "/** Discriminated union of all typed events (narrow on `type`). */",
    "export type JarvisEvent<K extends JarvisEventType = JarvisEventType> = {",
    "  [P in K]: JarvisEventEnvelope<JarvisEventMap[P]> & { type: P };",
    "}[K];",
    "",
  );
  return lines.join("\n");
}

function generateSchemas(schemas) {
  const byId = [...schemas].sort((a, b) => a.schema.$id.localeCompare(b.schema.$id));
  const byTitle = [...schemas].sort((a, b) => a.schema.title.localeCompare(b.schema.title));
  const lines = [HEADER, "/* eslint-disable */", ""];
  lines.push(
    "/** Wire contract version (packages/contracts/package.json, info.version of both API documents). */",
    `export const CONTRACT_VERSION = "${readContractVersion()}" as const;`,
    "",
  );
  lines.push("/** JSON Schema title -> $id. */", "export const SCHEMA_IDS = {");
  for (const { schema } of byTitle) lines.push(`  ${schema.title}: "${schema.$id}",`);
  lines.push(
    "} as const;",
    "",
    "export type SchemaName = keyof typeof SCHEMA_IDS;",
    "export type SchemaId = (typeof SCHEMA_IDS)[SchemaName];",
    "",
  );
  lines.push("export type JsonSchemaDocument = Readonly<Record<string, unknown>>;", "");
  lines.push(
    "/** Every contract schema (JSON Schema 2020-12), keyed by $id. */",
    "export const SCHEMAS: Readonly<Record<string, JsonSchemaDocument>> = {",
  );
  for (const { schema } of byId) lines.push(`  "${schema.$id}": ${JSON.stringify(schema)},`);
  lines.push("};", "");
  return lines.join("\n");
}

/** Generates all SDK sources into outDir and returns the file map. */
export async function generateAll(outDir = paths.sdkGenerated) {
  const schemas = loadSchemas();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-bundle-"));
  let bundled;
  try {
    bundled = bundleOpenapi(path.join(tmp, "jarvis-api.bundled.yaml"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const files = {
    "openapi.ts": await generateOpenapi(bundled),
    "models.ts": await generateModels(schemas),
    "events.ts": generateEvents(schemas),
    "schemas.ts": generateSchemas(schemas),
  };
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), content);
  return files;
}

if (process.argv[1]?.endsWith("generate.mjs")) {
  bundleOpenapi();
  const files = await generateAll();
  console.log(
    `generate: wrote ${Object.keys(files).join(", ")} to ${path.relative(paths.root, paths.sdkGenerated)}`,
  );
}
