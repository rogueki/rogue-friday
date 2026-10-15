import { CONTRACT_VERSION, type AdapterManifest } from "@friday/sdk";

export const ADAPTER_ID = "example-tasks-http";
export const PROVIDER_ID = "example-tasks-http";
export const PROVIDER_SYSTEM = "example-tasks";
export const CONFIG_SCHEMA_ID = "urn:friday:adapter:example-tasks-http:config";

/** JSON Schema (draft 2020-12) of the adapter's `config`. `apiToken` is a secret: it is resolved via `getSecret`, never stored in config. */
export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "ExampleTasks HTTP adapter",
  type: "object",
  properties: {
    baseUrl: {
      type: "string",
      format: "uri",
      description: "Basis-URL der ExampleTasks-API, z. B. http://127.0.0.1:8099",
    },
    apiToken: {
      type: "string",
      minLength: 8,
      writeOnly: true,
      description: "Bearer-Token (Secret, wird nie angezeigt oder geloggt).",
    },
    timeoutMs: {
      type: "integer",
      minimum: 20,
      maximum: 120000,
      default: 10000,
      description: "Timeout je Versuch.",
    },
    maxAttempts: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      default: 3,
      description: "Versuche inklusive Erstversuch.",
    },
    retryBaseDelayMs: { type: "integer", minimum: 1, maximum: 10000, default: 200 },
    pollIntervalMs: {
      type: "integer",
      minimum: 0,
      default: 5000,
      description: "Intervall des Event-Pollings in ms; 0 schaltet das Hintergrund-Polling ab.",
    },
  },
  required: ["baseUrl", "apiToken"],
  additionalProperties: false,
} as const;

export const manifest: AdapterManifest = {
  id: ADAPTER_ID,
  name: "ExampleTasks (HTTP)",
  adapterVersion: "1.0.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "tasks",
  capabilities: ["tasks.read", "tasks.create", "tasks.update", "tasks.cancel", "tasks.stream"],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: ["apiToken"],
};
