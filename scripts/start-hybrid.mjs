#!/usr/bin/env node
// Starts the built Control API in hybrid mode (real adapters from config/adapters.yaml, mock for the rest).
// Cross-platform replacement for `FRIDAY_DATA_MODE=hybrid node apps/control-api/dist/main.js`.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withLegacyEnv } from "./lib/legacy-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const main = resolve(root, "apps", "control-api", "dist", "main.js");
if (!existsSync(main)) {
  console.error("apps/control-api/dist/main.js fehlt. Zuerst bauen: pnpm build:app");
  process.exit(1);
}
const child = spawn(process.execPath, [main], {
  cwd: root,
  stdio: "inherit",
  env: { ...withLegacyEnv(), FRIDAY_DATA_MODE: "hybrid" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
