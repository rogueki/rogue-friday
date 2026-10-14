import { CONTRACT_VERSION, type AdapterManifest } from "@jarvis/sdk";

/** Hermes spans three port categories; there is ONE adapter per category (see README). */
export type HermesCategory = "tasks" | "activity" | "agents";

export const PROVIDER_SYSTEM = "hermes";
export const HERMES_CATEGORIES: readonly HermesCategory[] = ["tasks", "activity", "agents"];

export const adapterIdFor = (category: HermesCategory): string => `hermes-${category}`;
export const configSchemaIdFor = (category: HermesCategory): string =>
  `urn:jarvis:adapter:${adapterIdFor(category)}:config`;

const NAMES: Readonly<Record<HermesCategory, string>> = {
  tasks: "Hermes Aufgaben",
  activity: "Hermes Aktivität",
  agents: "Hermes Agenten",
};

/**
 * Exactly what is implemented and live-verified (docs/MAPPING/hermes.md §7). `tasks.cancel|retry|pause|resume` and
 * `agents.pause|resume|stop|assignTask` stay out: no verified Hermes interface (README, "Annahme (unbelegt)").
 */
const CAPABILITIES: Readonly<Record<HermesCategory, readonly string[]>> = {
  tasks: ["tasks.read", "tasks.create", "tasks.update", "tasks.stream"],
  activity: ["activity.read", "activity.stream", "activity.backfill"],
  agents: ["agents.read"],
};

/** Secret fields are resolved by the registry (`env:NAME` / `wincred:TARGET`) and only reachable through `getSecret`. */
export const SECRET_FIELDS = ["apiKey", "dashboardToken"] as const;

export const DEFAULTS = {
  apiBaseUrl: "http://127.0.0.1:43693",
  dashboardBaseUrl: "http://127.0.0.1:43691",
  dashboardAuth: "scrape",
  boards: ["default"],
  timeoutMs: 10_000,
  maxAttempts: 3,
  retryBaseDelayMs: 200,
  pollIntervalMs: 2_000,
  eventsStartCursor: "tail",
  eventsDrainMs: 900,
  activitySessionWindow: 25,
  activityBufferSize: 2_000,
} as const;

/**
 * JSON Schema (draft 2020-12) of the adapter `config`. Key names are chosen so that the config loader's credential
 * heuristic accepts them: `apiKey` / `dashboardToken` must be secret references, `*File` keys are plain paths.
 */
export function configSchemaFor(category: HermesCategory) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: configSchemaIdFor(category),
    title: `${NAMES[category]} (Hermes Agent)`,
    type: "object",
    properties: {
      apiBaseUrl: {
        type: "string",
        format: "uri",
        default: DEFAULTS.apiBaseUrl,
        description:
          "API-Server des Hermes-Gateways (Bearer-Auth), Installer-Standard http://127.0.0.1:43693.",
      },
      apiKey: {
        type: "string",
        minLength: 8,
        writeOnly: true,
        description:
          "API_SERVER_KEY des Gateways (Secret, Referenz env:NAME oder wincred:ZIEL; nie Klartext, nie im Browser).",
      },
      apiKeyFile: {
        type: "string",
        minLength: 1,
        description:
          "Alternative zu apiKey: Pfad der Schlüsseldatei, z. B. C:\\Jarvis\\config\\hermes_api.key. Der Inhalt wird nur serverseitig gelesen.",
      },
      dashboardBaseUrl: {
        type: "string",
        format: "uri",
        default: DEFAULTS.dashboardBaseUrl,
        description: "Hermes-Dashboard (Kanban-Plugin, Profile), Installer-Standard http://127.0.0.1:43691.",
      },
      dashboardAuth: {
        type: "string",
        enum: ["scrape", "secret", "file"],
        default: DEFAULTS.dashboardAuth,
        description:
          "Quelle des Dashboard-Session-Tokens: scrape = aus dem HTML von GET / lesen (bei 401 neu holen), secret = Feld dashboardToken (z. B. env:HERMES_DASHBOARD_SESSION_TOKEN), file = Datei dashboardTokenFile.",
      },
      dashboardToken: {
        type: "string",
        minLength: 8,
        writeOnly: true,
        description:
          "Fester Dashboard-Token (Secret) für dashboardAuth=secret; entspricht HERMES_DASHBOARD_SESSION_TOKEN.",
      },
      dashboardTokenFile: {
        type: "string",
        minLength: 1,
        description: "Pfad einer Datei mit dem festen Dashboard-Token (dashboardAuth=file).",
      },
      boards: {
        type: "array",
        items: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]*$", maxLength: 64 },
        minItems: 1,
        uniqueItems: true,
        default: [...DEFAULTS.boards],
        description: "Kanban-Boards (Slugs). Das erste Board nimmt neu angelegte Aufgaben auf.",
      },
      timeoutMs: { type: "integer", minimum: 20, maximum: 120000, default: DEFAULTS.timeoutMs },
      maxAttempts: { type: "integer", minimum: 1, maximum: 5, default: DEFAULTS.maxAttempts },
      retryBaseDelayMs: { type: "integer", minimum: 1, maximum: 10000, default: DEFAULTS.retryBaseDelayMs },
      pollIntervalMs: {
        type: "integer",
        minimum: 0,
        default: DEFAULTS.pollIntervalMs,
        description: "Pause zwischen zwei Event-Zyklen in ms; 0 schaltet das Hintergrund-Polling ab.",
      },
      eventsStartCursor: {
        oneOf: [{ const: "tail" }, { type: "integer", minimum: 0 }],
        default: DEFAULTS.eventsStartCursor,
        description:
          "Startpunkt der Event-Quellen: tail = nur neue Ereignisse ab Adapterstart; Zahl = Kanban-Event-ID bzw. Nachrichten-ID, ab der erneut gelesen wird (0 = gesamte Historie).",
      },
      eventsDrainMs: {
        type: "integer",
        minimum: 20,
        maximum: 10000,
        default: DEFAULTS.eventsDrainMs,
        description:
          "Wartezeit je Event-Zyklus auf Nachrichten des Kanban-WebSockets (der Server pollt alle 0,3 s).",
      },
      activitySessionWindow: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        default: DEFAULTS.activitySessionWindow,
        description: "Anzahl der zuletzt aktiven Hermes-Sitzungen, die in die Aktivität einfließen.",
      },
      activityBufferSize: {
        type: "integer",
        minimum: 100,
        maximum: 50000,
        default: DEFAULTS.activityBufferSize,
        description: "Größe des Aktivitäts-Ringpuffers im Speicher.",
      },
    },
    additionalProperties: false,
  } as const;
}

export function manifestFor(category: HermesCategory): AdapterManifest {
  return {
    id: adapterIdFor(category),
    name: NAMES[category],
    adapterVersion: "1.0.0",
    contractVersion: CONTRACT_VERSION,
    apiVersion: "v1",
    category,
    capabilities: [...CAPABILITIES[category]],
    configSchemaRef: configSchemaIdFor(category),
    secretFields: [...SECRET_FIELDS],
  };
}
