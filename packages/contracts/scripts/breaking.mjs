// Compares the current contract with baseline/ (last released snapshot) and fails on breaking changes
// unless info.version has a higher major version.
import fs from "node:fs";
import path from "node:path";
import { detectBreaking } from "./lib/breaking.mjs";
import { loadSchemas, paths, readYaml } from "./lib/contract.mjs";

const baselinePaths = {
  openapi: path.join(paths.baseline, "openapi", "friday-api.yaml"),
  asyncapi: path.join(paths.baseline, "asyncapi", "friday-events.yaml"),
  schemas: path.join(paths.baseline, "schemas"),
};

const toSchemaMap = (schemas) => new Map(schemas.map(({ schema }) => [schema.$id, schema]));

export function runBreakingCheck() {
  if (!fs.existsSync(baselinePaths.openapi)) {
    return {
      ok: false,
      error: "baseline/ is missing; create it once with `pnpm --filter @friday/contracts baseline:update`.",
      changes: [],
    };
  }
  const baseline = {
    openapi: readYaml(baselinePaths.openapi),
    asyncapi: readYaml(baselinePaths.asyncapi),
    schemas: toSchemaMap(loadSchemas(baselinePaths.schemas)),
  };
  const current = {
    openapi: readYaml(paths.openapi),
    asyncapi: readYaml(paths.asyncapi),
    schemas: toSchemaMap(loadSchemas()),
  };
  return detectBreaking(baseline, current);
}

if (process.argv[1]?.endsWith("breaking.mjs")) {
  const result = runBreakingCheck();
  if (result.error) {
    console.error(`breaking: ${result.error}`);
    process.exit(1);
  }
  if (result.changes.length === 0) {
    console.log("breaking: no breaking changes against baseline");
  } else if (result.majorBumped) {
    console.log(
      `breaking: ${result.changes.length} breaking change(s) accepted (major ${result.baselineMajor} -> ${result.currentMajor})`,
    );
  } else {
    for (const change of result.changes) console.error(`  [${change.kind}] ${change.message}`);
    console.error(
      `\nbreaking: ${result.changes.length} breaking change(s) without a major version bump (info.version major is still ${result.currentMajor}).`,
    );
    process.exit(1);
  }
}
