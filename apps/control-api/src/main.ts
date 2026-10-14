import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, isLoopback, loadConfig, type JarvisConfig } from "@jarvis/config";
import { createControlApi } from "./app";

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

/**
 * Without a configured owner password hash the dashboard would be unreachable. For mock data on loopback (the only
 * combination `@jarvis/auth` accepts) it falls back to the fixed dev accounts and says so loudly.
 */
export function withDevFallback(config: JarvisConfig, env: NodeJS.ProcessEnv): JarvisConfig {
  const explicit = env.JARVIS_AUTH_MODE;
  const wantsDev = explicit === "dev" || (explicit === undefined && config.auth.mode === "local" && !config.auth.ownerPasswordHash.configured);
  if (!wantsDev || config.auth.mode === "dev") return config;
  if (config.dataMode !== "mock" || !isLoopback(config.server.host)) return config;
  return {
    ...config,
    auth: { ...config.auth, mode: "dev" },
    warnings: [
      ...config.warnings,
      "Kein Owner-Passwort-Hash konfiguriert: Dev-Login aktiv (feste Konten dev-owner/-operator/-viewer, nur Mock-Daten auf Loopback). Für den Echtbetrieb JARVIS_OWNER_PASSWORD_HASH setzen.",
    ],
  };
}

export async function main(): Promise<void> {
  const root = findProjectRoot(process.cwd());
  loadDotEnv(root);
  const env = process.env;
  let config: JarvisConfig;
  try {
    config = withDevFallback(
      loadConfig({ configDir: env.JARVIS_CONFIG_DIR ?? join(root, "config"), cwd: root, env }),
      env,
    );
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }

  const { app, runtime } = await createControlApi({ config, env });
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
    dataMode: config.dataMode,
    authMode: config.auth.mode,
    webRoot: config.paths.webRoot,
    version: runtime.buildVersion,
  });
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && (fileURLToPath(import.meta.url) === entry || entry.endsWith("main.js") || entry.endsWith("main.ts"))) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
