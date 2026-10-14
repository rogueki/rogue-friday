import type { HealthStatus } from "@jarvis/sdk";
import { normalizeError, type AdapterError, type Clock, type HttpClient } from "@jarvis/adapter-core";
import type { HostApi } from "./host";
import { decodeCommandOutput, parseModelIds, parseWslList } from "./parsers";

/** Result of one probe. Probes never throw: an unreachable or misbehaving service is a *state*, not an adapter failure. */
export interface ProbeResult {
  status: HealthStatus;
  latencyMs: number | null;
  /** German, free of foreign error text (which may contain secrets). */
  detail: string;
  /** Model ids when the probe read a model list. */
  models?: string[];
}

export interface ProbeEnv {
  clock: Clock;
  host: HostApi;
  signal: AbortSignal;
  timeoutMs: number;
  qwen: HttpClient;
  hermesApi: HttpClient;
  hermesDashboard: HttpClient;
  voice: HttpClient;
  wslDistro: string;
  /** Resolved lazily so that a rotated key file is picked up. */
  hermesKey(): Promise<string | undefined>;
}

type Fetched =
  | { ok: true; latencyMs: number; body: unknown }
  | { ok: false; latencyMs: number | null; error: AdapterError; httpStatus: number | undefined };

async function get(
  client: HttpClient,
  clock: Clock,
  path: string,
  options: { headers?: Record<string, string>; operation: string },
): Promise<Fetched> {
  const started = clock.now();
  try {
    const response = await client.request<unknown>({
      method: "GET",
      path,
      operation: options.operation,
      retry: false,
      ...(options.headers ? { headers: options.headers } : {}),
    });
    return { ok: true, latencyMs: Math.max(0, Math.round(clock.now() - started)), body: response.body };
  } catch (raw) {
    const error = normalizeError(raw, { operation: options.operation });
    const httpStatus =
      typeof error.details.upstreamStatus === "number" ? error.details.upstreamStatus : undefined;
    // A status code means the service answered, so the elapsed time is a real response time.
    return {
      ok: false,
      httpStatus,
      error,
      latencyMs: httpStatus === undefined ? null : Math.max(0, Math.round(clock.now() - started)),
    };
  }
}

/** Generic classification of a failed GET. `portHint` explains what a refused connection means for this service. */
function classifyFailure(failure: Extract<Fetched, { ok: false }>, portHint: string): ProbeResult {
  const { error, httpStatus, latencyMs } = failure;
  switch (error.code) {
    case "ADAPTER_TIMEOUT":
      return { status: "degraded", latencyMs, detail: "Antwortet nicht rechtzeitig (Zeitüberschreitung)" };
    case "ADAPTER_UNAVAILABLE":
      return httpStatus === undefined
        ? { status: "offline", latencyMs, detail: portHint }
        : { status: "degraded", latencyMs, detail: `Dienst meldet einen Serverfehler (HTTP ${httpStatus})` };
    case "UNAUTHENTICATED":
    case "FORBIDDEN":
      return {
        status: "degraded",
        latencyMs,
        detail: `Zugriff verweigert (HTTP ${httpStatus ?? "401/403"})`,
      };
    case "NOT_FOUND":
      return { status: "degraded", latencyMs, detail: "Erwarteter Endpunkt nicht vorhanden (HTTP 404)" };
    case "VALIDATION_FAILED":
      return { status: "degraded", latencyMs, detail: "Antwort hat ein unerwartetes Format" };
    default:
      // Any other HTTP answer (409, 429, ...) still proves a live process that refuses the probe.
      return httpStatus === undefined
        ? { status: "unknown", latencyMs, detail: "Zustand nicht bestimmbar" }
        : { status: "degraded", latencyMs, detail: `Dienst antwortet mit HTTP ${httpStatus}` };
  }
}

// ---- Qwen (llama-server) -----------------------------------------------------------------------------------------------

/**
 * `GET /v1/models` is the only readiness check the installer itself uses (IP:348). While the model loads llama-server
 * answers 503; that status is an Annahme (unbelegt) from llama.cpp, so on any 5xx the optional `/health` endpoint
 * (also an Annahme) is asked for a more precise detail and its failure is ignored.
 */
export async function probeQwen(env: ProbeEnv): Promise<ProbeResult> {
  const models = await get(env.qwen, env.clock, "/v1/models", { operation: "probeQwen" });
  if (models.ok) {
    const ids = parseModelIds(models.body);
    return {
      status: "online",
      latencyMs: models.latencyMs,
      detail: ids.length > 0 ? `Bereit, Modell ${ids.join(", ")}` : "Bereit (Antwort ohne Modellliste)",
      models: ids,
    };
  }
  const base = classifyFailure(
    models,
    "Port 43692 geschlossen: llama-server läuft nicht (Aufgabe JARVIS_Qwen)",
  );
  if (models.httpStatus !== undefined && models.httpStatus >= 500) {
    const health = await get(env.qwen, env.clock, "/health", { operation: "probeQwenHealth" });
    if (health.ok) return { ...base, detail: "/v1/models meldet einen Fehler, /health meldet bereit" };
    if (health.httpStatus === 503)
      return { ...base, detail: "Modell wird geladen (/health: 503, Annahme (unbelegt))" };
  }
  return base;
}

// ---- Hermes ---------------------------------------------------------------------------------------------------------------

/** `GET /health` needs no key (docs/MAPPING/hermes.md §3.2): `{"status":"ok",...}`. */
export async function probeHermesApi(env: ProbeEnv): Promise<ProbeResult> {
  const health = await get(env.hermesApi, env.clock, "/health", { operation: "probeHermesApi" });
  if (!health.ok)
    return classifyFailure(health, "Port 43693 geschlossen: Hermes-Gateway läuft nicht (WSL gestoppt?)");
  const status = (health.body as { status?: unknown } | null)?.status;
  return status === "ok"
    ? { status: "online", latencyMs: health.latencyMs, detail: "Gateway meldet ok" }
    : { status: "degraded", latencyMs: health.latencyMs, detail: "Gateway meldet keinen ok-Zustand" };
}

/** Model list of the Hermes API server; needs the Bearer key (`GET /v1/models`, expected id `jarvis`). */
export async function probeHermesModels(env: ProbeEnv): Promise<ProbeResult> {
  const key = await env.hermesKey();
  if (!key) {
    const health = await probeHermesApi(env);
    return { ...health, detail: `${health.detail}; Modellliste: kein API-Key konfiguriert`, models: [] };
  }
  const models = await get(env.hermesApi, env.clock, "/v1/models", {
    operation: "probeHermesModels",
    headers: { authorization: `Bearer ${key}` },
  });
  if (!models.ok) {
    const failure = classifyFailure(
      models,
      "Port 43693 geschlossen: Hermes-Gateway läuft nicht (WSL gestoppt?)",
    );
    return { ...failure, models: [] };
  }
  const ids = parseModelIds(models.body);
  return {
    status: "online",
    latencyMs: models.latencyMs,
    detail: ids.length > 0 ? `Modell ${ids.join(", ")}` : "Antwort ohne Modellliste",
    models: ids,
  };
}

/**
 * `GET /api/health` of the Hermes dashboard. Path and authentication are Annahme (unbelegt): a 401/403 proves that the
 * process listens, a 404 that the path is wrong.
 */
export async function probeHermesDashboard(env: ProbeEnv): Promise<ProbeResult> {
  const health = await get(env.hermesDashboard, env.clock, "/api/health", {
    operation: "probeHermesDashboard",
  });
  if (health.ok) return { status: "online", latencyMs: health.latencyMs, detail: "Erreichbar" };
  if (health.httpStatus === 401 || health.httpStatus === 403)
    return {
      status: "online",
      latencyMs: health.latencyMs,
      detail: `Erreichbar, verlangt Anmeldung (HTTP ${health.httpStatus}, Annahme (unbelegt))`,
    };
  if (health.httpStatus === 404)
    return {
      status: "unknown",
      latencyMs: health.latencyMs,
      detail: "Port antwortet, /api/health existiert nicht (Pfad unbelegt)",
    };
  return classifyFailure(
    health,
    "Port 43691 geschlossen: hermes-dashboard.service läuft nicht (WSL gestoppt?)",
  );
}

// ---- Voice -------------------------------------------------------------------------------------------------------------------

const VOICE_STATE_TEXT: Readonly<Record<string, string>> = {
  starting: "Startet (Mikrofon noch nicht geöffnet)",
  listening: "Wartet auf das Wake Word",
  command: "Verarbeitet einen Befehl",
  speaking: "Spricht",
  followup: "Folgefrage-Fenster offen",
};

/** The status server ignores the path and the method is GET only (docs/MAPPING/voice.md §0.1). */
export async function probeVoice(env: ProbeEnv): Promise<ProbeResult> {
  const status = await get(env.voice, env.clock, "/", { operation: "probeVoice" });
  if (!status.ok)
    return classifyFailure(
      status,
      "Port 43694 geschlossen: Dienst lädt noch Modelle (bis ca. 3 Minuten) oder ist gestoppt",
    );
  const state = (status.body as { state?: unknown } | null)?.state;
  if (typeof state !== "string" || !Object.hasOwn(VOICE_STATE_TEXT, state))
    return { status: "degraded", latencyMs: status.latencyMs, detail: "Antwort hat ein unerwartetes Format" };
  return {
    status: state === "starting" ? "degraded" : "online",
    latencyMs: status.latencyMs,
    detail: VOICE_STATE_TEXT[state] ?? "",
  };
}

// ---- WSL (Windows only, best effort) ---------------------------------------------------------------------------------------

const WSL_NOTE = "Best Effort (Ausgabe von wsl.exe -l -v)";

export async function probeWsl(env: ProbeEnv): Promise<ProbeResult> {
  const started = env.clock.now();
  let output: Buffer;
  try {
    output = await env.host.run("wsl.exe", ["-l", "-v"], { timeoutMs: env.timeoutMs, signal: env.signal });
  } catch (raw) {
    const code = (raw as { code?: unknown } | null)?.code;
    const timedOut = (raw as { killed?: unknown } | null)?.killed === true;
    return {
      status: code === "ENOENT" ? "offline" : "unknown",
      latencyMs: null,
      detail:
        code === "ENOENT"
          ? "wsl.exe nicht gefunden: WSL ist nicht installiert"
          : timedOut
            ? `wsl.exe antwortet nicht rechtzeitig. ${WSL_NOTE}`
            : `wsl.exe liefert keinen Status. ${WSL_NOTE}`,
    };
  }
  const latencyMs = Math.max(0, Math.round(env.clock.now() - started));
  const distro = parseWslList(decodeCommandOutput(output)).find((entry) => entry.name === env.wslDistro);
  if (!distro) {
    return {
      status: "offline",
      latencyMs,
      detail: `Distribution ${env.wslDistro} nicht gefunden. ${WSL_NOTE}`,
    };
  }
  switch (distro.state) {
    case "running":
      return { status: "online", latencyMs, detail: `${distro.name} läuft. ${WSL_NOTE}` };
    case "stopped":
      return { status: "offline", latencyMs, detail: `${distro.name} ist gestoppt. ${WSL_NOTE}` };
    default:
      return {
        status: "unknown",
        latencyMs,
        detail: `${distro.name}: Zustand '${distro.rawState}'. ${WSL_NOTE}`,
      };
  }
}

// ---- Control API (this process) ---------------------------------------------------------------------------------------------

export function describeUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
