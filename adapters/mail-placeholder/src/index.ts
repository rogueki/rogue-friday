import { CONTRACT_VERSION, type AdapterManifest } from "@jarvis/sdk";
import { createPlaceholderAdapter, type AdapterFactory } from "@jarvis/adapter-core";

export const PROVIDER_ID = "gmx-mail";
export const CONFIG_SCHEMA_ID = "urn:jarvis:adapter:gmx-mail:config";

export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "GMX Mail (IMAP/SMTP)",
  type: "object",
  properties: {
    imapHost: { type: "string", default: "imap.gmx.net" },
    imapPort: { type: "integer", minimum: 1, maximum: 65535, default: 993 },
    imapSecurity: { type: "string", enum: ["tls", "starttls"], default: "tls" },
    smtpHost: { type: "string", default: "mail.gmx.net" },
    smtpPort: { type: "integer", minimum: 1, maximum: 65535, default: 587 },
    smtpSecurity: { type: "string", enum: ["tls", "starttls"], default: "starttls" },
    username: { type: "string", description: "Vollständige GMX-Adresse (Login)." },
    password: {
      type: "string",
      minLength: 1,
      writeOnly: true,
      description: "Passwort bzw. App-Passwort (Secret).",
    },
    mailbox: { type: "string", default: "INBOX" },
    syncIntervalSeconds: { type: "integer", minimum: 15, default: 120 },
    timeoutMs: { type: "integer", minimum: 100, maximum: 120000, default: 15000 },
  },
  additionalProperties: false,
} as const;

export const manifest: AdapterManifest = {
  id: PROVIDER_ID,
  name: "GMX Mail (IMAP/SMTP)",
  adapterVersion: "0.1.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "communication",
  capabilities: [],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: ["password"],
};

export const mailFactory: AdapterFactory<"communication"> = {
  providerId: PROVIDER_ID,
  category: "communication",
  configSchema,
  create: () =>
    createPlaceholderAdapter({
      manifest: { ...manifest, category: "communication" },
      systemName: "GMX Mail",
      isConfigured: (config, hasSecret) =>
        typeof config.username === "string" && config.username.length > 0 && hasSecret("password"),
    }),
};
