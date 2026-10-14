/**
 * Read-only smoke test of the three Hermes adapters against a real Hermes instance (nothing is created or changed).
 *
 *   HERMES_API_KEY=... pnpm --filter @jarvis/adapter-hermes smoke
 *
 * Environment (all optional):
 *   HERMES_API_URL            default http://127.0.0.1:43693
 *   HERMES_DASHBOARD_URL      default http://127.0.0.1:43691
 *   HERMES_API_KEY            API_SERVER_KEY (or HERMES_API_KEY_FILE = path of the key file)
 *   HERMES_DASHBOARD_TOKEN    fixed dashboard token (default: scraped from the dashboard HTML)
 *   HERMES_BOARDS             comma separated board slugs, default "default"
 */
import { readFile } from "node:fs/promises";
import { createCorrelationId } from "@jarvis/sdk";
import {
  createMemoryLogger,
  normalizeError,
  systemClock,
  type AdapterContext,
  type JarvisAdapter,
} from "@jarvis/adapter-core";
import { HermesActivityAdapter, HermesAgentsAdapter, HermesTasksAdapter } from "../src";

const env = process.env;
const apiKey =
  env.HERMES_API_KEY ??
  (env.HERMES_API_KEY_FILE ? (await readFile(env.HERMES_API_KEY_FILE, "utf8")).trim() : undefined);
const dashboardToken = env.HERMES_DASHBOARD_TOKEN;
const config = {
  apiBaseUrl: env.HERMES_API_URL ?? "http://127.0.0.1:43693",
  dashboardBaseUrl: env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:43691",
  boards: (env.HERMES_BOARDS ?? "default").split(",").map((board) => board.trim()),
  dashboardAuth: dashboardToken ? "secret" : "scrape",
  pollIntervalMs: 0,
};
const secrets: Record<string, string | undefined> = { apiKey, dashboardToken };

async function run(
  adapter: JarvisAdapter,
  list: (adapter: never, call: { correlationId: string }) => Promise<string[]>,
) {
  const logger = createMemoryLogger();
  const abort = new AbortController();
  const context: AdapterContext = {
    adapterId: adapter.manifest.id,
    mode: "live",
    logger,
    clock: systemClock,
    config,
    getSecret: (field) => secrets[field],
    emit: () => undefined,
    signal: abort.signal,
    correlationId: createCorrelationId,
  };
  await adapter.initialize(context);
  try {
    const health = await adapter.healthCheck();
    console.log(
      `\n== ${adapter.manifest.id}: ${health.status} (${health.latencyMs ?? "-"} ms) ${health.message ?? ""}`,
    );
    console.log(`   Capabilities: ${(await adapter.getCapabilities()).capabilities.join(", ")}`);
    if (health.status === "offline") return false;
    const lines = await list(adapter as never, { correlationId: createCorrelationId() });
    for (const line of lines.slice(0, 5)) console.log(`   - ${line}`);
    console.log(`   ${lines.length} Eintrag/Einträge`);
    return true;
  } catch (error) {
    const normalized = normalizeError(error);
    console.log(`   FEHLER ${normalized.code}: ${normalized.message}`);
    return false;
  } finally {
    abort.abort();
    await adapter.shutdown();
    for (const record of logger.records.filter((entry) => entry.level !== "debug")) {
      console.log(`   [${record.level}] ${record.message} ${JSON.stringify(record.fields)}`);
    }
  }
}

const results = [
  await run(new HermesTasksAdapter(), async (adapter: HermesTasksAdapter, call) =>
    (await adapter.listTasks({ limit: 200 }, call)).items.map(
      (task) => `${task.status.padEnd(9)} ${task.priority} ${task.title}`,
    ),
  ),
  await run(new HermesActivityAdapter(), async (adapter: HermesActivityAdapter, call) =>
    (await adapter.listActivity({ limit: 200 }, call)).items.map(
      (event) => `${event.kind.padEnd(12)} ${event.title}`,
    ),
  ),
  await run(new HermesAgentsAdapter(), async (adapter: HermesAgentsAdapter, call) =>
    (await adapter.listAgents({}, call)).items.map(
      (agent) => `${agent.status.padEnd(8)} ${agent.name} (${agent.model ?? "kein Modell"})`,
    ),
  ),
];
process.exit(results.every(Boolean) ? 0 : 1);
