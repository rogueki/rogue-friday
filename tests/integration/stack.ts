import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hashPassword } from "../../packages/auth/src/index";
import { readDashboardExample, renderAdaptersExample } from "../../scripts/fake-upstreams/example-config";
import { startFakeUpstreams } from "../../scripts/fake-upstreams/lib";
import { API_PORT, OWNER_PASSWORD } from "./constants";

/**
 * Integration stack for `pnpm test:integration` (Playwright `webServer`): fake Hermes/voice/Qwen upstreams on the
 * installer ports, a config directory generated from the shipped hybrid examples, and the BUILT Control API
 * (`apps/control-api/dist/main.js`, serving `apps/web/out`) in hybrid mode. Stays in the foreground until terminated.
 */
const root = resolve(import.meta.dirname, "..", "..");
const main = join(root, "apps", "control-api", "dist", "main.js");
const builtWebRoot = join(root, "apps", "web", "out");
for (const [label, path] of [["Control API (pnpm build:app)", main], ["Web-Build (pnpm build:app)", join(builtWebRoot, "index.html")]] as const) {
  if (!existsSync(path)) throw new Error(`${label} fehlt: ${path}`);
}

const dir = resolve(process.env.JARVIS_INTEGRATION_DIR ?? join(tmpdir(), "jarvis-integration"));
rmSync(dir, { recursive: true, force: true });
const configDir = join(dir, "config");
for (const sub of ["config", "data", "logs", "secrets"]) mkdirSync(join(dir, sub), { recursive: true });

// Serve a snapshot of the web build so a rebuild of apps/web/out during the run cannot change the pages under test.
const webRoot = join(dir, "web");
cpSync(builtWebRoot, webRoot, { recursive: true });

const keyFile = join(dir, "secrets", "hermes_api.key");
const upstreams = await startFakeUpstreams({ keyFile, log: (line) => console.log(`[upstreams] ${line}`) });

writeFileSync(join(configDir, "dashboard.yaml"), readDashboardExample("hybrid").replace("webRoot: ../apps/web/out", `webRoot: ${JSON.stringify(webRoot.replaceAll("\\", "/"))}`));
// Shipped breaker: 5 failures / 30 s reopen. The run uses 3 / 5 s so recovery after an outage is observable in seconds.
writeFileSync(join(configDir, "adapters.yaml"), renderAdaptersExample("hybrid", { breaker: { failureThreshold: 3, resetAfterMs: 5000 } }));

const logFd = openSync(join(dir, "control-api.log"), "w");
const api = spawn(process.execPath, [main], {
  cwd: root,
  stdio: ["ignore", logFd, logFd],
  env: {
    ...process.env,
    JARVIS_CONFIG_DIR: configDir,
    JARVIS_DATA_MODE: "hybrid",
    JARVIS_PORT: String(API_PORT),
    JARVIS_OWNER_PASSWORD_HASH: await hashPassword(OWNER_PASSWORD),
    HERMES_API_KEY_FILE: keyFile,
    JARVIS_STORAGE_PATH: process.platform === "win32" ? "C:/" : "/",
  },
});
api.on("exit", (code) => {
  console.error(`[stack] Control API beendet (Code ${String(code)}), Log: ${join(dir, "control-api.log")}`);
  void upstreams.close().finally(() => process.exit(code ?? 1));
});

console.log(`[stack] Control API http://127.0.0.1:${API_PORT} (hybrid), Konfiguration ${configDir}`);
let closing = false;
const shutdown = (): void => {
  if (closing) return;
  closing = true;
  api.removeAllListeners("exit");
  api.kill("SIGTERM");
  void upstreams.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
