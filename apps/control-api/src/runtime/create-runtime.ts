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
import type { AdapterHealth, FridayEvent, VoiceStatus } from "@friday/sdk";
import { kvGet, kvSet, openDatabase } from "../db/database";
import { AuditAnchor } from "../db/audit-anchor";
import { migrateLegacyAuditAnchor } from "../db/audit-anchor-migration";
import { AuditStore, type AuditVerification } from "../db/audit-store";
import { AuditArchive } from "../db/audit-archive";
import { AdapterOverrideStore, CommandHistoryStore, IdempotencyStore, LibraryStore } from "../db/stores";
import { NotificationStore } from "../services/notification-store";
import { RetentionService } from "../services/retention";
import { EventHub } from "../realtime/hub";
import { AuthService } from "../security/auth-service";
import { AdapterSettingsService } from "../services/adapter-settings";
import { DEFAULT_ASSISTANT_NAME, OrbService, OverviewService, StatusService, summarizeAdapters } from "../services/core-views";
import { SettingsService, seedLibrary } from "../services/settings";
import { NativeApprovalRequests } from "../services/native-approval-requests";
import { PendingCommandClarifications } from "../services/pending-command-clarifications";
import { EncryptedClarifiedMailDrafts } from "../services/encrypted-clarified-mail-drafts";
import { ContentStudioKeysService } from "../services/content-studio-keys";
import { ObsidianVaultService } from "../services/obsidian-vault";
import { DurableMemoryService } from "../services/durable-memory";
import { SystemBackupService } from "../services/system-backup";
import { BackupJobsService } from "../services/backup-jobs";
import { WikiPathService } from "../services/wiki-path";
import { HimalayaAccountService } from "../services/himalaya-account";
import { TelegramGatewayService } from "../services/telegram-gateway";
import { MessagingGatewayService } from "../services/messaging-gateways";
import { TelephonyService } from "../services/telephony";
import { CloudTalkService } from "../services/cloudtalk";
import { HimalayaSendService } from "../services/himalaya-send";
import { MailAccountsService } from "../services/mail-accounts";
import { MailSendService } from "../services/mail-send";
import { MessengerSendService } from "../services/messenger-send";
import { MessengerCatalogService } from "../services/messenger-catalog";
import { MessengerProviderService } from "../services/messenger-provider";
import { MessengerInboundService } from "../services/messenger-inbound";
import { CalDavCreateService } from "../services/caldav-create";
import { LocalCalendarService } from "../services/local-calendar";
import { CalendarAccountsService } from "../services/calendar-accounts";
import { HermesSkillKeysService } from "../services/hermes-skill-keys";
import { HermesConfigService } from "../services/hermes-config";
import { CodingRunsService } from "../services/coding-runs";
import { ResearchService } from "../services/research";
import { hermesResearchSynthesizer, type ResearchModelSynthesize } from "../services/research-model";
import { ResearchSetupService, type ResearchSetupProbe, type ResearchSetupRun } from "../services/research-setup";
import { CodingVoiceRepositoryService } from "../services/coding-voice-repository";
import { ContentStudioProviderService } from "../services/content-studio-providers";
import { ContentStudioPlanService } from "../services/content-studio-plan";
import { ContentStudioProductionService } from "../services/content-studio-production";
import { SkillsService } from "../services/skills";
import { PowerPointService } from "../services/powerpoint";
import { OnboardingService } from "../services/onboarding";
import { LogBuffer, withLogBuffer } from "../services/log-buffer";
import { FrontendTelemetryService } from "../services/telemetry";
import { createRuntimeSecrets, createWorld, wireAdapters } from "./adapter-wiring";
import type { AuditRecorder, ResponseValidationMode, Runtime } from "./types";

export interface CreateRuntimeOptions {
  config: FridayConfig;
  providerFetch?: typeof fetch;
  researchPageFetch?: (url: string) => Promise<string>;
  researchSynthesize?: ResearchModelSynthesize;
  researchSetupRun?: ResearchSetupRun;
  researchSetupProbe?: ResearchSetupProbe;
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
  if ((ContentStudioKeysService.hasPersisted(db) || PendingCommandClarifications.hasPersisted(db)
      || EncryptedClarifiedMailDrafts.hasPersisted(db)) && !existsSync(join(config.paths.dataDir, SERVER_KEY_FILE))) {
    db.close();
    throw new Error("Persisted encrypted local records require the original auth.key; restore it before startup");
  }
  const serverKey = loadOrCreateServerKey(config.paths.dataDir);
  if (!serverKey.permissionsRestricted) logger.warn("Berechtigungen von auth.key konnten nicht eingeschränkt werden", { path: serverKey.path });
  const voiceBridgeKey = loadOrCreateServerKey(join(config.paths.dataDir, "voice-bridge"));
  const calendarBridgeKey = loadOrCreateServerKey(join(config.paths.dataDir, "calendar-bridge"));
  const mailBridgeKey = loadOrCreateServerKey(join(config.paths.dataDir, "mail-bridge"));
  const hermesMemoryBridgeKey = loadOrCreateServerKey(join(config.paths.dataDir, "hermes-memory-bridge"));
  const messengerInboundBridgeKey = loadOrCreateServerKey(join(config.paths.dataDir, "hermes-messenger-bridge"));
  if (!calendarBridgeKey.permissionsRestricted) logger.warn("Calendar bridge key permissions could not be restricted", { path: calendarBridgeKey.path });
  if (!mailBridgeKey.permissionsRestricted) logger.warn("Mail bridge key permissions could not be restricted", { path: mailBridgeKey.path });
  if (!hermesMemoryBridgeKey.permissionsRestricted) logger.warn("Hermes memory bridge key permissions could not be restricted", { path: hermesMemoryBridgeKey.path });
  if (!messengerInboundBridgeKey.permissionsRestricted) logger.warn("Hermes messenger bridge key permissions could not be restricted", { path: messengerInboundBridgeKey.path });
  if (!voiceBridgeKey.permissionsRestricted) logger.warn("Berechtigungen des Voice-Bridge-Schlüssels konnten nicht eingeschränkt werden", { path: voiceBridgeKey.path });
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
    ownerUsername: () => kvGet(db, "auth.ownerUsername") ?? config.auth.ownerUsername,
    setOwnerIdentity: (username, displayName) => {
      kvSet(db, "auth.ownerUsername", username);
      const service = settingsHolder.current;
      if (service) service.patch({ profile: { ...service.area("profile"), displayName } });
    },
    localLoginRequired: () => settingsHolder.current?.area("security").loginRequired !== false || settingsHolder.current?.area("security").allowRemoteAccess === true,
    securitySettings: () => settingsHolder.current?.area("security") ?? {
      sessionTimeoutMinutes: config.auth.sessionTtlMinutes,
      reauthWindowMinutes: config.auth.reauthWindowMinutes,
    },
  });

  // ---- persistence --------------------------------------------------------------------------------------------
  const auditAnchor = new AuditAnchor({
    db,
    key: deriveKey(serverKey.key, "audit-head"),
    // An in-memory database (tests) has no data directory to anchor in; the kv row still anchors the chain.
    ...(options.dbPath === ":memory:" ? {} : { file: join(config.paths.dataDir, "audit-head.json") }),
    onError: (error) => logger.error("Audit-Anker konnte nicht geschrieben werden", { error: error instanceof Error ? error.message : String(error) }),
  });
  const auditArchive = new AuditArchive(db, join(config.paths.dataDir, "audit-archive"));
  const audit = new AuditStore(db, undefined, auditAnchor, auditArchive);
  if (!serverKey.created && audit.verify().reason === "anchor_tampered" &&
      migrateLegacyAuditAnchor(db, serverKey.key, join(config.paths.dataDir, "audit-head.json"), audit)) {
    logger.warn("JARVIS-Audit-Anker geprüft und mit F.R.I.D.A.Y.-Schlüssel neu versiegelt");
  }
  // A freshly generated server key next to an existing audit trail means auth.key was lost: the old anchors cannot be
  // verified any more, but the data is intact. Re-seal them (only if the chain verifies) instead of reporting tampering.
  if (serverKey.created && audit.reanchorAfterKeyLoss()) logger.warn("auth.key wurde neu erzeugt: Audit-Anker mit dem neuen Schlüssel neu versiegelt; angemeldete Clients holen ein neues CSRF-Token");
  const idempotency = new IdempotencyStore(db);
  const notifications = new NotificationStore(db);
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
    notifications,
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
  const secrets = createRuntimeSecrets(db, deriveKey(serverKey.key, "calendar-feed"));
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
  const caldavCreate = new CalDavCreateService(db, registry, deriveKey(serverKey.key, "caldav-create-preview"), () => {
    const entry = wiring.entries.get("calendar");
    return JSON.stringify([
      entry?.provider, entry?.enabled, entry?.config?.mode,
      secrets.get("caldav-calendar", "calendarUrl"), secrets.get("caldav-calendar", "username"), secrets.get("caldav-calendar", "password"),
    ]);
  });
  // Restarting an adapter and reading its log lines are control-plane functions (registry + log buffer), not adapter
  // capabilities. With the scenario console (mock) the capability stays a switch the console can toggle.
  if (!engine) registry.provideControlPlaneCapabilities(["system.restartAdapter", "system.openLogs"]);

  const adapterSettings = new AdapterSettingsService(wiring, adapterOverrides, secrets, config.dataMode);
  const settings = new SettingsService(db, config, validator, library, () => adapterSettings.list());
  if (world) world.state.settings.approvals = structuredClone(settings.area("approvals"));
  const nativeApprovals = new NativeApprovalRequests(db, settings, validator, options.now);
  let pendingCommandClarifications: PendingCommandClarifications;
  let encryptedClarifiedMailDrafts: EncryptedClarifiedMailDrafts;
  try {
    pendingCommandClarifications = new PendingCommandClarifications(db,
      deriveKey(serverKey.key, "pending-command-clarifications"), options.now);
    encryptedClarifiedMailDrafts = new EncryptedClarifiedMailDrafts(db,
      deriveKey(serverKey.key, "encrypted-clarified-mail-drafts"), options.now);
  } catch (error) {
    db.close();
    throw error;
  }
  logger.setLevel?.(settings.area("developer").logLevel);
  let contentStudioKeys: ContentStudioKeysService;
  try {
    contentStudioKeys = new ContentStudioKeysService(db, deriveKey(serverKey.key, "content-studio-keys"), env);
  } catch (error) {
    db.close();
    throw error;
  }
  const contentStudioProviders = new ContentStudioProviderService(db, contentStudioKeys, options.providerFetch);
  const contentStudioPlan = new ContentStudioPlanService(db);
  const onboarding = new OnboardingService(db);
  const obsidianVault = new ObsidianVaultService(config.paths.dataDir);
  const durableMemory = new DurableMemoryService(config.paths.dataDir);
  durableMemory.flush();
  const systemBackup = new SystemBackupService(config.paths.dataDir, db, durableMemory);
  const backupJobs = new BackupJobsService(db, settings, systemBackup);
  const retention = new RetentionService(db, settings, audit, auditArchive, systemBackup, notifications);
  const wikiPath = new WikiPathService(config.paths.dataDir);
  const himalayaAccount = new HimalayaAccountService(config.paths.dataDir);
  const telegramGateway = new TelegramGatewayService(config.paths.dataDir);
  const discordGateway = new MessagingGatewayService(config.paths.dataDir, "discord");
  const whatsappGateway = new MessagingGatewayService(config.paths.dataDir, "whatsapp");
  const telephony = new TelephonyService(db, config.paths.dataDir, deriveKey(serverKey.key, "telephony-preview"), undefined, options.now);
  const cloudtalk = new CloudTalkService(db, deriveKey(serverKey.key, "cloudtalk-profile"), options.providerFetch, options.now,
    () => settings.area("profile").displayName);
  const himalayaSend = new HimalayaSendService(db, himalayaAccount);
  const mailAccounts = new MailAccountsService(config.paths.dataDir);
  const calendarAccounts = new CalendarAccountsService(config.paths.dataDir);
  const mailSend = new MailSendService(db, mailAccounts);
  const messengerSend = new MessengerSendService(db, config.paths.dataDir, approvalTokens);
  const messengerCatalog = new MessengerCatalogService(config.paths.dataDir);
  const messengerProvider = new MessengerProviderService(config.paths.dataDir, messengerCatalog);
  const messengerInbound = new MessengerInboundService(db, durableMemory);
  const hermesSkillKeys = new HermesSkillKeysService(config.paths.dataDir);
  const hermesConfig = new HermesConfigService(config.paths.dataDir);
  const hermesAdapterConfig = config.adapters.tasks.config as Record<string, unknown>;
  const skills: SkillsService = new SkillsService({
    catalogPath: env.FRIDAY_SKILLS_CATALOG_PATH,
    dashboardUrl: env.FRIDAY_HERMES_DASHBOARD_URL ?? (typeof hermesAdapterConfig.dashboardBaseUrl === "string" ? hermesAdapterConfig.dashboardBaseUrl : undefined),
    fetcher: options.providerFetch,
    configuredIntegrations: () => contentStudioKeys.status(),
    hermesKeyStatus: () => hermesSkillKeys.status(),
    obsidianVaultStatus: () => obsidianVault.status(),
    wikiPathStatus: () => wikiPath.status(),
    himalayaAccountStatus: () => himalayaAccount.status(),
    telegramGatewayStatus: () => telegramGateway.status(),
    discordGatewayStatus: () => discordGateway.status(),
    whatsappGatewayStatus: () => whatsappGateway.status(),
    telephonyStatus: () => telephony.status(),
    cloudTalkStatus: () => cloudtalk.status(),
    codingCliStatus: () => codingRuns.cliStatus(),
    localCalendarStatus: () => { new LocalCalendarService(db).list(undefined, undefined, undefined, 1); return true; },
    calendarAdapterStatus: () => adapterSettings.list(),
    hermesInventory: () => hermesConfig.skillInventory(),
  });
  const codingRuns: CodingRunsService = new CodingRunsService(config, skills, env);
  const powerpoint = new PowerPointService(config.paths.dataDir);
  const codingVoiceRepository = new CodingVoiceRepositoryService(db, codingRuns);
  const research = new ResearchService(db, env.FRIDAY_RESEARCH_SEARXNG_URL, options.providerFetch,
    options.now ? () => new Date(options.now!()) : undefined,
    options.researchPageFetch,
    options.researchSynthesize ?? hermesResearchSynthesizer(config.paths.dataDir));
  const researchSetup = new ResearchSetupService(config.paths.dataDir, options.researchSetupRun, options.researchSetupProbe);
  const contentStudioProduction = new ContentStudioProductionService(db, contentStudioPlan, contentStudioKeys, contentStudioProviders,
    config.paths.dataDir, { ffmpegPath: env.FRIDAY_FFMPEG_PATH, enabled: () => settings.area("dashboard").contentStudioEnabled === true });
  settingsHolder.current = settings;

  const assistantName = (): string => settings.get().profile.assistantName ?? DEFAULT_ASSISTANT_NAME;
  const orb = new OrbService({ registry, world, dataMode: config.dataMode, assistantName });
  const status = new StatusService({ registry, hub, dataMode: config.dataMode, version: buildVersion, startedAt, world, orbMode: () => orb.mode, assistantName });

  const capabilities = (): ReturnType<Runtime["capabilities"]> => {
    const result = registry.aggregateCapabilities();
    // The handler checks readiness for new work; the route remains available for replay receipts.
    result.modules.research.create = config.dataMode !== "mock";
    if (config.dataMode !== "mock") {
      result.modules.research.read = true;
      result.modules.research.export = true;
    }
    // The live voice stop goes through the Control API (commandHandlers.stopVoice -> /control/stop), not the adapter.
    if (config.adapters.voice.provider === "friday-voice-http") result.modules.voice.stop = true;
    return result;
  };
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
    let generation = 0;
    const evaluate = async (fast = false): Promise<void> => {
      // Evaluations overlap (ports answer at different speeds): only the newest one may publish, an older answer would
      // otherwise overwrite a newer phase.
      const mine = ++generation;
      try {
        const snapshot = await orb.snapshot(undefined, { reuseSlowSources: fast });
        if (mine !== generation) return;
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
        // Real audio levels only feed the orb's level value; at 4-12 Hz they would also starve the trailing debounce.
        if (event.type === "friday.voice.audio_level") {
          const level = event.data as { direction: "input" | "output"; level: number };
          orb.observeAudioLevel(level.direction, level.level);
          return;
        }
        // Pipeline phases (listening -> transcribing -> thinking -> speaking) are short: remember the payload and
        // derive at once instead of after the debounce and another status request.
        if (event.type === "friday.voice.state_changed") {
          orb.observeVoiceStatus(event.data as VoiceStatus);
          clearTimeout(timer);
          void evaluate(true);
          return;
        }
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
    voiceBridgeKey: voiceBridgeKey.key,
    calendarBridgeKey: calendarBridgeKey.key,
    mailBridgeKey: mailBridgeKey.key,
    hermesMemoryBridgeKey: hermesMemoryBridgeKey.key,
    messengerInboundBridgeKey: messengerInboundBridgeKey.key,
    approvalTokens,
    settings,
    nativeApprovals,
    pendingCommandClarifications,
    encryptedClarifiedMailDrafts,
    contentStudioKeys,
    contentStudioProviders,
    contentStudioPlan,
    skills,
    powerpoint,
    onboarding,
    obsidianVault,
    durableMemory,
    backupJobs,
    retention,
    wikiPath,
    himalayaAccount,
    telegramGateway,
    discordGateway,
    whatsappGateway,
    telephony,
    cloudtalk,
    himalayaSend,
    mailAccounts,
    calendarAccounts,
    mailSend,
    messengerSend,
    notifications,
    messengerCatalog,
    messengerProvider,
    messengerInbound,
    caldavCreate,
    hermesSkillKeys,
    hermesConfig,
    codingRuns,
    codingVoiceRepository,
    research,
    researchSetup,
    contentStudioProduction,
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
        const checkBackup = () => void backupJobs.tick().catch((error: unknown) =>
          logger.warn("System backup job failed", { error: String(error) }));
        checkBackup();
        timers.push(setInterval(checkBackup, 60_000));
        const checkRetention = () => {
          try { retention.tick(); }
          catch (error) { logger.warn("Data retention job failed", { error: String(error) }); }
        };
        checkRetention();
        timers.push(setInterval(checkRetention, 3_600_000));
        contentStudioProduction.start();
        void cloudtalk.tickReminders().catch((error: unknown) => logger.warn("CloudTalk reminder scan failed", { error: String(error) }));
        timers.push(setInterval(() => void cloudtalk.tickReminders().catch((error: unknown) =>
          logger.warn("CloudTalk reminder scan failed", { error: String(error) })), 60_000));
        world?.startTelemetry({ metricsMs: 24 * 3_600_000, heartbeatMs: 10_000 });
        timers.push(setInterval(() => void publishSystemMetrics(), 5_000));
        timers.push(
          setInterval(() => {
            idempotency.purgeExpired();
            sessions.purgeExpired();
          }, 3_600_000),
        );
        timers.push(setInterval(() => pendingCommandClarifications.purgeExpired(), 60_000));
        timers.push(setInterval(() => encryptedClarifiedMailDrafts.purgeExpired(), 60_000));
        for (const timer of timers) timer.unref?.();
      }
      idempotency.purgeExpired();
      sessions.purgeExpired();
      pendingCommandClarifications.purgeExpired();
      encryptedClarifiedMailDrafts.purgeExpired();
    },
    async close() {
      durableMemory.close();
      await contentStudioProduction.stop();
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
