import { readFile } from "node:fs/promises";
import {
  AdapterError,
  createHttpClient,
  createRedactor,
  errorFromHttpStatus,
  normalizeError,
  type AdapterContext,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from "@jarvis/adapter-core";
import type { HermesSettings } from "./config";

/**
 * A credential that may have to be obtained again (token rotation, replaced key file). `refresh()` resolves to `true`
 * only when the value actually changed, so a wrongly rejected-but-unchanged credential is never retried in a loop.
 */
export interface CredentialSource {
  current(signal?: AbortSignal): Promise<string>;
  refresh(signal?: AbortSignal): Promise<boolean>;
  /** Last known value (for log/error redaction); never sent anywhere. */
  known(): string | undefined;
}

const unauthenticated = (message: string): AdapterError =>
  new AdapterError({ code: "UNAUTHENTICATED", message, retryable: false });

/** Secret handed in by the registry (`getSecret`); fixed for the lifetime of the adapter. */
export function secretCredential(read: () => string | undefined, label: string): CredentialSource {
  return {
    async current() {
      const value = read();
      if (!value) throw unauthenticated(`${label} ist nicht konfiguriert.`);
      return value;
    },
    refresh: async () => false,
    known: read,
  };
}

/** Value stored in a key file (e.g. `C:\Jarvis\config\hermes_api.key`); re-read on refresh. */
export function fileCredential(path: string, label: string): CredentialSource {
  let cached: string | undefined;
  const load = async (): Promise<string> => {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (cause) {
      throw new AdapterError({
        code: "UNAUTHENTICATED",
        message: `${label}: Schlüsseldatei '${path}' ist nicht lesbar.`,
        retryable: false,
        cause,
      });
    }
    const value = text.trim();
    if (!value) throw unauthenticated(`${label}: Schlüsseldatei '${path}' ist leer.`);
    return value;
  };
  return {
    async current() {
      cached ??= await load();
      return cached;
    },
    async refresh() {
      const before = cached;
      cached = await load();
      return cached !== before;
    },
    known: () => cached,
  };
}

/** First available source wins: configured secret, then key file. */
export function firstCredential(sources: CredentialSource[], label: string): CredentialSource {
  const usable = sources.length > 0 ? sources : [secretCredential(() => undefined, label)];
  return {
    async current(signal) {
      let last: unknown;
      for (const source of usable) {
        try {
          return await source.current(signal);
        } catch (error) {
          last = error;
        }
      }
      throw last;
    },
    async refresh(signal) {
      for (const source of usable) {
        if (await source.refresh(signal).catch(() => false)) return true;
      }
      return false;
    },
    known: () => usable.map((source) => source.known()).find((value) => value !== undefined),
  };
}

const TOKEN_PATTERN = /window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]{8,})"/;

/**
 * Dashboard token scraped from the HTML of `GET /` (`window.__HERMES_SESSION_TOKEN__="..."`, injected on loopback
 * binds only). The token is random per dashboard start, so `refresh()` fetches the page again.
 */
export function scrapedTokenCredential(
  fetchPage: (signal?: AbortSignal) => Promise<string>,
  label: string,
): CredentialSource {
  let cached: string | undefined;
  let inFlight: Promise<string> | undefined;
  const scrape = (signal?: AbortSignal): Promise<string> => {
    inFlight ??= fetchPage(signal)
      .then((html) => {
        const match = TOKEN_PATTERN.exec(html);
        if (!match?.[1]) {
          throw unauthenticated(
            `${label}: Das Dashboard liefert kein Session-Token (nicht an Loopback gebunden?). HERMES_DASHBOARD_SESSION_TOKEN setzen und dashboardAuth=secret oder file verwenden.`,
          );
        }
        return match[1];
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
  return {
    async current(signal) {
      cached ??= await scrape(signal);
      return cached;
    },
    async refresh(signal) {
      const before = cached;
      cached = await scrape(signal);
      return cached !== before;
    },
    known: () => cached,
  };
}

export interface AuthedClient {
  request<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>>;
  /** Request without credentials (health probes). */
  requestPublic<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>>;
  readonly credential: CredentialSource;
  readonly http: HttpClient;
  readonly baseUrl: string;
}

function createAuthedClient(options: {
  baseUrl: string;
  credential: CredentialSource;
  header: (value: string) => Record<string, string>;
  settings: HermesSettings;
  context: AdapterContext;
  signal: AbortSignal;
  redact: (text: string) => string;
}): AuthedClient {
  const { settings, context } = options;
  const http = createHttpClient({
    baseUrl: options.baseUrl,
    timeoutMs: settings.timeoutMs,
    retry: {
      maxAttempts: settings.maxAttempts,
      baseDelayMs: settings.retryBaseDelayMs,
      maxDelayMs: Math.max(settings.retryBaseDelayMs, 5_000),
      factor: 2,
      jitter: "full",
    },
    // The registry owns the circuit breaker; a second one here would hide failures from health.
    circuitBreaker: false,
    clock: context.clock,
    logger: context.logger,
    redact: options.redact,
    signal: options.signal,
  });

  const withCredential = async <T>(request: HttpRequest, value: string): Promise<HttpResponse<T>> =>
    http.request<T>({ ...request, headers: { ...options.header(value), ...request.headers } });

  return {
    http,
    credential: options.credential,
    baseUrl: options.baseUrl,
    requestPublic: (request) => http.request(request),
    async request<T>(request: HttpRequest): Promise<HttpResponse<T>> {
      const value = await options.credential.current(request.signal);
      try {
        return await withCredential<T>(request, value);
      } catch (error) {
        const normalized = normalizeError(error);
        if (normalized.code !== "UNAUTHENTICATED") throw normalized;
        let changed = false;
        try {
          changed = await options.credential.refresh(request.signal);
        } catch (refreshError) {
          context.logger.warn("Credential konnte nicht erneuert werden", {
            code: normalizeError(refreshError).code,
          });
        }
        if (!changed) throw normalized;
        context.logger.info("Hermes hat das Credential rotiert; Anfrage wird einmal wiederholt", {
          operation: request.operation,
        });
        return withCredential<T>(request, await options.credential.current(request.signal));
      }
    },
  };
}

export interface HermesClients {
  dashboard: AuthedClient;
  api: AuthedClient;
  redact: (text: string) => string;
}

/** Builds the Dashboard (session token) and API-server (Bearer key) clients from settings and secrets. */
export function createClients(
  context: AdapterContext,
  settings: HermesSettings,
  signal: AbortSignal,
): HermesClients {
  const known: Array<() => string | undefined> = [];
  const redact = createRedactor(() => known.map((read) => read()));

  const apiSources: CredentialSource[] = [
    secretCredential(() => context.getSecret("apiKey"), "API-Schlüssel"),
  ];
  if (settings.apiKeyFile) apiSources.push(fileCredential(settings.apiKeyFile, "API-Schlüssel"));
  const apiCredential = firstCredential(apiSources, "API-Schlüssel");

  // Page fetcher for the token scrape shares the dashboard client's resilience, but not its credential.
  const pageClient = createHttpClient({
    baseUrl: settings.dashboardBaseUrl,
    timeoutMs: settings.timeoutMs,
    retry: {
      maxAttempts: settings.maxAttempts,
      baseDelayMs: settings.retryBaseDelayMs,
      maxDelayMs: Math.max(settings.retryBaseDelayMs, 5_000),
      factor: 2,
      jitter: "full",
    },
    circuitBreaker: false,
    clock: context.clock,
    logger: context.logger,
    signal,
  });
  const fetchPage = (callSignal?: AbortSignal): Promise<string> =>
    pageClient.caller.call(
      async (attemptSignal) => {
        const response = await fetch(`${settings.dashboardBaseUrl}/`, {
          headers: { accept: "text/html" },
          signal: attemptSignal,
        });
        if (!response.ok) {
          throw errorFromHttpStatus(response.status, `Dashboard-Startseite: HTTP ${response.status}`);
        }
        return response.text();
      },
      {
        operation: "scrapeDashboardToken",
        retry: true,
        signal: callSignal ? AbortSignal.any([signal, callSignal]) : signal,
      },
    );

  const dashboardCredential: CredentialSource =
    settings.dashboardAuth === "scrape"
      ? scrapedTokenCredential(fetchPage, "Dashboard-Token")
      : settings.dashboardAuth === "file" && settings.dashboardTokenFile
        ? fileCredential(settings.dashboardTokenFile, "Dashboard-Token")
        : secretCredential(() => context.getSecret("dashboardToken"), "Dashboard-Token");
  if (settings.dashboardAuth === "file" && !settings.dashboardTokenFile) {
    throw new AdapterError({
      code: "VALIDATION_FAILED",
      message: "Konfiguration: dashboardAuth=file braucht 'dashboardTokenFile'.",
      retryable: false,
    });
  }

  known.push(
    () => apiCredential.known(),
    () => dashboardCredential.known(),
    () => context.getSecret("apiKey"),
    () => context.getSecret("dashboardToken"),
  );

  return {
    redact,
    api: createAuthedClient({
      baseUrl: settings.apiBaseUrl,
      credential: apiCredential,
      header: (value) => ({ authorization: `Bearer ${value}` }),
      settings,
      context,
      signal,
      redact,
    }),
    dashboard: createAuthedClient({
      baseUrl: settings.dashboardBaseUrl,
      credential: dashboardCredential,
      header: (value) => ({ "x-hermes-session-token": value }),
      settings,
      context,
      signal,
      redact,
    }),
  };
}
