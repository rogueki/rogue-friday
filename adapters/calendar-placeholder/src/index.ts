import { CONTRACT_VERSION, type AdapterManifest } from "@friday/sdk";
import type { AdapterFactory } from "@friday/adapter-core";
import { IcsCalendarAdapter } from "./ics-calendar";
export { validateFeedUrl } from "./fetch-ics";

export const PROVIDER_ID = "caldav-calendar";
export const CONFIG_SCHEMA_ID = "urn:friday:adapter:caldav-calendar:config";

// Keep the historic provider id for existing allowlists and saved ICS settings.
export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "ICS lesen oder CalDAV-Termine anlegen",
  type: "object",
  properties: {
    mode: { type: "string", enum: ["ics", "caldav"], default: "ics", description: "ICS: veroeffentlichter Feed; CalDAV: privater Kalender mit Benutzername und App-Passwort." },
    feedUrl: { type: "string", minLength: 1, writeOnly: true, description: "Private HTTPS-ICS-URL." },
    calendarUrl: { type: "string", minLength: 1, writeOnly: true, description: "Oeffentliche HTTPS-URL einer CalDAV-Kalendersammlung, nicht der Server-Startseite." },
    username: { type: "string", minLength: 1, writeOnly: true, description: "CalDAV-Benutzername." },
    password: { type: "string", minLength: 1, writeOnly: true, description: "CalDAV-Passwort oder App-Passwort. OAuth-only-Konten werden nicht unterstuetzt." },
  },
  additionalProperties: false,
} as const;

export const manifest: AdapterManifest = {
  id: PROVIDER_ID,
  name: "ICS lesen oder CalDAV-Termine anlegen",
  adapterVersion: "0.4.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "calendar",
  capabilities: ["calendar.read", "calendar.create"],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: ["feedUrl", "calendarUrl", "username", "password"],
};

export const calendarFactory: AdapterFactory<"calendar"> = {
  providerId: PROVIDER_ID,
  category: "calendar",
  configSchema,
  create: () => new IcsCalendarAdapter(),
};
