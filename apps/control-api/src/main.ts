import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ConfigError, legacyEnvWarning, loadConfig, normalizeLegacyEnv, type FridayConfig } from "@friday/config";
import { createControlApi } from "./app";
import type { RuntimeSimulation } from "./runtime/simulation";

/** The monorepo root (the folder with `pnpm-workspace.yaml`), or the current directory for a deployed bundle. */
export function findProjectRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function loadDotEnv(root: string): void {
  for (const candidate of [join(root, ".env"), join(process.cwd(), ".env")]) {
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch (error) {
        console.error(`Konnte ${candidate} nicht laden: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

export async function main(options: { simulation?: RuntimeSimulation } = {}): Promise<void> {
  const root = findProjectRoot(process.cwd());
  loadDotEnv(root);
  const { env, legacy } = normalizeLegacyEnv(process.env);
  if (legacy.length > 0) console.warn(legacyEnvWarning(legacy));
  let config: FridayConfig;
  try {
    config = loadConfig({ configDir: env.FRIDAY_CONFIG_DIR ?? join(root, "config"), cwd: root, env });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }

  const { app, runtime } = await createControlApi({ config, env, ...(options.simulation ? { simulation: options.simulation } : {}) });
  const { host, port } = config.server;

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    runtime.logger.info("Beende Control API", { signal });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGBREAK", () => void stop("SIGBREAK"));

  await app.listen(port, host);
  runtime.logger.info("Control API läuft", {
    url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
    dataMode: runtime.config.dataMode,
    authMode: config.auth.mode,
    webRoot: config.paths.webRoot,
    version: runtime.buildVersion,
  });
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (/[\\/]main\.[jt]s$/.test(entry)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
