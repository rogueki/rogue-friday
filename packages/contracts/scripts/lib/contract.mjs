// Shared helpers for the contract tooling (lint, validate, bundle, generate, breaking).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const YAML = require("yaml");

export const CONTRACTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO_ROOT = path.resolve(CONTRACTS_ROOT, "..", "..");
export const paths = {
  root: CONTRACTS_ROOT,
  schemas: path.join(CONTRACTS_ROOT, "schemas"),
  openapi: path.join(CONTRACTS_ROOT, "openapi", "jarvis-api.yaml"),
  asyncapi: path.join(CONTRACTS_ROOT, "asyncapi", "jarvis-events.yaml"),
  examples: path.join(CONTRACTS_ROOT, "examples"),
  baseline: path.join(CONTRACTS_ROOT, "baseline"),
  dist: path.join(CONTRACTS_ROOT, "dist"),
  bundledOpenapi: path.join(CONTRACTS_ROOT, "dist", "jarvis-api.bundled.yaml"),
  sdkGenerated: path.join(REPO_ROOT, "packages", "generated-sdk", "src", "generated"),
};

export const toPosix = (p) => p.split(path.sep).join("/");

export function walkFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out.sort();
}

export const readText = (file) => fs.readFileSync(file, "utf8");
export const readJson = (file) => JSON.parse(readText(file));
export const readYaml = (file) => YAML.parse(readText(file));
export const parseYaml = (text) => YAML.parse(text);
export const stringifyYaml = (value) => YAML.stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });

/** @returns {{ file: string, rel: string, schema: any }[]} every JSON Schema file below schemas/ */
export function loadSchemas(dir = paths.schemas) {
  return walkFiles(dir, (f) => f.endsWith(".schema.json")).map((file) => ({
    file,
    rel: toPosix(path.relative(dir, file)),
    schema: readJson(file),
  }));
}

export function readContractVersion() {
  const pkg = readJson(path.join(CONTRACTS_ROOT, "package.json"));
  return pkg.version;
}

export function readApiMajor(openapi) {
  const major = Number.parseInt(String(openapi?.info?.version ?? "0").split(".")[0] ?? "0", 10);
  return Number.isNaN(major) ? 0 : major;
}

export function exampleFiles() {
  return walkFiles(paths.examples, (f) => f.endsWith(".json") && path.basename(f) !== "index.json");
}
