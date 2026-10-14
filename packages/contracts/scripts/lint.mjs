// Lints OpenAPI (Redocly) and AsyncAPI (@asyncapi/parser); fails on errors, prints warnings.
import path from "node:path";
import { parseAsyncapi } from "./lib/asyncapi.mjs";
import { paths, readJson, readYaml } from "./lib/contract.mjs";
import { runRedocly } from "./lib/redocly.mjs";

export async function lintAll() {
  const failures = [];
  const notes = [];

  const redocly = runRedocly(["lint", paths.openapi]);
  if (redocly.status !== 0) failures.push(`openapi: redocly lint failed\n${redocly.stdout}${redocly.stderr}`);
  else if (/warning/i.test(redocly.stdout)) notes.push(redocly.stdout.trim());

  const { document, diagnostics } = await parseAsyncapi(paths.asyncapi);
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  if (!document || errors.length > 0) {
    failures.push(`asyncapi: ${errors.map((d) => `[${d.code}] ${d.path}: ${d.message}`).join("\n")}`);
  }
  if (warnings.length > 0) {
    notes.push(
      `asyncapi warnings:\n${warnings.map((d) => `  [${d.code}] ${d.path}: ${d.message}`).join("\n")}`,
    );
  }

  const openapi = readYaml(paths.openapi);
  const asyncapi = readYaml(paths.asyncapi);
  const pkg = readJson(path.join(paths.root, "package.json"));
  const versions = {
    "package.json": pkg.version,
    openapi: openapi.info?.version,
    asyncapi: asyncapi.info?.version,
  };
  if (new Set(Object.values(versions)).size !== 1) {
    failures.push(
      `version mismatch: ${JSON.stringify(versions)} (the contract version must be identical everywhere)`,
    );
  }
  if (!/^3\.1\.\d+$/.test(openapi.openapi)) failures.push(`openapi must be 3.1.x, found ${openapi.openapi}`);

  const operations = Object.values(openapi.paths).reduce(
    (count, item) => count + Object.keys(item).length,
    0,
  );
  return { failures, notes, operations, asyncapiVersion: document?.version?.() };
}

if (process.argv[1]?.endsWith("lint.mjs")) {
  const { failures, notes, operations, asyncapiVersion } = await lintAll();
  for (const note of notes) console.warn(note);
  if (failures.length > 0) {
    console.error(failures.join("\n\n"));
    console.error("\nlint: FAILED");
    process.exit(1);
  }
  console.log(`lint: OpenAPI valid (${operations} operations), AsyncAPI ${asyncapiVersion} valid`);
}
