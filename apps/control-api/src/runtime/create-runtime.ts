import { join } from "node:path";
import { getContractValidator } from "@jarvis/adapter-core";
import {
  ApprovalTokenService,
  LoginRateLimiter,
  SqliteNonceStore,
  SqliteSessionStore,
  deriveKey,
  loadOrCreateServerKey,
} from "@jarvis/auth";
import type { JarvisConfig } from "@jarvis/config";
import { ScenarioEngine, type MockWorld } from "@jarvis/mock-data";
import {
  canonicalJson,
  createJarvisMetrics,
  createLogger,
  redact,
  type JarvisMetrics,
  type Logger,
} from "@jarvis/observability";
import type { AdapterHealth, JarvisEvent } from "@jarvis/sdk";
import { kvGet, kvSet, openDatabase } from "../db/database";
import { AuditStore, type AuditVerification } from "../db/audit-store";
import { AdapterOverrideStore, CommandHistoryStore, IdempotencyStore, LibraryStore } from "../db/stores";
import { worldCapabilities } from "@jarvis/adapter-mock";
import { EventHub } from "../realtime/hub";
import { AuthService } from "../security/auth-service";
import { AdapterSettingsService } from "../services/adapter-settings";
import { DEFAULT_ASSISTANT_NAME, OrbService, OverviewService, StatusService, summarizeAdapters } from "../services/core-views";
import { SettingsService, seedLibrary } from "../services/settings";
import { createRuntimeSecrets, createWorld, wireAdapters } from "./adapter-wiring";
import type { AuditRecorder, ResponseValidationMode, Runtime } from "./types";

export interface CreateRuntimeOptions {
  config: JarvisConfig;
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
  /** Lifetime of approval tokens in ms; defaults to the `@jarvis/auth` value (2 minutes). */
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
  const buildVersion = options.buildVersion ?? process.env.JARVIS_BUILD_VERSION ?? "1.0.0";

  const logger =
    options.logger ??
    createLogger({
      service: "control-api",
      level: config.logging.level,
      redaction: { redactEmails: config.logging.redactEmails },
      ...(config.logging.file.enabled
        ? { file: { dir: config.paths.logDir, maxBytes: config.logging.file.maxBytes, maxFiles: config.logging.file.maxFiles } }
        : {}),
    });
  const metrics: JarvisMetrics = createJarvisMetrics();
  for (const warning of config.warnings) logger.warn(warning);

  const db = openDatabase(options.dbPath ?? join(config.paths.dataDir, "dashboard.sqlite"));
  const validator = getContractValidator();
  const responseValidation: ResponseValidationMode = options.responseValidation ?? (config.dev.responseValidation ? "log" : "off");

  // ---- security primitives ------------------------------------------------------------------------------------
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
  const audit = new AuditStore(db);
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
    ...(options.worldSeed !== undefined ? { seed: options.worldSeed } : {}),
    ...(options.worldProfile ? { profile: options.worldProfile } : {}),
  });
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

  const adapterSettings = new AdapterSettingsService(wiring, adapterOverrides, secrets, config.dataMode);
  const settings = new SettingsService(db, config, validator, library, () => adapterSettings.list());
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
          type: "jarvis.audit.appended",
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
   * Mock adapters read their capabilities from the world; the registry caches them from the last (re)start. After a dev
   * toggle (or a scenario that changes capabilities) restart exactly the adapters whose cached set went stale.
   */
  const syncMockCapabilities = async (): Promise<void> => {
    if (!world) return;
    for (const entry of registry.describe()) {
      if (!entry.provider.startsWith("mock-")) continue;
      const expected = worldCapabilities(world, entry.category).join(",");
      const cached = [...entry.capabilities].sort().join(",");
      if (expected !== cached) await registry.restart(entry.adapterId).catch((error: unknown) => logger.warn("Adapter-Neustart nach Capability-Änderung fehlgeschlagen", { adapterId: entry.adapterId, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  /**
   * Forces a health check of every adapter. A failing adapter is re-checked until the monitor has made up its mind
   * (DEGRADED after the first failure, OFFLINE after `failureThreshold`), so a dev "adapter offline" shows as offline at
   * once instead of after three polling intervals.
   */
  const refreshAdapters = async (): Promise<void> => {
    await syncMockCapabilities();
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
      world.events.subscribe((event: JarvisEvent) => {
        if (event.source.startsWith("adapter://")) return; // forwarded by the mock adapters
        if (event.type === "jarvis.adapter.health_changed" || event.type === "jarvis.adapter.capabilities_changed") {
          // The registry re-derives both from a fresh health check and publishes its own change events.
          void refreshAdapters();
          return;
        }
        if (config.dataMode !== "mock" && event.type !== "jarvis.status.resync_required") return;
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
          hub.publish("control-api://core", { type: "jarvis.orb.status_changed", subject: "orb/status", data: snapshot });
        }
        const current = status.get();
        const statusKey = canonicalJson({ ...current, uptimeSeconds: 0, eventStream: current.eventStream.state });
        if (statusKey !== statusSignature) {
          statusSignature = statusKey;
          hub.publish("control-api://core", { type: "jarvis.status.changed", subject: "status/overall", data: current });
        }
      } catch (error) {
        logger.warn("Orb-/Status-Ableitung fehlgeschlagen", { error: error instanceof Error ? error.message : String(error) });
      }
    };
    unsubscribers.push(
      hub.subscribe((event) => {
        if (event.source === "control-api://core" && (event.type === "jarvis.orb.status_changed" || event.type === "jarvis.status.changed")) return;
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
        if (event.type !== "jarvis.adapter.health_changed") return;
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
      hub.publish(`adapter://${system.manifest.id}`, { type: "jarvis.system.metrics", subject: "system/metrics", data: result.data });
    } catch {
      // The system adapter being down is already visible as health; no metrics event is the correct signal.
    }
  };

  const runtime: Runtime = {
    config,
    env,
    logger,
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
    adapterSettings,
    status,
    orb,
    overview,
    audit: auditRecorder,
    buildVersion,
    startedAt,
    responseValidation,
    refreshAdapters,
    capabilities,
    capabilityEnabled,
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
