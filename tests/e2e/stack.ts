import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { API_PORT } from "./support/constants";

/**
 * E2E stack for `pnpm test:e2e` (Playwright `webServer`): the BUILT e2e server (`apps/control-api/.e2e-dist/e2e-server.js`,
 * the shipped Control API plus the injected mock world; never part of a release) in mock mode with dev login on a temp data dir, serving a snapshot of `apps/web/out` (same origin, one port).
 * The snapshot keeps the run stable when another process rebuilds apps/web/out. Stays in the foreground until terminated.
 */
const root = resolve(import.meta.dirname, "..", "..");
const main = join(root, "apps", "control-api", ".e2e-dist", "e2e-server.js");
const builtWebRoot = join(root, "apps", "web", "out");

/**
 * Newest mtime (ms) below `dir`, or 0 when the directory is missing. Build outputs, dependencies and tests are
 * skipped so that only real sources decide whether a build is stale.
 */
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "dist", ".e2e-dist", "coverage"]);
function newestMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) newest = Math.max(newest, newestMtime(join(dir, entry.name)));
      continue;
    }
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    newest = Math.max(newest, statSync(join(dir, entry.name)).mtimeMs);
  }
  return newest;
}

const sources = [join(root, "apps", "web", "src"), join(root, "apps", "control-api", "src"), join(root, "apps", "control-api", "test-support"), join(root, "packages", "contracts", "schemas")];
for (const group of ["packages", "adapters"]) {
  const groupDir = join(root, group);
  if (!existsSync(groupDir)) continue;
  for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
    const src = join(groupDir, entry.name, "src");
    if (entry.isDirectory() && existsSync(src)) sources.push(src);
  }
}

const webIndex = join(builtWebRoot, "index.html");
const stale = existsSync(main) && existsSync(webIndex) && Math.min(statSync(main).mtimeMs, statSync(webIndex).mtimeMs) < Math.max(...sources.map(newestMtime));
// Build when artefacts are missing or older than the sources; FRIDAY_E2E_BUILD=1 forces a build and
// FRIDAY_E2E_REUSE_BUILD=1 skips the freshness check for a deliberately frozen build.
const rebuildStale = stale && process.env.FRIDAY_E2E_REUSE_BUILD !== "1";
if (rebuildStale) console.log("[stack] build older than sources, rebuilding ...");
// CI builds the app before the run (`pnpm build`); then only the e2e server bundle is missing.
const shippedServer = join(root, "apps", "control-api", "dist", "main.js");
const buildApp = process.env.FRIDAY_E2E_BUILD === "1" || !existsSync(shippedServer) || !existsSync(webIndex) || rebuildStale;
// pnpm is a .cmd shim on Windows, which execFileSync only finds through a shell.
const shell = process.platform === "win32";
if (buildApp) {
  console.log("[stack] pnpm build:app ...");
  execFileSync("pnpm", ["build:app"], { cwd: root, stdio: "inherit", shell });
}
if (buildApp || !existsSync(main)) {
  console.log("[stack] pnpm --filter @friday/control-api build:e2e ...");
  execFileSync("pnpm", ["--filter", "@friday/control-api", "build:e2e"], { cwd: root, stdio: "inherit", shell });
}

const dir = resolve(process.env.FRIDAY_E2E_DIR ?? join(tmpdir(), "friday-e2e"));
// A real registry layout with two skills that share one CalDAV account, so the skill account area has content.
const skillsFixture = join(root, "tests", "e2e", "fixtures", "skills");
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
  env: { ...process.env, FRIDAY_CONFIG_DIR: configDir, FRIDAY_DATA_MODE: "mock", FRIDAY_AUTH_MODE: "dev", FRIDAY_SKILLS_CATALOG_PATH: skillsFixture, FRIDAY_PORT: String(API_PORT) },
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
