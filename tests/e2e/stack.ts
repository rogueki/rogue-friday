import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { API_PORT } from "./support/constants";

/**
 * E2E stack for `pnpm test:e2e` (Playwright `webServer`): the BUILT Control API (`apps/control-api/dist/main.js`) in
 * mock mode with dev login on a temp data dir, serving a snapshot of `apps/web/out` (same origin, one port).
 * The snapshot keeps the run stable when another process rebuilds apps/web/out. Stays in the foreground until terminated.
 */
const root = resolve(import.meta.dirname, "..", "..");
const main = join(root, "apps", "control-api", "dist", "main.js");
const builtWebRoot = join(root, "apps", "web", "out");
// Build once when the artefacts are missing (or FRIDAY_E2E_BUILD=1); a present build is reused.
if (process.env.FRIDAY_E2E_BUILD === "1" || !existsSync(main) || !existsSync(join(builtWebRoot, "index.html"))) {
  console.log("[stack] pnpm build:app ...");
  execFileSync("pnpm", ["build:app"], { cwd: root, stdio: "inherit" });
}

const dir = resolve(process.env.FRIDAY_E2E_DIR ?? join(tmpdir(), "friday-e2e"));
rmSync(dir, { recursive: true, force: true });
const configDir = join(dir, "config");
for (const sub of ["config", "data", "logs"]) mkdirSync(join(dir, sub), { recursive: true });
const webRoot = join(dir, "web");
cpSync(builtWebRoot, webRoot, { recursive: true });
// Themes/layouts are seeded from the config dir; a missing dir would drop the built-in library.
cpSync(join(root, "config", "themes"), join(configDir, "themes"), { recursive: true });
cpSync(join(root, "config", "layouts"), join(configDir, "layouts"), { recursive: true });
writeFileSync(
  join(configDir, "dashboard.yaml"),
  [
    "dataMode: mock",
    "server:",
    "  host: 127.0.0.1",
    `  port: ${API_PORT}`,
    "paths:",
    `  dataDir: ${JSON.stringify(join(dir, "data").replaceAll("\\", "/"))}`,
    `  logDir: ${JSON.stringify(join(dir, "logs").replaceAll("\\", "/"))}`,
    `  webRoot: ${JSON.stringify(webRoot.replaceAll("\\", "/"))}`,
    "auth:",
    "  mode: dev",
    "dev:",
    "  scenarioConsole: true",
    "",
  ].join("\n"),
);

const logFd = openSync(join(dir, "control-api.log"), "w");
const api = spawn(process.execPath, [main], {
  cwd: root,
  stdio: ["ignore", logFd, logFd],
  env: { ...process.env, FRIDAY_CONFIG_DIR: configDir, FRIDAY_DATA_MODE: "mock", FRIDAY_AUTH_MODE: "dev", FRIDAY_PORT: String(API_PORT) },
});
api.on("exit", (code) => {
  console.error(`[stack] Control API beendet (Code ${String(code)}), Log: ${join(dir, "control-api.log")}`);
  process.exit(code ?? 1);
});
console.log(`[stack] Control API http://127.0.0.1:${API_PORT} (mock, dev login), Daten ${dir}`);
const shutdown = (): void => {
  api.removeAllListeners("exit");
  api.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
