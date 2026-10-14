import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { paths } from "./contract.mjs";

const require = createRequire(import.meta.url);
const REDOCLY_BIN = path.join(path.dirname(require.resolve("@redocly/cli/package.json")), "bin", "cli.js");

/** Runs the Redocly CLI through the current Node binary (no .cmd shims, works on Windows). */
export function runRedocly(args, { inherit = false } = {}) {
  const result = spawnSync(process.execPath, [REDOCLY_BIN, ...args], {
    cwd: paths.root,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
