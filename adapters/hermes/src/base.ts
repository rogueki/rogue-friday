import type { AdapterManifest } from "@friday/sdk";
import {
  AdapterError,
  normalizeError,
  type AdapterContext,
  type AdapterHealthReport,
  type CapabilitySet,
  type FridayAdapter,
} from "@friday/adapter-core";
import { createClients, type HermesClients } from "./clients";
import { readSettings, type HermesSettings } from "./config";
import { KanbanApi } from "./kanban-api";
import { KanbanEventFeed, WebSocketKanbanTransport, type KanbanEventTransport } from "./kanban-feed";

export interface HermesAdapterOptions {
  /** Replaces the WebSocket event transport (tests). */
  eventTransport?: KanbanEventTransport;
}

export interface HealthProbeResult {
  status?: "online" | "degraded";
  message?: string;
  errorCode?: string;
}

export interface Ready {
  context: AdapterContext;
  settings: HermesSettings;
  clients: HermesClients;
  kanban: KanbanApi;
  feed: KanbanEventFeed;
  signal: AbortSignal;
}

const MAX_BACKOFF_MS = 30_000;
const SHUTDOWN_SETTLE_MS = 25;

const HEALTH_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Authentifizierung bei Hermes fehlgeschlagen (Schlüssel bzw. Dashboard-Token prüfen)",
  FORBIDDEN: "Zugriff auf Hermes verweigert",
  ADAPTER_TIMEOUT: "Zeitüberschreitung beim Zugriff auf Hermes",
  NOT_FOUND: "Hermes-Schnittstelle nicht gefunden (Version oder Kanban-Plugin prüfen)",
  VALIDATION_FAILED: "Hermes liefert unerwartete Daten (Version prüfen)",
};

export function healthMessage(error: AdapterError): string {
  return HEALTH_MESSAGES[error.code] ?? "Hermes ist nicht erreichbar";
}

/**
 * Lifecycle shared by the three Hermes adapters: settings, credentials, HTTP clients, the Kanban event feed, the
 * background event loop and health. Subclasses add their port methods, `pollCycle()` and `probe()`.
 */
export abstract class HermesAdapterBase implements FridayAdapter {
  abstract readonly manifest: AdapterManifest;

  protected context: AdapterContext | undefined;
  protected settings: HermesSettings | undefined;
  protected clients: HermesClients | undefined;
  protected kanban: KanbanApi | undefined;
  protected feed: KanbanEventFeed | undefined;
  protected abort = new AbortController();
  protected stopped = true;

  private inFlightPoll: Promise<number> | undefined;
  private cancelPollTimer: (() => void) | undefined;
  private failures = 0;

  constructor(protected readonly options: HermesAdapterOptions = {}) {}

  /** Number of events to look back in each board's event history before the tail (activity history). */
  protected historyDepth(): number {
    return 0;
  }

  /** Called at the end of `initialize` with all dependencies in place (no network access allowed). */
  protected onInitialize(): void {}

  /** Called by `shutdown` before references are dropped. */
  protected onShutdown(): void {}

  /** One cycle of the adapter's event sources; emits canonical events and returns their number. */
  protected abstract pollCycle(): Promise<number>;

  /** Cheap, single-attempt liveness probe; throws on failure. */
  protected abstract probe(): Promise<HealthProbeResult>;

  async initialize(context: AdapterContext): Promise<void> {
    const settings = readSettings(context.config);
    this.abort = new AbortController();
    context.signal.addEventListener("abort", () => this.abort.abort(context.signal.reason), { once: true });
    const clients = createClients(context, settings, this.abort.signal);
    this.context = context;
    this.settings = settings;
    this.clients = clients;
    this.kanban = new KanbanApi(clients.dashboard);
    this.feed = new KanbanEventFeed({
      dashboard: clients.dashboard,
      transport: this.options.eventTransport ?? new WebSocketKanbanTransport(),
      boards: settings.boards,
      startCursor: settings.eventsStartCursor,
      drainMs: settings.eventsDrainMs,
      historyDepth: this.historyDepth(),
      signal: this.abort.signal,
    });
    this.failures = 0;
    this.stopped = false;
    this.onInitialize();
    if (settings.pollIntervalMs > 0) this.schedulePoll(0);
  }

  async getCapabilities(): Promise<CapabilitySet> {
    return { capabilities: [...this.manifest.capabilities] };
  }

  async healthCheck(): Promise<AdapterHealthReport> {
    if (this.stopped || !this.context) {
      return {
        status: "offline",
        latencyMs: null,
        message: "Adapter ist nicht aktiv",
        errorCode: "ADAPTER_UNAVAILABLE",
      };
    }
    const clock = this.context.clock;
    const started = clock.now();
    try {
      const result = await this.probe();
      return {
        status: result.status ?? "online",
        latencyMs: Math.max(0, Math.round(clock.now() - started)),
        ...(result.message ? { message: result.message } : {}),
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(this.remoteVersion !== undefined ? { remoteVersion: this.remoteVersion } : {}),
      };
    } catch (raw) {
      const error = normalizeError(raw, { operation: "healthCheck" });
      return {
        status: error.code === "RATE_LIMITED" ? "degraded" : "offline",
        latencyMs: null,
        message: healthMessage(error),
        errorCode: error.code,
      };
    }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.cancelPollTimer?.();
    this.cancelPollTimer = undefined;
    const running = this.inFlightPoll?.catch(() => undefined);
    this.abort.abort(new DOMException("Adapter shutdown", "AbortError"));
    if (running) {
      await running;
      // Requests that were already on the wire when the signal fired still reach the server a moment later. Give them
      // that moment, so that nothing arrives after shutdown() has returned.
      await new Promise<void>((resolve) => {
        const cancel = this.context?.clock.setTimeout(resolve, SHUTDOWN_SETTLE_MS);
        if (!cancel) resolve();
      });
    }
    this.onShutdown();
    this.context = undefined;
    this.settings = undefined;
    this.clients = undefined;
    this.kanban = undefined;
    this.feed = undefined;
  }

  /** One poll cycle (also driven by the background loop); concurrent callers share the running cycle. */
  pollEvents(): Promise<number> {
    try {
      this.ready();
    } catch (error) {
      return Promise.reject(error);
    }
    this.inFlightPoll ??= this.pollCycle().finally(() => {
      this.inFlightPoll = undefined;
    });
    return this.inFlightPoll;
  }

  /** Probe shared by tasks and agents: dashboard health, token validity and the configured boards. */
  protected async probeDashboard(): Promise<HealthProbeResult> {
    const { kanban, settings } = this.ready();
    const health = await kanban.health();
    if (!health.ok) {
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Das Hermes-Dashboard meldet sich nicht gesund.",
        retryable: true,
      });
    }
    this.logVersion(health.displayVersion, health.commit);
    const boards = await kanban.boards(undefined, { probe: true });
    const live = new Set(boards.filter((board) => !board.archived).map((board) => board.slug));
    const missing = settings.boards.filter((board) => !live.has(board));
    if (missing.length > 0) {
      return {
        status: "degraded",
        message: `Kanban-Board nicht gefunden: ${missing.join(", ")}`,
        errorCode: "NOT_FOUND",
      };
    }
    // The Kanban dispatcher lives in the gateway: without it, ready tasks are never picked up.
    if ((await kanban.status()).gatewayRunning === false) {
      return {
        status: "degraded",
        message: "Das Hermes-Gateway läuft nicht: Aufgaben werden nicht abgearbeitet",
        errorCode: "GATEWAY_STOPPED",
      };
    }
    return {};
  }

  protected ready(): Ready {
    const { context, settings, clients, kanban, feed } = this;
    if (this.stopped || !context || !settings || !clients || !kanban || !feed) {
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Der Adapter ist nicht aktiv.",
        retryable: false,
      });
    }
    return { context, settings, clients, kanban, feed, signal: this.abort.signal };
  }

  /** Dashboard version from the last health probe (`displayVersion`, else the short commit); undefined until probed. */
  private remoteVersion: string | null | undefined;
  /** Logs the dashboard version once (the installer does not pin Hermes; docs/MAPPING/hermes.md §1). */
  private versionLogged = false;
  protected logVersion(version: string | null, commit: string | null): void {
    this.remoteVersion = version ?? commit?.slice(0, 12) ?? null;
    if (this.versionLogged || !this.context) return;
    this.versionLogged = true;
    this.context.logger.info("Hermes Dashboard erkannt", {
      version: version ?? "unbekannt",
      commit: commit?.slice(0, 12) ?? "unbekannt",
    });
  }

  private schedulePoll(delayMs: number): void {
    const context = this.context;
    const settings = this.settings;
    if (!context || !settings || this.stopped) return;
    this.cancelPollTimer = context.clock.setTimeout(() => {
      if (this.stopped) return;
      this.pollEvents()
        .then(() => {
          this.failures = 0;
        })
        .catch((error: unknown) => {
          this.failures += 1;
          context.logger.warn("Hermes-Event-Zyklus fehlgeschlagen", {
            code: normalizeError(error).code,
            failures: this.failures,
          });
        })
        .finally(() => {
          const backoff = Math.min(MAX_BACKOFF_MS, settings.pollIntervalMs * 2 ** Math.min(this.failures, 5));
          this.schedulePoll(this.failures === 0 ? settings.pollIntervalMs : backoff);
        });
    }, delayMs);
  }
}
