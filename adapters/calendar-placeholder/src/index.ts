import { CONTRACT_VERSION, type AdapterManifest } from "@friday/sdk";
import { createPlaceholderAdapter, type AdapterFactory } from "@friday/adapter-core";

export const PROVIDER_ID = "caldav-calendar";
export const CONFIG_SCHEMA_ID = "urn:friday:adapter:caldav-calendar:config";

export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "Kalender (CalDAV / ICS)",
  type: "object",
  properties: {
    sourceType: {
      type: "string",
      enum: ["caldav", "ics"],
      default: "caldav",
      description: "CalDAV-Server (lesen/schreiben) oder ICS-Abo-URL (nur lesen).",
    },
    url: { type: "string", format: "uri", description: "CalDAV-Kalender-URL bzw. ICS-Feed-URL." },
    username: { type: "string", description: "Benutzername (nur CalDAV mit Basic-Auth)." },
    password: {
      type: "string",
      minLength: 1,
      writeOnly: true,
      description: "Passwort bzw. App-Passwort (Secret; für ICS-Feeds mit Token in der URL entfällt es).",
    },
    timezone: { type: "string", default: "Europe/Berlin" },
    syncIntervalSeconds: { type: "integer", minimum: 30, default: 300 },
    lookaheadDays: { type: "integer", minimum: 1, maximum: 365, default: 60 },
    timeoutMs: { type: "integer", minimum: 100, maximum: 120000, default: 15000 },
  },
  additionalProperties: false,
} as const;

export const manifest: AdapterManifest = {
  id: PROVIDER_ID,
  name: "Kalender (CalDAV/ICS)",
  adapterVersion: "0.1.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "calendar",
  capabilities: [],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: ["password"],
};

export const calendarFactory: AdapterFactory<"calendar"> = {
  providerId: PROVIDER_ID,
  category: "calendar",
  configSchema,
  create: () =>
    createPlaceholderAdapter({
      manifest: { ...manifest, category: "calendar" },
      systemName: "Kalender",
      isConfigured: (config) => typeof config.url === "string" && config.url.length > 0,
    }),
};
