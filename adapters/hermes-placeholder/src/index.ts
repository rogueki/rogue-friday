import { CONTRACT_VERSION, type AdapterManifest } from "@friday/sdk";
import { createPlaceholderAdapter, type AdapterFactory, type PortCategory } from "@friday/adapter-core";

/**
 * Hermes is one system behind three categories (tasks, activity, agents). Decision: ONE ADAPTER PER CATEGORY, shipped
 * in this single package. Each category can then be switched between mock / hybrid / live independently
 * (PLAN §10.10 hybrid example: `tasks: hermes-tasks`, `memory: mock-memory`), has its own health, capability set and
 * circuit breaker, and fails in isolation. The three adapters share one config shape (Hermes base URL + token).
 */

type HermesCategory = Extract<PortCategory, "tasks" | "activity" | "agents">;

const HERMES_CATEGORIES: ReadonlyArray<{ category: HermesCategory; name: string }> = [
  { category: "tasks", name: "Hermes Aufgaben" },
  { category: "activity", name: "Hermes Aktivität" },
  { category: "agents", name: "Hermes Agenten" },
];

const configSchemaFor = (id: string) =>
  ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:friday:adapter:${id}:config`,
    title: `Hermes (${id})`,
    type: "object",
    properties: {
      baseUrl: {
        type: "string",
        format: "uri",
        description: "Basis-URL der Hermes-API (vom WSL-Host erreichbar), z. B. http://127.0.0.1:8642",
      },
      apiToken: {
        type: "string",
        minLength: 8,
        writeOnly: true,
        description:
          "Hermes-API-Key (Secret; Referenz auf die Schlüsseldatei, nie im Klartext in der Config).",
      },
      timeoutMs: { type: "integer", minimum: 100, maximum: 900000, default: 10000 },
      eventsPath: {
        type: "string",
        default: "/events",
        description: "Pfad der Event-/Aktivitätsquelle (SSE oder Polling) für die spätere Live-Anbindung.",
      },
    },
    additionalProperties: false,
  }) as const;

function createFactory(category: HermesCategory, name: string): AdapterFactory<HermesCategory> {
  const id = `hermes-${category}`;
  const configSchema = configSchemaFor(id);
  const manifest: AdapterManifest & { category: HermesCategory } = {
    id,
    name,
    adapterVersion: "0.1.0",
    contractVersion: CONTRACT_VERSION,
    apiVersion: "v1",
    category,
    capabilities: [],
    configSchemaRef: configSchema.$id,
    secretFields: ["apiToken"],
  };
  return {
    providerId: id,
    category,
    configSchema,
    create: () =>
      createPlaceholderAdapter({
        manifest,
        systemName: "Hermes",
        isConfigured: (config, hasSecret) =>
          typeof config.baseUrl === "string" && config.baseUrl.length > 0 && hasSecret("apiToken"),
      }),
  };
}

export const hermesTasksFactory = createFactory("tasks", HERMES_CATEGORIES[0]?.name ?? "");
export const hermesActivityFactory = createFactory("activity", HERMES_CATEGORIES[1]?.name ?? "");
export const hermesAgentsFactory = createFactory("agents", HERMES_CATEGORIES[2]?.name ?? "");

/** All Hermes provider factories; register each under its `providerId` (allowlist). */
export const hermesFactories: readonly AdapterFactory<HermesCategory>[] = [
  hermesTasksFactory,
  hermesActivityFactory,
  hermesAgentsFactory,
];
