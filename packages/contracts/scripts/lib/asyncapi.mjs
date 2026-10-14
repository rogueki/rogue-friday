import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readText } from "./contract.mjs";

const require = createRequire(import.meta.url);
const { Parser } = require("@asyncapi/parser");

const SEVERITY = ["error", "warning", "info", "hint"];

/**
 * Parses an AsyncAPI document (resolving relative $refs to the JSON schema files).
 * @returns {Promise<{ document: any, diagnostics: { severity: string, code: string|number, message: string, path: string }[] }>}
 */
export async function parseAsyncapi(file, text = readText(file)) {
  const parser = new Parser();
  const { document, diagnostics } = await parser.parse(text, { source: pathToFileURL(file).href });
  return {
    document,
    diagnostics: diagnostics.map((d) => ({
      severity: SEVERITY[d.severity] ?? String(d.severity),
      code: d.code,
      message: d.message,
      path: (d.path ?? []).join("/"),
    })),
  };
}
