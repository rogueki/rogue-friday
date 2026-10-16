import { CONTRACT_VERSION, type AdapterManifest } from "@friday/sdk";
import type { AdapterFactory } from "@friday/adapter-core";
import { IcsCalendarAdapter } from "./ics-calendar";
export { validateFeedUrl } from "./fetch-ics";

export const PROVIDER_ID = "caldav-calendar";
export const CONFIG_SCHEMA_ID = "urn:friday:adapter:caldav-calendar:config";

// Keep the historic provider id for existing allowlists. This adapter supports ICS read-only.
export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "iCalendar-Feed (nur lesen)",
  type: "object",
  properties: {
    feedUrl: { type: "string", minLength: 1, writeOnly: true, description: "Private HTTPS-ICS-URL." },
  },
  additionalProperties: false,
} as const;

export const manifest: AdapterManifest = {
  id: PROVIDER_ID,
  name: "iCalendar-Feed (nur lesen)",
  adapterVersion: "0.2.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "calendar",
  capabilities: ["calendar.read"],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: ["feedUrl"],
};

export const calendarFactory: AdapterFactory<"calendar"> = {
  providerId: PROVIDER_ID,
  category: "calendar",
  configSchema,
  create: () => new IcsCalendarAdapter(),
};
