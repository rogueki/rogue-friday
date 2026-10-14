import { CONTRACT_VERSION, type AdapterManifest } from "@jarvis/sdk";
import { createPlaceholderAdapter, type AdapterFactory } from "@jarvis/adapter-core";

export const PROVIDER_ID = "windows-wsl-system";
export const CONFIG_SCHEMA_ID = "urn:jarvis:adapter:windows-wsl-system:config";

export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "System (Windows + WSL)",
  type: "object",
  properties: {
    distro: {
      type: "string",
      default: "Ubuntu",
      description: "WSL-Distribution, in der Hermes und der TTS-Dienst laufen.",
    },
    metricsEndpoint: {
      type: "string",
      format: "uri",
      description:
        "Optional: HTTP-Endpunkt eines lokalen Metrik-Agents (CPU/RAM/GPU/VRAM/Speicher/Netz) als JSON.",
    },
    monitoredServices: {
      type: "array",
      description: "Dienste, deren Status angezeigt wird (id, Anzeigename, Art, Health-URL).",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: ["windows_service", "wsl_systemd_user", "http", "process"] },
          healthUrl: { type: "string", format: "uri" },
          unit: { type: "string", description: "systemd-/Dienstname, z. B. kira-tts." },
        },
        required: ["id", "name", "kind"],
        additionalProperties: false,
      },
      default: [],
    },
    sampleIntervalSeconds: { type: "integer", minimum: 1, maximum: 300, default: 5 },
    timeoutMs: { type: "integer", minimum: 100, maximum: 60000, default: 5000 },
  },
  additionalProperties: false,
} as const;

export const manifest: AdapterManifest = {
  id: PROVIDER_ID,
  name: "System (Windows + WSL)",
  adapterVersion: "0.1.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "system",
  capabilities: [],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: [],
};

export const systemFactory: AdapterFactory<"system"> = {
  providerId: PROVIDER_ID,
  category: "system",
  configSchema,
  create: () =>
    createPlaceholderAdapter({
      manifest: { ...manifest, category: "system" },
      systemName: "System (Windows/WSL)",
      // The WSL distro has a default, so "configured" means: the operator explicitly chose a source.
      isConfigured: (config) =>
        (typeof config.metricsEndpoint === "string" && config.metricsEndpoint.length > 0) ||
        (Array.isArray(config.monitoredServices) && config.monitoredServices.length > 0),
    }),
};
