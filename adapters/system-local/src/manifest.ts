import { CONTRACT_VERSION, type AdapterManifest } from "@friday/sdk";

export const ADAPTER_ID = "local-system";
export const PROVIDER_ID = "local-system";
export const PROVIDER_SYSTEM = "local-system";
export const CONFIG_SCHEMA_ID = "urn:friday:adapter:local-system:config";

/** Installer ports (docs/INSTALLER_INTEGRATION_REVIEW.md §3.1); all services bind to 127.0.0.1 only. */
export const DEFAULT_URLS = {
  qwenUrl: "http://127.0.0.1:43692",
  hermesApiUrl: "http://127.0.0.1:43693",
  hermesDashboardUrl: "http://127.0.0.1:43691",
  voiceUrl: "http://127.0.0.1:43694",
} as const;

/**
 * JSON Schema (draft 2020-12) of the adapter's `config` (PLAN §42.2). `hermesApiKey` is a secret: it is resolved via
 * `getSecret` (`env:` / `wincred:` reference), never stored in config, never returned.
 */
export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "Lokales System (Hardware, Dienste, Modelle)",
  type: "object",
  properties: {
    qwenUrl: {
      type: "string",
      format: "uri",
      default: DEFAULT_URLS.qwenUrl,
      description: "Lokaler Qwen-Router (llama-server, Aufgabe FRIDAY_Qwen). Probe: GET /v1/models.",
    },
    hermesApiUrl: {
      type: "string",
      format: "uri",
      default: DEFAULT_URLS.hermesApiUrl,
      description:
        "Hermes API-Server (WSL). Probe: GET /health ohne Authentifizierung; Modelle: GET /v1/models mit Bearer-Key.",
    },
    hermesDashboardUrl: {
      type: "string",
      format: "uri",
      default: DEFAULT_URLS.hermesDashboardUrl,
      description: "Hermes-Dashboard (WSL). Probe: GET /api/health (Pfad und Authentifizierung unbelegt).",
    },
    voiceUrl: {
      type: "string",
      format: "uri",
      default: DEFAULT_URLS.voiceUrl,
      description: "Status-Server des Voice-Dienstes. Probe: GET / (der Pfad wird vom Dienst ignoriert).",
    },
    hermesApiKey: {
      type: "string",
      minLength: 8,
      writeOnly: true,
      description:
        "Bearer-Key des Hermes API-Servers (Secret-Referenz, z. B. env:HERMES_API_KEY). Nur für die Modellliste (GET /v1/models); wird nie angezeigt oder geloggt.",
    },
    hermesApiKeyFile: {
      type: "string",
      minLength: 1,
      description:
        "Alternative zum Secret: Pfad zur Key-Datei des Installers (C:\\Friday\\config\\hermes_api.key). Der Inhalt wird zur Laufzeit gelesen und nie zurückgegeben. Das Secret hat Vorrang.",
    },
    storagePaths: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
      maxItems: 16,
      description: "Laufwerke oder Verzeichnisse für die Speicheranzeige. Leer: C:\\ unter Windows, sonst /.",
    },
    enableGpuProbe: {
      type: "boolean",
      default: true,
      description: "GPU/VRAM per nvidia-smi lesen, wenn vorhanden.",
    },
    nvidiaSmiPath: {
      type: "string",
      minLength: 1,
      default: "nvidia-smi",
      description: "Pfad oder Name von nvidia-smi.",
    },
    enableWsl: {
      type: "boolean",
      default: true,
      description: "Nur Windows: WSL-Status über `wsl.exe -l -v` (Best Effort).",
    },
    wslDistro: {
      type: "string",
      minLength: 1,
      default: "Ubuntu",
      description: "WSL-Distribution, in der Hermes läuft (Installer: Ubuntu).",
    },
    timeoutMs: {
      type: "integer",
      minimum: 20,
      maximum: 60000,
      default: 2000,
      description: "Timeout je Probe (jeweils ein Versuch, keine Wiederholung).",
    },
  },
  additionalProperties: false,
} as const;

export const manifest: AdapterManifest = {
  id: ADAPTER_ID,
  name: "Lokales System",
  adapterVersion: "1.0.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "system",
  // No system.restartAdapter / system.openLogs: they need the approval flow and an audited action (docs/MAPPING/system.md).
  capabilities: ["system.read", "system.healthcheck"],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: ["hermesApiKey"],
};
