import { AdapterError } from "@jarvis/adapter-core";
import { DEFAULTS } from "./manifest";

export type DashboardAuthMode = "scrape" | "secret" | "file";

export interface HermesSettings {
  apiBaseUrl: string;
  apiKeyFile: string | undefined;
  dashboardBaseUrl: string;
  dashboardAuth: DashboardAuthMode;
  dashboardTokenFile: string | undefined;
  boards: readonly string[];
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  pollIntervalMs: number;
  /** `"tail"` or a numeric start cursor (event id / message id). */
  eventsStartCursor: "tail" | number;
  eventsDrainMs: number;
  activitySessionWindow: number;
  activityBufferSize: number;
}

const invalid = (message: string): AdapterError =>
  new AdapterError({ code: "VALIDATION_FAILED", message, retryable: false });

const intOr = (
  config: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
  min: number,
): number => {
  const value = config[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw invalid(`Konfiguration: '${key}' muss eine ganze Zahl >= ${min} sein.`);
  }
  return value;
};

const urlOr = (config: Readonly<Record<string, unknown>>, key: string, fallback: string): string => {
  const value = config[key] ?? fallback;
  if (typeof value !== "string") throw invalid(`Konfiguration: '${key}' muss eine URL sein.`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid(`Konfiguration: '${key}' ist keine gültige URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalid(`Konfiguration: '${key}' muss mit http:// oder https:// beginnen.`);
  }
  return value.replace(/\/+$/, "");
};

const optionalString = (config: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw invalid(`Konfiguration: '${key}' muss ein Text sein.`);
  return value;
};

const BOARD_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** Applies defaults and validates the adapter config (the registry validates against the schema as well). */
export function readSettings(config: Readonly<Record<string, unknown>>): HermesSettings {
  const rawBoards = config.boards ?? DEFAULTS.boards;
  if (
    !Array.isArray(rawBoards) ||
    rawBoards.length === 0 ||
    !rawBoards.every((board) => typeof board === "string" && BOARD_SLUG.test(board))
  ) {
    throw invalid("Konfiguration: 'boards' braucht mindestens einen Board-Slug (a-z, 0-9, _ und -).");
  }
  const boards = [...new Set(rawBoards as string[])];

  const auth = config.dashboardAuth ?? DEFAULTS.dashboardAuth;
  if (auth !== "scrape" && auth !== "secret" && auth !== "file") {
    throw invalid("Konfiguration: 'dashboardAuth' muss scrape, secret oder file sein.");
  }

  const cursor = config.eventsStartCursor ?? DEFAULTS.eventsStartCursor;
  if (cursor !== "tail" && !(typeof cursor === "number" && Number.isInteger(cursor) && cursor >= 0)) {
    throw invalid("Konfiguration: 'eventsStartCursor' muss 'tail' oder eine Zahl >= 0 sein.");
  }

  return {
    apiBaseUrl: urlOr(config, "apiBaseUrl", DEFAULTS.apiBaseUrl),
    apiKeyFile: optionalString(config, "apiKeyFile"),
    dashboardBaseUrl: urlOr(config, "dashboardBaseUrl", DEFAULTS.dashboardBaseUrl),
    dashboardAuth: auth,
    dashboardTokenFile: optionalString(config, "dashboardTokenFile"),
    boards,
    timeoutMs: intOr(config, "timeoutMs", DEFAULTS.timeoutMs, 20),
    maxAttempts: intOr(config, "maxAttempts", DEFAULTS.maxAttempts, 1),
    retryBaseDelayMs: intOr(config, "retryBaseDelayMs", DEFAULTS.retryBaseDelayMs, 1),
    pollIntervalMs: intOr(config, "pollIntervalMs", DEFAULTS.pollIntervalMs, 0),
    eventsStartCursor: cursor,
    eventsDrainMs: intOr(config, "eventsDrainMs", DEFAULTS.eventsDrainMs, 20),
    activitySessionWindow: intOr(config, "activitySessionWindow", DEFAULTS.activitySessionWindow, 1),
    activityBufferSize: intOr(config, "activityBufferSize", DEFAULTS.activityBufferSize, 100),
  };
}
