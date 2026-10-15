import { CONTRACT_VERSION, type AdapterManifest } from "@friday/sdk";
import { createPlaceholderAdapter, type AdapterFactory } from "@friday/adapter-core";

export const PROVIDER_ID = "friday-voice-http";
export const CONFIG_SCHEMA_ID = "urn:friday:adapter:friday-voice-http:config";

export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "Friday Voice (lokale HTTP-Bridge)",
  type: "object",
  properties: {
    baseUrl: {
      type: "string",
      format: "uri",
      description:
        "Basis-URL der lokalen Voice-HTTP-Bridge. Heute existiert nur der Health-Server des Voice-Dienstes auf 127.0.0.1:<health_port> (config/voice.json); die Bridge ergänzt Steuer- und Event-Endpunkte.",
    },
    apiToken: {
      type: "string",
      minLength: 8,
      writeOnly: true,
      description: "Optional: Token der Bridge (Secret), falls sie Authentifizierung verlangt.",
    },
    logPath: {
      type: "string",
      description:
        "Optional: Pfad zu logs/voice.jsonl, falls Ereignisse aus dem Log gelesen werden sollen (solange die Bridge keinen Event-Stream anbietet).",
    },
    timeoutMs: { type: "integer", minimum: 100, maximum: 60000, default: 3000 },
    pollIntervalMs: {
      type: "integer",
      minimum: 100,
      maximum: 60000,
      default: 500,
      description: "Intervall für Status-Polling.",
    },
  },
  additionalProperties: false,
} as const;

export const manifest: AdapterManifest = {
  id: PROVIDER_ID,
  name: "Friday Voice (HTTP)",
  adapterVersion: "0.1.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "voice",
  capabilities: [],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: ["apiToken"],
};

export const voiceFactory: AdapterFactory<"voice"> = {
  providerId: PROVIDER_ID,
  category: "voice",
  configSchema,
  create: () =>
    createPlaceholderAdapter({
      manifest: { ...manifest, category: "voice" },
      systemName: "Friday Voice",
      isConfigured: (config) => typeof config.baseUrl === "string" && config.baseUrl.length > 0,
    }),
};
