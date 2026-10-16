import { existsSync } from "node:fs";
import { join } from "node:path";
import { getContractValidator } from "@friday/adapter-core";
import {
  ApprovalTokenService,
  LoginRateLimiter,
  SqliteNonceStore,
  SqliteSessionStore,
  SERVER_KEY_FILE,
  deriveKey,
  loadOrCreateServerKey,
} from "@friday/auth";
import type { FridayConfig } from "@friday/config";
import { ScenarioEngine, type MockWorld } from "@friday/mock-data";
import {
  canonicalJson,
  createFridayMetrics,
  createLogger,
  redact,
  type FridayMetrics,
  type Logger,
} from "@friday/observability";
import type { AdapterHealth, FridayEvent } from "@friday/sdk";
import { kvGet, kvSet, openDatabase } from "../db/database";
import { AuditAnchor } from "../db/audit-anchor";
import { migrateLegacyAuditAnchor } from "../db/audit-anchor-migration";
import { AuditStore, type AuditVerification } from "../db/audit-store";
import { AdapterOverrideStore, CommandHistoryStore, IdempotencyStore, LibraryStore } from "../db/stores";
import { EventHub } from "../realtime/hub";
import { AuthService } from "../security/auth-service";
import { AdapterSettingsService } from "../services/adapter-settings";
import { DEFAULT_ASSISTANT_NAME, OrbService, OverviewService, StatusService, summarizeAdapters } from "../services/core-views";
import { SettingsService, seedLibrary } from "../services/settings";
import { ContentStudioKeysService } from "../services/content-studio-keys";
import { ContentStudioProviderService } from "../services/content-studio-providers";
import { LogBuffer, withLogBuffer } from "../services/log-buffer";
import { FrontendTelemetryService } from "../services/telemetry";
import { createRuntimeSecrets, createWorld, wireAdapters } from "./adapter-wiring";
import type { AuditRecorder, ResponseValidationMode, Runtime } from "./types";

export interface CreateRuntimeOptions {
  config: FridayConfig;
  providerFetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  /** `:memory:` for tests. Defaults to `<dataDir>/dashboard.sqlite`. */
  dbPath?: string;
  responseValidation?: ResponseValidationMode;
  /** The mock world follows the wall clock (dev/prod mock). Tests keep it off and drive the clock. */
  realTimeWorld?: boolean;
  healthIntervalMs?: number;
  /** Starts periodic work (metrics events, purges, telemetry). Tests that need quiet streams switch it off. */
  background?: boolean;
  buildVersion?: string;
  /** Throw when an event payload violates its schema (tests). */
  strictEvents?: boolean;
  worldSeed?: number;
  worldProfile?: string;
  /** Wall clock for sessions, approval tokens and re-authentication windows (tests move it to prove expiry). */
  now?: () => number;
  /** Lifetime of approval tokens in ms; defaults to the `@friday/auth` value (2 minutes). */
  approvalTokenTtlMs?: number;
}

const HEALTH_GAUGE: Record<string, "healthy" | "degraded" | "down" | "unknown"> = {
  online: "healthy",
  degraded: "degraded",
  offline: "down",
  paused: "down",
  unknown: "unknown",
};

export async function createRuntime(options: CreateRuntimeOptions): Promise<Runtime> {
  const { config } = options;
  const env = options.env ?? process.env;
  const startedAt = new Date();
  const buildVersion = options.buildVersion ?? process.env.FRIDAY_BUILD_VERSION ?? "1.0.0";

  const logBuffer = new LogBuffer({ redactEmails: config.logging.redactEmails });
  const baseLogger =
    options.logger ??
    createLogger({
      service: "control-api",
      level: config.logging.level,
      redaction: { redactEmails: config.logging.redactEmails },
      ...(config.logging.file.enabled
        ? { file: { dir: config.paths.logDir, maxBytes: config.logging.file.maxBytes, maxFiles: config.logging.file.maxFiles } }
        : {}),
    });
  // Every log call also lands (redacted) in the ring buffer that serves the adapter logs of the System page.
  const logger = withLogBuffer(baseLogger, logBuffer);
  const metrics: FridayMetrics = createFridayMetrics();
  for (const warning of config.warnings) logger.warn(warning);

  const db = openDatabase(options.dbPath ?? join(config.paths.dataDir, "dashboard.sqlite"));
  const validator = getContractValidator();
  const responseValidation: ResponseValidationMode = options.responseValidation ?? (config.dev.responseValidation ? "log" : "off");

  // ---- security primitives ------------------------------------------------------------------------------------
  if (ContentStudioKeysService.hasPersisted(db) && !existsSync(join(config.paths.dataDir, SERVER_KEY_FILE))) {
    db.close();
    throw new Error("Content Studio encrypted keys require the original auth.key; restore it before startup");
  }
  const serverKey = loadOrCreateServerKey(config.paths.dataDir);
  if (!serverKey.permissionsRestricted) logger.warn("Berechtigungen von auth.key konnten nicht eingeschränkt werden", { path: serverKey.path });
  const sessions = new SqliteSessionStore(db, {
    defaultTtlMs: config.auth.sessionTtlMinutes * 60_000,
    defaultIdleTimeoutMs: config.auth.idleTimeoutMinutes * 60_000,
    ...(options.now ? { now: options.now } : {}),
  });
  const approvalTokens = new ApprovalTokenService({
    key: deriveKey(serverKey.key, "approval"),
    nonceStore: new SqliteNonceStore(db, options.now),
    ...(options.now ? { now: options.now } : {}),
    ...(options.approvalTokenTtlMs !== undefined ? { ttlMs: options.approvalTokenTtlMs } : {}),
  });
  const settingsHolder: { current?: SettingsService } = {};
  const auth = new AuthService({
    config,
    sessions,
    csrfKey: deriveKey(serverKey.key, "csrf"),
    approvalTokens,
    limiter: new LoginRateLimiter(),
    env,
    ...(options.now ? { now: options.now } : {}),
    displayName: () => settingsHolder.current?.get().profile.displayName ?? config.auth.ownerUsername,
  });

  // ---- persistence --------------------------------------------------------------------------------------------
  const auditAnchor = new AuditAnchor({
    db,
    key: deriveKey(serverKey.key, "audit-head"),
    // An in-memory database (tests) has no data directory to anchor in; the kv row still anchors the chain.
    ...(options.dbPath === ":memory:" ? {} : { file: join(config.paths.dataDir, "audit-head.json") }),
    onError: (error) => logger.error("Audit-Anker konnte nicht geschrieben werden", { error: error instanceof Error ? error.message : String(error) }),
  });
  const audit = new AuditStore(db, undefined, auditAnchor);
  if (!serverKey.created && audit.verify().reason === "anchor_tampered" &&
      migrateLegacyAuditAnchor(db, serverKey.key, join(config.paths.dataDir, "audit-head.json"), audit)) {
    logger.warn("JARVIS-Audit-Anker geprüft und mit F.R.I.D.A.Y.-Schlüssel neu versiegelt");
  }
  // A freshly generated server key next to an existing audit trail means auth.key was lost: the old anchors cannot be
  // verified any more, but the data is intact. Re-seal them (only if the chain verifies) instead of reporting tampering.
  if (serverKey.created && audit.reanchorAfterKeyLoss()) logger.warn("auth.key wurde neu erzeugt: Audit-Anker mit dem neuen Schlüssel neu versiegelt; angemeldete Clients holen ein neues CSRF-Token");
  const idempotency = new IdempotencyStore(db);
  const commands = new CommandHistoryStore(db);
  const library = new LibraryStore(db);
  const adapterOverrides = new AdapterOverrideStore(db);
  seedLibrary(library, config, validator, logger);

  // ---- event hub ----------------------------------------------------------------------------------------------
  const persistedSequence = Number(kvGet(db, "hub.sequence") ?? "0");
  const hub = new EventHub({
    logger,
    metrics,
    validator,
    ringBufferSize: config.realtime.ringBufferSize,
    heartbeatMs: config.realtime.heartbeatSeconds * 1000,
    // The persisted mark can lag by a few dozen events after a crash; the margin keeps sequences monotonic.
    startSequence: persistedSequence > 0 ? persistedSequence + 100 : 0,
    persistSequence: (sequence) => kvSet(db, "hub.sequence", String(sequence)),
    strict: options.strictEvents === true,
  });

  // ---- adapters -----------------------------------------------------------------------------------------------
  const world: MockWorld | undefined = createWorld(config, {
    realTime: options.realTimeWorld ?? true,
    // One global sequence: the mock world numbers its events (and `ActivityEvent.sequence`) with the hub's counter, so
    // an activity item's sequence equals the envelope sequence of its `friday.activity.appended` event.
    assistantName: () => settingsHolder.current?.area("profile").assistantName ?? DEFAULT_ASSISTANT_NAME,
    nextSequence: (floor) => {
      hub.ensureSequenceAtLeast(floor);
      return hub.latestSequence + 1;
    },
    ...(options.worldSeed !== undefined ? { seed: options.worldSeed } : {}),
    ...(options.worldProfile ? { profile: options.worldProfile } : {}),
  });
  // Seeded activity is numbered before the hub existed; keep every live event above it.
  if (world) hub.ensureSequenceAtLeast(world.state.sequence);
  const engine = world && config.dataMode === "mock" ? ScenarioEngine.for(world) : undefined;
  const secrets = createRuntimeSecrets();
  const wiring = wireAdapters({
    config,
    logger,
    hub,
    world,
    overrides: adapterOverrides,
    secrets,
    env,
    ...(options.healthIntervalMs ? { healthIntervalMs: options.healthIntervalMs } : {}),
  });
  const { registry } = wiring;
  // Restarting an adapter and reading its log lines are control-plane functions (registry + log buffer), not adapter
  // capabilities. With the scenario console (mock) the capability stays a switch the console can toggle.
  if (!engine) registry.provideControlPlaneCapabilities(["system.restartAdapter", "system.openLogs"]);

  const adapterSettings = new AdapterSettingsService(wiring, adapterOverrides, secrets, config.dataMode);
  const settings = new SettingsService(db, config, validator, library, () => adapterSettings.list());
  let contentStudioKeys: ContentStudioKeysService;
  try {
    contentStudioKeys = new ContentStudioKeysService(db, deriveKey(serverKey.key, "content-studio-keys"), env);
  } catch (error) {
    db.close();
    throw error;
  }
  const contentStudioProviders = new ContentStudioProviderService(db, contentStudioKeys, options.providerFetch);
  settingsHolder.current = settings;

  const assistantName = (): string => settings.get().profile.assistantName ?? DEFAULT_ASSISTANT_NAME;
  const orb = new OrbService({ registry, world, dataMode: config.dataMode, assistantName });
  const status = new StatusService({ registry, hub, dataMode: config.dataMode, version: buildVersion, startedAt, world, orbMode: () => orb.mode, assistantName });

  const capabilities = (): ReturnType<Runtime["capabilities"]> => registry.aggregateCapabilities();
  const capabilityEnabled = (capability: string): boolean => {
    const [moduleName, flag] = capability.split(".");
    const module = moduleName ? (capabilities().modules as unknown as Record<string, Record<string, unknown> | undefined>)[moduleName] : undefined;
    if (!module || !flag || !(flag in module)) return true;
    return module[flag] === true;
  };
  const overview = new OverviewService({ registry, status, orb, capabilityEnabled });
  const telemetry = new FrontendTelemetryService(metrics, logger, undefined, options.now);

  // ---- audit --------------------------------------------------------------------------------------------------
  let verification: AuditVerification = audit.verify();
  if (!verification.valid) {
    logger.error("Audit-Hashkette ist beschädigt", { brokenAtSequence: verification.brokenAtSequence, reason: verification.reason });
  } else {
    logger.info("Audit-Hashkette geprüft", { length: verification.length });
  }
  const auditRecorder: AuditRecorder = {
    record(draft) {
      try {
        const safe = { ...draft, ...(draft.context ? { context: redact(draft.context) as Record<string, unknown> } : {}) };
        const event = audit.append(safe);
        hub.publish("control-api://core", {
          type: "friday.audit.appended",
          subject: `audit/${event.id}`,
          data: event,
          correlationId: event.correlationId,
        });
      } catch (error) {
        logger.error("Audit-Eintrag konnte nicht geschrieben werden", { error: error instanceof Error ? error.message : String(error) });
      }
    },
    verification: () => verification,
    verifyNow() {
      verification = audit.verify();
      return verification;
    },
  };

  // ---- background work ----------------------------------------------------------------------------------------
  const timers: NodeJS.Timeout[] = [];
  const unsubscribers: Array<() => void> = [];
  let started = false;

  /**
   * Forces a health check of every adapter (a successful check also re-reads the adapter's capabilities, so dev capability
   * toggles show up at once). A failing adapter is re-checked until the monitor has made up its mind
   * (DEGRADED after the first failure, OFFLINE after `failureThreshold`), so a dev "adapter offline" shows as offline at
   * once instead of after three polling intervals.
   */
  const refreshAdapters = async (): Promise<void> => {
    await Promise.all(
      registry
        .listAdapters()
        .filter((info) => info.enabled)
        .map(async (info) => {
          try {
            let health = await registry.checkHealth(info.manifest.id);
            for (let attempt = 0; attempt < 5 && health.status === "degraded" && health.consecutiveFailures > 0; attempt += 1) {
              health = await registry.checkHealth(info.manifest.id);
            }
          } catch {
            // an adapter that cannot even be checked is reported by the registry itself
          }
        }),
    );
  };

  /** Mock mode: the world is the source of core events and of adapter availability changes. */
  const bridgeWorld = (): void => {
    if (!world) return;
    unsubscribers.push(
      world.events.subscribe((event: FridayEvent) => {
        if (event.source.startsWith("adapter://")) return; // forwarded by the mock adapters
        if (event.type === "friday.adapter.health_changed" || event.type === "friday.adapter.capabilities_changed") {
          // The registry re-derives both from a fresh health check and publishes its own change events.
          void refreshAdapters();
          return;
        }
        if (config.dataMode !== "mock" && event.type !== "friday.status.resync_required") return;
        hub.publish("control-api://core", {
          type: event.type,
          subject: event.subject,
          data: event.data,
          correlationId: event.correlationId,
          causationId: event.causationId,
        } as Parameters<EventHub["publish"]>[1]);
      }),
    );
  };

  /** Non-mock: derive orb/status changes from the event flow (debounced) and publish them as core events. */
  const trackDerivedState = (): void => {
    if (config.dataMode === "mock") return;
    let timer: NodeJS.Timeout | undefined;
    let orbSignature = "";
    let statusSignature = "";
    const evaluate = async (): Promise<void> => {
      try {
        const snapshot = await orb.snapshot();
        const { since: _since, audioLevel: _audio, sourceEventId: _source, ...stable } = snapshot.status;
        const signature = canonicalJson({ status: stable, layers: snapshot.layers });
        if (signature !== orbSignature) {
          orbSignature = signature;
          hub.publish("control-api://core", { type: "friday.orb.status_changed", subject: "orb/status", data: snapshot });
        }
        const current = status.get();
        const statusKey = canonicalJson({ ...current, uptimeSeconds: 0, eventStream: current.eventStream.state });
        if (statusKey !== statusSignature) {
          statusSignature = statusKey;
          hub.publish("control-api://core", { type: "friday.status.changed", subject: "status/overall", data: current });
        }
      } catch (error) {
        logger.warn("Orb-/Status-Ableitung fehlgeschlagen", { error: error instanceof Error ? error.message : String(error) });
      }
    };
    unsubscribers.push(
      hub.subscribe((event) => {
        if (event.source === "control-api://core" && (event.type === "friday.orb.status_changed" || event.type === "friday.status.changed")) return;
        clearTimeout(timer);
        timer = setTimeout(() => void evaluate(), 150);
        timer.unref?.();
      }),
    );
    unsubscribers.push(() => clearTimeout(timer));
  };

  const trackAdapterMetrics = (): void => {
    unsubscribers.push(
      hub.subscribe((event) => {
        if (event.type !== "friday.adapter.health_changed") return;
        const health = event.data as AdapterHealth;
        metrics.setAdapterHealth(health.adapterId, HEALTH_GAUGE[health.status] ?? "unknown");
      }),
    );
  };

  const publishSystemMetrics = async (): Promise<void> => {
    try {
      const system = registry.listAdapters().find((info) => info.manifest.category === "system");
      if (!system) return;
      const result = await registry.getPort("system").getSystemMetrics({}, { correlationId: `corr_${"0".repeat(26)}` });
      hub.publish(`adapter://${system.manifest.id}`, { type: "friday.system.metrics", subject: "system/metrics", data: result.data });
    } catch {
      // The system adapter being down is already visible as health; no metrics event is the correct signal.
    }
  };

  const runtime: Runtime = {
    config,
    env,
    logger,
    logBuffer,
    metrics,
    db,
    validator,
    hub,
    wiring,
    registry,
    world,
    engine,
    stores: { audit, idempotency, commands, library, adapterOverrides },
    auth,
    approvalTokens,
    settings,
    contentStudioKeys,
    contentStudioProviders,
    adapterSettings,
    status,
    orb,
    overview,
    telemetry,
    audit: auditRecorder,
    buildVersion,
    startedAt,
    responseValidation,
    refreshAdapters,
    capabilities,
    capabilityEnabled,
    renderMetrics() {
      // Adapter health is event-driven; sync the gauges with the registry so adapters that never changed state appear too.
      for (const info of registry.listAdapters()) {
        let state: "healthy" | "degraded" | "down" | "unknown" = "unknown";
        try {
          state = HEALTH_GAUGE[registry.getHealth(info.manifest.id).status] ?? "unknown";
        } catch {
          // an adapter without health information stays "unknown"
        }
        metrics.setAdapterHealth(info.manifest.id, state);
      }
      metrics.refreshDerived();
      return metrics.registry.renderPrometheus();
    },
    // Mock data lives on the world's (controllable) clock; its timestamps must not be compared with wall time.
    nowMs: () => world?.nowMs() ?? Date.now(),
    async start() {
      if (started) return;
      started = true;
      bridgeWorld();
      trackAdapterMetrics();
      const reports = await wiring.initialize();
      for (const report of reports) {
        if (report.error) logger.warn("Adapter nicht verfügbar", { category: report.category, provider: report.provider, state: report.state, error: report.error.message });
      }
      const overall = summarizeAdapters(registry.listAdapters());
      logger.info("Adapter geladen", { dataMode: config.dataMode, ...overall.summary });
      trackDerivedState();
      if (options.background !== false) {
        world?.startTelemetry({ metricsMs: 24 * 3_600_000, heartbeatMs: 10_000 });
        timers.push(setInterval(() => void publishSystemMetrics(), 5_000));
        timers.push(
          setInterval(() => {
            idempotency.purgeExpired();
            sessions.purgeExpired();
          }, 3_600_000),
        );
        for (const timer of timers) timer.unref?.();
      }
      idempotency.purgeExpired();
      sessions.purgeExpired();
    },
    async close() {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      world?.stopTelemetry();
      engine?.stop(false);
      await registry.shutdownAll();
      world?.dispose();
      await hub.close();
      db.close();
      logger.info("Control API beendet");
    },
  };
  return runtime;
}
