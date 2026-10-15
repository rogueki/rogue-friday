import {
  CONTRACT_VERSION,
  FRIDAY_EVENT_DATA_SCHEMA_IDS as FRIDAY_EVENT_SCHEMA_IDS,
  createSchemaValidator,
  type ActivityEvent,
  type Actor,
  type AdapterCategory,
  type AdapterHealth,
  type AdapterLogEntry,
  type AuditEvent,
  type Capabilities,
  type ErrorDetail,
  type Freshness,
  type FridayEvent,
  type FridayEventMap,
  type FridayEventType,
  type FridayStatus,
  type OrbMode,
  type OrbSnapshot,
  type SchemaName,
  type SchemaValidator,
  type SourceDescriptor,
} from "@friday/sdk";
import { createAuditEvent, verifyAuditChain, type AuditDraft, type ChainVerification } from "../core/audit-chain";
import { MockClock, type TimerHandle } from "../core/clock";
import {
  ADAPTER_CATEGORIES,
  CATEGORY_LABEL,
  MODULE_CATEGORY,
  OPERATION_CAPABILITY,
  adapterIdFor,
  categoryForAdapterId,
  isCapabilityModule,
  type GuardedOperation,
} from "../core/constants";
import { MockAdapterError, MockApiError, validationFailed } from "../core/errors";
import { IdFactory } from "../core/ids";
import { Rng } from "../core/prng";
import { canonicalJson, clone } from "../core/util";
import { buildWorldState, createContextFor, ID_EPOCH_MS } from "../seed/profiles";
import { sampleMetrics } from "../seed/system";
import { ActivityService } from "./services/activity";
import { AgentService } from "./services/agents";
import { ApprovalService } from "./services/approvals";
import { AuditService } from "./services/audit";
import { AuthService } from "./services/auth";
import { AutomationService } from "./services/automations";
import { CalendarService } from "./services/calendar";
import { CommandService } from "./services/commands";
import { CommunicationService } from "./services/communication";
import { FileService } from "./services/files";
import { MemoryService } from "./services/memory";
import { MetaService } from "./services/meta";
import { NotificationService } from "./services/notifications";
import { ResearchService } from "./services/research";
import { SettingsService } from "./services/settings";
import { SystemService } from "./services/system";
import { TaskService } from "./services/tasks";
import { VoiceService } from "./services/voice";
import { WorldEventBus } from "./event-bus";
import { computeHealth, DEFAULT_ASSISTANT_NAME, deriveOrbSnapshot } from "./orb";
import type { AdapterMode, ProfileName, WorldState } from "./state";
import type { EmitOptions, OpContext } from "./types";

export const DEFAULT_START_TIME = "2026-10-14T08:15:00.000Z";
export const DEFAULT_SEED = 42;

export interface MockWorldOptions {
  profile?: ProfileName;
  seed?: number;
  /** ISO start of the mock clock (default 2026-10-14T08:15:00Z, the date of the seed content). */
  startTime?: string;
  /** Follow the wall clock (dev). Tests keep this off and drive `world.clock.advance`. */
  realTime?: boolean;
  /**
   * Supplies the sequence number of the next event (and of the next `ActivityEvent`), so the world can share the global
   * sequence of an event hub: `ActivityEvent.sequence`, the envelope sequence and `listActivity?sinceSequence=` then use
   * one counter. Receives `floor`, the highest sequence already contained in the seeded state, and must return an
   * integer above it. The provider is asked once per emitted event and must not consume the number itself: the hub that
   * publishes the event assigns it. Without a provider the world counts on its own (the default).
   */
  nextSequence?: (floor: number) => number;
  /**
   * The assistant's current name for generated texts (orb status line, status label). A host that owns the settings
   * (the Control API) passes its own value; without it the world uses `state.settings.profile.assistantName`.
   */
  assistantName?: () => string;
}

export interface WorldSnapshot {
  version: 1;
  profile: ProfileName;
  seed: number;
  startTime: string;
  clockMs: number;
  idCounters: Record<string, number>;
  rng: { runtime: number; errors: number; latency: number };
  state: WorldState;
}

export interface ActivityInput {
  kind: ActivityEvent["kind"];
  title: string;
  summary?: string;
  severity?: ActivityEvent["severity"];
  status?: ActivityEvent["status"];
  parentId?: string | null;
  correlationId: string;
  agentId?: string | null;
  taskId?: string | null;
  tool?: string | null;
  adapterId?: string | null;
  model?: string | null;
  durationMs?: number | null;
  result?: string | null;
  error?: ErrorDetail;
  actor?: Actor;
  details?: Record<string, unknown>;
}

export type AuditInput = Omit<AuditDraft, "occurredAt" | "actor" | "severity" | "result" | "durationMs" | "before" | "after" | "artifactIds" | "childEventIds"> &
  Partial<Pick<AuditDraft, "actor" | "severity" | "result" | "durationMs" | "before" | "after" | "artifactIds" | "childEventIds">>;

/** Size of the adapter log ring buffer. */
const ADAPTER_LOG_LIMIT = 500;

const SYSTEM_ACTOR: Actor = { type: "system", id: "control-api", name: "Control API" };

let sharedValidator: SchemaValidator | null = null;
function getValidator(): SchemaValidator {
  sharedValidator ??= createSchemaValidator();
  return sharedValidator;
}

/**
 * In-memory, event-sourced mock platform. Domain services implement every OpenAPI operation; every mutation bumps
 * `version`/`updatedAt`, appends a hash-chained audit event and emits canonical events through `world.events`.
 *
 * Envelope layer: services return bare domain objects (or complete bodies for ActionResult, CommandResponse,
 * ReauthResponse, Meta, Health and Capabilities). `contractVersion`, `freshness` and `sources` of list/single
 * envelopes are added by the transport (MSW handlers, Control API) using `freshness(category)` and `sources(category)`.
 */
export class MockWorld {
  readonly clock: MockClock;
  readonly events: WorldEventBus;
  state!: WorldState;
  profile: ProfileName;
  seed: number;
  startTime: string;

  private idFactory: IdFactory;
  private runtimeRng: Rng;
  private errorRng: Rng;
  private latencyRng: Rng;
  private highWater = 0;
  private readonly sequenceProvider: ((floor: number) => number) | undefined;
  private readonly assistantNameProvider: (() => string) | undefined;
  private baseline: WorldSnapshot | null = null;
  private refreshing = false;
  private transientTimer: TimerHandle | null = null;
  private telemetryTimers: TimerHandle[] = [];
  private telemetryOptions: { metricsMs?: number; heartbeatMs?: number } | null = null;

  readonly tasks: TaskService;
  readonly activity: ActivityService;
  readonly memory: MemoryService;
  readonly agents: AgentService;
  readonly approvals: ApprovalService;
  readonly communication: CommunicationService;
  readonly calendar: CalendarService;
  readonly automations: AutomationService;
  readonly research: ResearchService;
  readonly files: FileService;
  readonly voice: VoiceService;
  readonly notifications: NotificationService;
  readonly system: SystemService;
  readonly audit: AuditService;
  readonly settings: SettingsService;
  readonly commands: CommandService;
  readonly meta: MetaService;
  readonly auth: AuthService;

  constructor(options: MockWorldOptions = {}) {
    this.profile = options.profile ?? "default";
    this.seed = options.seed ?? DEFAULT_SEED;
    this.startTime = options.startTime ?? DEFAULT_START_TIME;
    this.sequenceProvider = options.nextSequence;
    this.assistantNameProvider = options.assistantName;
    this.clock = new MockClock(this.startTime);
    this.idFactory = new IdFactory(this.seed, ID_EPOCH_MS);
    this.runtimeRng = new Rng(this.seed ^ 0xa11ce);
    this.errorRng = new Rng(this.seed ^ 0xe44);
    this.latencyRng = new Rng(this.seed ^ 0x1a7);
    this.events = new WorldEventBus({
      nextId: () => this.id("evt"),
      nextCorrelationId: () => this.id("corr"),
      nextSequence: () => this.nextSequence(),
      nowIso: () => this.clock.nowIso(),
    });
    this.tasks = new TaskService(this);
    this.activity = new ActivityService(this);
    this.memory = new MemoryService(this);
    this.agents = new AgentService(this);
    this.approvals = new ApprovalService(this);
    this.communication = new CommunicationService(this);
    this.calendar = new CalendarService(this);
    this.automations = new AutomationService(this);
    this.research = new ResearchService(this);
    this.files = new FileService(this);
    this.voice = new VoiceService(this);
    this.notifications = new NotificationService(this);
    this.system = new SystemService(this);
    this.audit = new AuditService(this);
    this.settings = new SettingsService(this);
    this.commands = new CommandService(this);
    this.meta = new MetaService(this);
    this.auth = new AuthService(this);
    this.load(this.profile, false);
    if (options.realTime) this.clock.startRealTime();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Rebuilds the world from the seeded generators and resets the clock; subscribers stay attached. */
  loadProfile(profile: ProfileName, options: { seed?: number; startTime?: string } = {}): void {
    if (options.seed !== undefined) this.seed = options.seed;
    if (options.startTime !== undefined) this.startTime = options.startTime;
    this.profile = profile;
    this.load(profile, true);
  }

  private load(profile: ProfileName, announce: boolean): void {
    this.stopTelemetry();
    this.transientTimer = null;
    this.clock.restore(Date.parse(this.startTime));
    this.idFactory = new IdFactory(this.seed, ID_EPOCH_MS);
    this.runtimeRng = new Rng(this.seed ^ 0xa11ce);
    this.errorRng = new Rng(this.seed ^ 0xe44);
    this.latencyRng = new Rng(this.seed ^ 0x1a7);
    const ctx = createContextFor(this.seed, this.idFactory, this.clock.now(), profile);
    this.state = buildWorldState(ctx, profile);
    this.afterStateReplaced();
    this.baseline = this.snapshot();
    if (announce) this.announceResync();
  }

  /** Restores the baseline captured right after the last `loadProfile` (scenario "reset"). */
  reset(): void {
    if (!this.baseline) throw new Error("MockWorld.reset: no baseline");
    this.restore(this.baseline);
  }

  snapshot(): WorldSnapshot {
    return {
      version: 1,
      profile: this.profile,
      seed: this.seed,
      startTime: this.startTime,
      clockMs: this.clock.now(),
      idCounters: this.idFactory.getCounters(),
      rng: { runtime: this.runtimeRng.state, errors: this.errorRng.state, latency: this.latencyRng.state },
      state: clone(this.state),
    };
  }

  /** Replaces the whole state. Clock timers are cleared and re-created from the restored state. */
  restore(snapshot: WorldSnapshot): void {
    this.stopTelemetry();
    this.profile = snapshot.profile;
    this.seed = snapshot.seed;
    this.startTime = snapshot.startTime;
    this.idFactory = new IdFactory(this.seed, ID_EPOCH_MS);
    this.idFactory.setCounters(snapshot.idCounters);
    this.runtimeRng.state = snapshot.rng.runtime;
    this.errorRng.state = snapshot.rng.errors;
    this.latencyRng.state = snapshot.rng.latency;
    this.clock.restore(snapshot.clockMs);
    this.state = clone(snapshot.state);
    this.afterStateReplaced();
    this.announceResync();
  }

  private afterStateReplaced(): void {
    this.clock.clearTimers();
    if (this.telemetryOptions) this.startTelemetry(this.telemetryOptions);
    this.approvals.scheduleTimers();
    this.notifications.scheduleTimers();
    const snapshot = deriveOrbSnapshot(this, this.clock.nowIso());
    this.state.orb = { mode: snapshot.status.mode, since: this.clock.nowIso(), signature: this.orbSignature(snapshot) };
    this.statusSignature = this.computeStatusSignature();
  }

  announceResync(reason: "server_restart" | "unknown" = "server_restart"): void {
    this.emit(
      "friday.status.resync_required",
      { reason, requestedSince: null, oldestAvailableSequence: null, latestSequence: this.highWater },
      { source: "control-api://core", subject: "status/resync" },
    );
  }

  /** UI hints are exposed as boolean flags in meta.features; clients reload meta on resync. */
  setUiHint(key: string, value: boolean): void {
    this.state.uiHints[key] = value;
    this.announceResync("unknown");
  }

  /** Stops timers owned by the world itself (telemetry); other timers belong to their creators. */
  dispose(): void {
    this.disableTelemetry();
    this.clock.stopRealTime();
    this.clock.clearTimers();
  }

  // ---------------------------------------------------------------- ids, time, randomness

  nowIso(): string {
    return this.clock.nowIso();
  }

  nowMs(): number {
    return this.clock.now();
  }

  id(prefix: string): string {
    return this.idFactory.next(prefix);
  }

  correlationId(ctx?: OpContext): string {
    return ctx?.correlationId ?? this.id("corr");
  }

  /** Stream for runtime decisions (agent choice, jitter in simulations). */
  get rng(): Rng {
    return this.runtimeRng;
  }

  private nextSequence(): number {
    if (this.sequenceProvider) {
      const value = this.providedSequence();
      this.highWater = Math.max(this.highWater, value);
      return value;
    }
    this.highWater = Math.max(this.highWater, this.state.sequence) + 1;
    this.state.sequence = this.highWater;
    return this.highWater;
  }

  /** Name of the assistant in generated, user-visible texts (never a hard-coded brand). */
  assistantName(): string {
    return this.assistantNameProvider?.() ?? this.state.settings.profile.assistantName ?? DEFAULT_ASSISTANT_NAME;
  }

  /** The sequence the next event will carry (not consumed). */
  peekSequence(): number {
    return this.sequenceProvider ? this.providedSequence() : Math.max(this.highWater, this.state.sequence) + 1;
  }

  private providedSequence(): number {
    const floor = this.state.sequence;
    const value = (this.sequenceProvider as (floor: number) => number)(floor);
    if (!Number.isInteger(value) || value <= floor) {
      throw new Error(`nextSequence lieferte ${String(value)}, erwartet eine ganze Zahl über ${floor}.`);
    }
    return value;
  }

  actorOf(ctx?: OpContext): Actor {
    return ctx?.actor ?? clone(this.defaultActor());
  }

  defaultActor(): Actor {
    return { type: "user", id: this.state.session.userId, name: "Erik" };
  }

  validate<T = unknown>(schema: SchemaName, body: unknown): T {
    const result = getValidator().validate<T>(schema, body ?? {});
    if (!result.valid) {
      throw validationFailed(
        `Die Anfrage entspricht nicht dem Schema ${schema}.`,
        result.errors.map((issue) => ({ path: issue.path, message: issue.message })),
      );
    }
    return body as T;
  }

  // ---------------------------------------------------------------- adapters, availability, capabilities

  adapter(category: AdapterCategory) {
    const adapter = this.state.adapters.find((candidate) => candidate.category === category);
    if (!adapter) throw new MockApiError({ code: "INTERNAL", message: `Adapter für ${category} fehlt.` });
    return adapter;
  }

  source(category: AdapterCategory, externalId?: string): SourceDescriptor {
    return {
      adapterId: adapterIdFor(category),
      system: "mock",
      ...(externalId ? { externalId } : {}),
      lastSyncedAt: this.clock.nowIso(),
    };
  }

  freshness(category: AdapterCategory): Freshness {
    const adapter = this.adapter(category);
    if (adapter.mode === "online") return { state: "fresh", asOf: this.clock.nowIso() };
    if (adapter.mode === "offline") return { state: "offline-cache", asOf: adapter.lastSyncedAt };
    return { state: "stale", asOf: adapter.lastSyncedAt };
  }

  sources(category: AdapterCategory): SourceDescriptor[] {
    const adapter = this.adapter(category);
    return [
      {
        adapterId: adapter.manifest.id,
        system: "mock",
        lastSyncedAt: adapter.mode === "online" ? this.clock.nowIso() : adapter.lastSyncedAt,
      },
    ];
  }

  /** Deterministic latency in ms for one call of this category (injected latency ± 20 %, extra when degraded). */
  latencyFor(category: AdapterCategory): number {
    const adapter = this.adapter(category);
    let base = adapter.latencyOverrideMs ?? this.state.control.latencyMs;
    if (adapter.mode === "degraded" || adapter.mode === "recovering") base += 400;
    if (base <= 0) return 0;
    return Math.max(0, Math.round(base * (0.8 + this.latencyRng.next() * 0.4)));
  }

  /**
   * Availability, capability and error-injection gate every operation passes. Throws a MockAdapterError
   * (ADAPTER_UNAVAILABLE, ADAPTER_TIMEOUT or CAPABILITY_MISSING).
   */
  guard(operation: GuardedOperation): void {
    const capabilityPath = OPERATION_CAPABILITY[operation];
    const [moduleName, capability] = capabilityPath.split(".") as [string, string];
    const category = isCapabilityModule(moduleName) ? MODULE_CATEGORY[moduleName] : "system";
    const adapter = this.adapter(category);
    const failure = (code: "ADAPTER_UNAVAILABLE" | "ADAPTER_TIMEOUT" | "CAPABILITY_MISSING", message: string, status?: number): MockAdapterError =>
      new MockAdapterError({
        code,
        message,
        category,
        adapterId: adapter.manifest.id,
        retryable: code !== "CAPABILITY_MISSING",
        ...(status !== undefined ? { status } : {}),
        details: { operation },
      });

    if (!adapter.enabled) throw failure("ADAPTER_UNAVAILABLE", `Der Adapter für ${CATEGORY_LABEL[category]} ist deaktiviert.`);
    if (adapter.mode === "offline") throw failure("ADAPTER_UNAVAILABLE", `Der Adapter für ${CATEGORY_LABEL[category]} ist derzeit nicht erreichbar.`);
    if (adapter.mode === "recovering") throw failure("ADAPTER_UNAVAILABLE", `Der Adapter für ${CATEGORY_LABEL[category]} verbindet sich neu.`);
    if (adapter.mode === "timeout") throw failure("ADAPTER_TIMEOUT", `Der Adapter für ${CATEGORY_LABEL[category]} hat nicht rechtzeitig geantwortet.`);

    if (isCapabilityModule(moduleName)) {
      const flags = this.state.capabilities.modules[moduleName] as unknown as Record<string, unknown>;
      if (flags[capability] === false) {
        throw failure("CAPABILITY_MISSING", `Die Fähigkeit ${capabilityPath} wird vom Adapter nicht angeboten.`);
      }
    }

    const rate = adapter.errorRateOverride ?? this.state.control.errorRate;
    if (rate > 0 && this.errorRng.next() < rate) {
      const timeout = this.errorRng.next() < 0.5;
      adapter.consecutiveFailures += 1;
      adapter.lastError = {
        code: timeout ? "ADAPTER_TIMEOUT" : "ADAPTER_UNAVAILABLE",
        message: timeout ? "Simulierter Timeout (Fehlerquote)" : "Simulierter Ausfall (Fehlerquote)",
      };
      throw failure(
        timeout ? "ADAPTER_TIMEOUT" : "ADAPTER_UNAVAILABLE",
        timeout ? "Simulierter Timeout durch die Fehlerquote." : "Simulierter Ausfall durch die Fehlerquote.",
      );
    }
    if (adapter.consecutiveFailures > 0) adapter.consecutiveFailures = 0;
    adapter.lastSuccessAt = this.clock.nowIso();
  }

  /** Appends a log line of an adapter to the bounded buffer behind `GET /adapters/{id}/logs`. */
  logAdapter(adapterId: string, level: AdapterLogEntry["level"], message: string, context: AdapterLogEntry["context"] = {}, correlationId: string | null = null): void {
    const logs = this.state.adapterLogs;
    logs.push({ timestamp: this.clock.nowIso(), level, message, adapterId, correlationId, context });
    if (logs.length > ADAPTER_LOG_LIMIT) logs.splice(0, logs.length - ADAPTER_LOG_LIMIT);
  }

  /** Dev control: sets the availability mode of an adapter (by category or adapter id) and publishes health events. */
  setAdapterState(target: AdapterCategory | string, mode: AdapterMode, options: { reason?: string } = {}): AdapterHealth {
    const category = (ADAPTER_CATEGORIES as readonly string[]).includes(target) ? (target as AdapterCategory) : categoryForAdapterId(target);
    if (!category) throw new MockApiError({ code: "NOT_FOUND", message: `Adapter ${target} ist unbekannt.`, details: { id: target } });
    const adapter = this.adapter(category);
    const previous = adapter.mode;
    if (previous === "online" && mode !== "online") adapter.lastSyncedAt = this.clock.nowIso();
    adapter.mode = mode;
    if (mode === "online") {
      adapter.lastSyncedAt = this.clock.nowIso();
      adapter.lastSuccessAt = this.clock.nowIso();
      adapter.lastError = null;
      adapter.consecutiveFailures = 0;
      adapter.circuit = "closed";
    } else {
      adapter.consecutiveFailures = mode === "degraded" ? 1 : Math.max(adapter.consecutiveFailures, 3);
      adapter.lastError = {
        code: mode === "timeout" ? "ADAPTER_TIMEOUT" : "ADAPTER_UNAVAILABLE",
        message: options.reason ?? (mode === "timeout" ? "Zeitüberschreitung bei der Anfrage" : mode === "recovering" ? "Verbindung wird wiederhergestellt" : "Adapter nicht erreichbar"),
      };
      adapter.circuit = mode === "offline" ? "open" : mode === "recovering" ? "half_open" : "closed";
    }
    const health = this.adapterHealth(category);
    if (mode !== previous) {
      this.logAdapter(
        adapter.manifest.id,
        mode === "online" ? "info" : mode === "degraded" || mode === "recovering" ? "warn" : "error",
        mode === "online" ? "Adapter ist wieder erreichbar" : (adapter.lastError?.message ?? "Adapter nicht erreichbar"),
        { from: previous, to: mode },
      );
    }
    this.emit("friday.adapter.health_changed", health, {
      source: "control-api://core",
      subject: `adapter/${adapter.manifest.id}`,
    });
    this.syncServiceForAdapter(category);
    this.refresh();
    return health;
  }

  private syncServiceForAdapter(category: AdapterCategory): void {
    const serviceName = category === "voice" ? "Voice STT" : category === "system" ? "Adapter-Registry" : null;
    if (!serviceName) return;
    const service = this.state.system.services.find((candidate) => candidate.name === serviceName);
    if (!service) return;
    const adapter = this.adapter(category);
    service.status = adapter.mode === "online" ? "online" : adapter.mode === "offline" ? "offline" : "degraded";
    service.updatedAt = this.clock.nowIso();
    this.emit("friday.system.service_status_changed", clone(service), { source: "adapter://mock-system", subject: `service/${service.id}` });
  }

  adapterHealth(category: AdapterCategory): AdapterHealth {
    const adapter = this.adapter(category);
    const lifecycle: AdapterHealth["lifecycle"] =
      adapter.mode === "online" ? "ONLINE" : adapter.mode === "offline" ? "OFFLINE" : adapter.mode === "recovering" ? "RECOVERING" : "DEGRADED";
    const base = adapter.latencyOverrideMs ?? this.state.control.latencyMs;
    return {
      adapterId: adapter.manifest.id,
      status: adapter.mode === "online" ? "online" : adapter.mode === "offline" ? "offline" : "degraded",
      lifecycle,
      latencyMs: adapter.mode === "offline" ? null : (adapter.latencyMs ?? 5) + base + (adapter.mode === "degraded" ? 400 : 0),
      lastSuccessAt: adapter.lastSuccessAt,
      lastError: adapter.lastError ? clone(adapter.lastError) : null,
      checkedAt: this.clock.nowIso(),
      consecutiveFailures: adapter.consecutiveFailures,
      circuit: adapter.circuit,
    };
  }

  /** Dev control: injected latency for all adapters or one (category or adapter id). */
  setLatency(ms: number, target?: string): void {
    if (ms < 0) throw validationFailed("Latenz muss >= 0 sein.");
    if (!target) {
      this.state.control.latencyMs = ms;
      return;
    }
    this.adapter(this.resolveCategory(target)).latencyOverrideMs = ms;
  }

  setErrorRate(rate: number, target?: string): void {
    if (rate < 0 || rate > 1) throw validationFailed("Fehlerquote muss zwischen 0 und 1 liegen.");
    if (!target) {
      this.state.control.errorRate = rate;
      return;
    }
    this.adapter(this.resolveCategory(target)).errorRateOverride = rate;
  }

  resolveCategory(target: string): AdapterCategory {
    const category = (ADAPTER_CATEGORIES as readonly string[]).includes(target) ? (target as AdapterCategory) : categoryForAdapterId(target);
    if (!category) throw new MockApiError({ code: "NOT_FOUND", message: `Adapter ${target} ist unbekannt.`, details: { id: target } });
    return category;
  }

  /** Dev control: enables/disables a capability (e.g. `mail`, `send`). `mail` and `communication` stay in sync. */
  setCapability(module: string, capability: string, enabled: boolean): Capabilities {
    if (!isCapabilityModule(module)) {
      throw validationFailed(`Unbekanntes Modul ${module}.`, [{ path: "module", message: "unbekannt" }]);
    }
    const targets = module === "mail" || module === "communication" ? (["mail", "communication"] as const) : ([module] as const);
    let found = false;
    for (const name of targets) {
      const flags = this.state.capabilities.modules[name] as unknown as Record<string, unknown>;
      if (typeof flags[capability] === "boolean") {
        flags[capability] = enabled;
        found = true;
      }
    }
    if (!found) throw validationFailed(`Unbekannte Fähigkeit ${module}.${capability}.`, [{ path: "capability", message: "unbekannt" }]);
    const capabilities = clone(this.state.capabilities);
    this.emit("friday.adapter.capabilities_changed", capabilities, { source: "control-api://core", subject: `capabilities/${module}` });
    this.refresh();
    return capabilities;
  }

  // ---------------------------------------------------------------- idempotency, versions

  /**
   * Wraps a mutation: replays the stored result for a repeated idempotency key, otherwise guards, executes,
   * stores the result and refreshes derived state (orb, status).
   */
  run<T>(operation: GuardedOperation, ctx: OpContext | undefined, scope: unknown, fn: () => T): T {
    const key = ctx?.idempotencyKey;
    const fingerprint = canonicalJson({ operation, scope });
    if (key) {
      const stored = this.state.idempotency[key];
      if (stored) {
        if (stored.operation === operation && stored.fingerprint === fingerprint) return clone(stored.response) as T;
        throw new MockApiError({
          code: "IDEMPOTENCY_CONFLICT",
          message: "Der Idempotency-Key wurde bereits für eine andere Anfrage verwendet.",
          details: { idempotencyKey: key, previousOperation: stored.operation },
        });
      }
    }
    this.guard(operation);
    const result = fn();
    if (key) this.state.idempotency[key] = { operation, fingerprint, response: clone(result) };
    this.refresh();
    return clone(result);
  }

  /** Guarded read. */
  read<T>(operation: GuardedOperation, fn: () => T): T {
    this.guard(operation);
    return fn();
  }

  parseIfMatch(ctx?: OpContext): number | null {
    const raw = ctx?.ifMatch;
    if (raw === undefined || raw === null || raw === "") return null;
    if (typeof raw === "number") return raw;
    const cleaned = String(raw).replace(/^W\//, "").replace(/"/g, "").trim();
    const value = Number(cleaned);
    if (!Number.isInteger(value)) throw validationFailed("If-Match muss eine Versionsnummer sein.", [{ path: "If-Match", message: "ganze Zahl erwartet" }]);
    return value;
  }

  assertVersion(resource: { id: string; version: number }, ctx: OpContext | undefined, kind: string): void {
    const expected = this.parseIfMatch(ctx);
    if (expected !== null && expected !== resource.version) {
      throw new MockApiError({
        code: "CONFLICT",
        message: `${kind} ${resource.id} wurde zwischenzeitlich geändert (erwartet Version ${expected}, aktuell ${resource.version}).`,
        details: { expectedVersion: expected, currentVersion: resource.version, id: resource.id },
      });
    }
  }

  bump<T extends { version: number; updatedAt: string }>(resource: T): T {
    resource.version += 1;
    resource.updatedAt = this.clock.nowIso();
    return resource;
  }

  // ---------------------------------------------------------------- events, audit, activity

  emit<K extends FridayEventType>(
    type: K,
    data: FridayEventMap[K],
    options: Pick<EmitOptions, "subject"> & Partial<EmitOptions>,
  ): FridayEvent<K> {
    return this.events.emit(type, clone(data), {
      subject: options.subject,
      source: options.source ?? "control-api://core",
      ...(options.correlationId ? { correlationId: options.correlationId } : {}),
      ...(options.causationId ? { causationId: options.causationId } : {}),
    });
  }

  /** Emits an event whose source is the mock adapter of `category`. */
  emitFor<K extends FridayEventType>(
    category: AdapterCategory,
    type: K,
    data: FridayEventMap[K],
    subject: string,
    correlationId?: string,
    causationId?: string,
  ): FridayEvent<K> {
    return this.emit(type, data, {
      subject,
      source: `adapter://${adapterIdFor(category)}`,
      ...(correlationId ? { correlationId } : {}),
      ...(causationId ? { causationId } : {}),
    });
  }

  recordAudit(input: AuditInput, occurredAt?: string): AuditEvent {
    const last = this.state.audit[this.state.audit.length - 1];
    const at = occurredAt ?? this.clock.nowIso();
    const draft: AuditDraft = {
      actor: this.defaultActor(),
      severity: "info",
      result: "success",
      durationMs: 0,
      before: null,
      after: null,
      artifactIds: [],
      childEventIds: [],
      ...input,
      occurredAt: at,
    };
    this.state.auditSequence += 1;
    const event = createAuditEvent(draft, {
      id: this.id("aud"),
      sequence: this.state.auditSequence,
      source: this.source("audit"),
      prevHash: last?.hash ?? null,
    });
    this.state.audit.push(event);
    this.emitFor("audit", "friday.audit.appended", event, `audit/${event.id}`, event.correlationId);
    return event;
  }

  verifyAudit(): ChainVerification {
    return verifyAuditChain(this.state.audit);
  }

  logActivity(input: ActivityInput): ActivityEvent {
    const at = this.clock.nowIso();
    const event: ActivityEvent = {
      id: this.id("act"),
      version: 1,
      createdAt: at,
      updatedAt: at,
      source: this.source("activity"),
      sequence: this.peekSequence(),
      kind: input.kind,
      severity: input.severity ?? "info",
      title: input.title,
      ...(input.summary ? { summary: input.summary } : {}),
      status: input.status ?? "succeeded",
      parentId: input.parentId ?? null,
      correlationId: input.correlationId,
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      tool: input.tool ?? null,
      adapterId: input.adapterId ?? null,
      model: input.model ?? null,
      occurredAt: at,
      endedAt: input.status === "running" || input.status === "started" ? null : at,
      durationMs: input.durationMs ?? null,
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(input.error ? { error: input.error } : {}),
      actor: input.actor ?? this.defaultActor(),
      ...(input.details ? { details: input.details } : {}),
    };
    this.state.activity.push(event);
    const emitted = this.emitFor("activity", "friday.activity.appended", event, `activity/${event.id}`, input.correlationId);
    // The envelope sequence is the activity sequence; both are drawn from the same counter.
    if (emitted.sequence !== event.sequence) event.sequence = emitted.sequence;
    return event;
  }

  // ---------------------------------------------------------------- derived state: orb, status

  orbSnapshot(): OrbSnapshot {
    this.refresh();
    const snapshot = deriveOrbSnapshot(this, this.state.orb.since);
    if (this.state.orb.sourceEventId) snapshot.status.sourceEventId = this.state.orb.sourceEventId;
    return snapshot;
  }

  /** Dev override of the orb (null releases it). */
  forceOrbState(mode: OrbMode | null, extras: { activityText?: string; audioLevel?: number; progress?: number | null } = {}): OrbSnapshot {
    this.state.forcedOrb = mode === null ? null : { mode, ...extras };
    this.refresh();
    return this.orbSnapshot();
  }

  /** Shows a short-lived orb mode (success pulse, booting, thinking after a command). */
  setTransientOrb(mode: OrbMode, durationMs: number, activityText: string, detailText?: string): void {
    this.state.transientOrb = { mode, until: this.clock.now() + durationMs, activityText, ...(detailText ? { detailText } : {}) };
    this.transientTimer?.cancel();
    this.transientTimer = this.clock.setTimeout(() => {
      this.state.transientOrb = null;
      this.refresh();
    }, durationMs + 1);
    this.refresh();
  }

  private orbSignature(snapshot: OrbSnapshot): string {
    const { audioLevel: _audio, since: _since, sourceEventId: _source, ...status } = snapshot.status;
    return canonicalJson({ status, layers: snapshot.layers });
  }

  private statusSignature = "";

  private computeStatusSignature(): string {
    const status = this.fridayStatus();
    return canonicalJson({ ...status, uptimeSeconds: 0, eventStream: { state: status.eventStream.state } });
  }

  /** Recomputes orb and overall status; emits `friday.orb.status_changed` / `friday.status.changed` on change. */
  refresh(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const snapshot = deriveOrbSnapshot(this, this.state.orb.since);
      const signature = this.orbSignature(snapshot);
      if (signature !== this.state.orb.signature) {
        const modeChanged = snapshot.status.mode !== this.state.orb.mode;
        const since = modeChanged ? this.clock.nowIso() : this.state.orb.since;
        const causing = this.events.lastId ?? undefined;
        this.state.orb = { mode: snapshot.status.mode, since, signature, ...(causing ? { sourceEventId: causing } : {}) };
        const next = deriveOrbSnapshot(this, since);
        if (causing) next.status.sourceEventId = causing;
        this.emit("friday.orb.status_changed", next, {
          source: "control-api://core",
          subject: "orb/status",
          ...(causing ? { causationId: causing } : {}),
        });
      }
      const statusSignature = this.computeStatusSignature();
      if (statusSignature !== this.statusSignature) {
        this.statusSignature = statusSignature;
        this.emit("friday.status.changed", this.fridayStatus(), { source: "control-api://core", subject: "status/overall" });
      }
    } finally {
      this.refreshing = false;
    }
  }

  fridayStatus(): FridayStatus {
    const health = computeHealth(this.state);
    const summary = { online: 0, degraded: 0, offline: 0 };
    for (const adapter of this.state.adapters) {
      if (adapter.mode === "online") summary.online++;
      else if (adapter.mode === "offline") summary.offline++;
      else summary.degraded++;
    }
    const orbMode = this.state.orb.mode;
    const assistant = this.assistantName();
    return {
      status: health,
      label: `${assistant} ${health === "online" ? "online" : health === "degraded" ? "eingeschränkt" : "offline"}`,
      mode: orbMode,
      dataMode: "mock",
      uptimeSeconds: Math.max(0, Math.round((this.clock.now() - Date.parse(this.state.startedAt)) / 1000)),
      since: this.state.startedAt,
      version: "1.0.0+mock",
      eventStream: {
        state: this.state.eventStreamState === "online" ? "online" : this.state.eventStreamState,
        roundtripMs: this.state.eventStreamState === "offline" ? null : 28,
        lastEventAt: this.events.lastAt,
      },
      adapterSummary: summary,
    };
  }

  // ---------------------------------------------------------------- simulation helpers

  /** Starts a background sync job (orb shows "syncing") and returns its id. */
  startSync(source: WorldState["sync"][number]["source"], label: string): string {
    const id = this.id("sync");
    this.state.sync.push({ id, source, label, startedAt: this.clock.nowIso() });
    this.refresh();
    return id;
  }

  finishSync(id: string): void {
    this.state.sync = this.state.sync.filter((job) => job.id !== id);
    this.refresh();
  }

  /** Emits a raw event (dev console). Unknown types are rejected so streams stay contract-conform. */
  emitRaw(raw: { type: string; subject?: string; data: unknown; source?: string; correlationId?: string }): FridayEvent {
    const type = raw.type as FridayEventType;
    const validator = getValidator();
    const schemaId = (FRIDAY_EVENT_SCHEMA_IDS as Record<string, string>)[type];
    if (!schemaId) throw validationFailed(`Unbekannter Ereignistyp ${raw.type}.`, [{ path: "type", message: "unbekannt" }]);
    const result = validator.validate(schemaId, raw.data);
    if (!result.valid) throw validationFailed("Ereignisdaten entsprechen nicht dem Schema.", result.errors);
    const event = this.emit(type, raw.data as never, {
      subject: raw.subject ?? "dev/raw",
      source: raw.source ?? "control-api://core",
      ...(raw.correlationId ? { correlationId: raw.correlationId } : {}),
    });
    this.refresh();
    return event;
  }

  /** Periodic `friday.system.metrics` and `friday.agent.heartbeat` events on the mock clock. */
  startTelemetry(options: { metricsMs?: number; heartbeatMs?: number } = {}): void {
    this.stopTelemetry();
    this.telemetryOptions = options;
    const metricsMs = options.metricsMs ?? 5_000;
    const heartbeatMs = options.heartbeatMs ?? 10_000;
    this.telemetryTimers.push(
      this.clock.setInterval(() => this.system.publishMetrics(), metricsMs),
      this.clock.setInterval(() => this.agents.publishHeartbeats(), heartbeatMs),
    );
  }

  stopTelemetry(): void {
    for (const timer of this.telemetryTimers) timer.cancel();
    this.telemetryTimers = [];
  }

  /** Stops telemetry for good (also across resets). */
  disableTelemetry(): void {
    this.stopTelemetry();
    this.telemetryOptions = null;
  }

  /** Metrics for "now", scaled by current load. */
  currentMetrics() {
    const active = this.state.agents.filter((agent) => agent.status === "working").length;
    const load = Math.min(1, active / 12);
    return sampleMetrics(this.clock.now(), this.source("system"), this.state.system.storage, load);
  }

  /**
   * Removes everything that demands attention: pending approvals, open alerts, running work, active voice and
   * sync jobs. Used by scenarios that start from a calm baseline ("clean-idle").
   */
  quiesce(): void {
    const now = this.clock.nowIso();
    for (const approval of this.state.approvals) {
      if (approval.status === "pending") {
        approval.status = "cancelled";
        approval.updatedAt = now;
        approval.version += 1;
      }
    }
    for (const notification of this.state.notifications) {
      if (notification.status === "open" || notification.status === "snoozed") {
        notification.status = "resolved";
        notification.resolved = true;
        notification.acknowledged = true;
        notification.resolvedAt = now;
        notification.acknowledgedAt ??= now;
        notification.snoozedUntil = null;
        notification.updatedAt = now;
        notification.version += 1;
      }
    }
    for (const task of this.state.tasks) {
      if (task.status === "running") {
        task.status = "done";
        task.progress = { mode: "determinate", value: 1 };
        task.updatedAt = now;
        task.version += 1;
      }
      if (task.status === "waiting") {
        task.status = "review";
        task.blockers = [];
        task.updatedAt = now;
        task.version += 1;
      }
    }
    for (const agent of this.state.agents) {
      if (agent.status === "working" || agent.status === "waiting" || agent.status === "paused" || agent.status === "error") {
        agent.status = "idle";
        agent.currentTaskId = null;
        agent.activeTools = [];
        agent.startedAt = null;
        agent.runtimeMs = null;
        agent.updatedAt = now;
        agent.version += 1;
      }
    }
    for (const draft of this.state.drafts) {
      if (draft.status === "pending_approval") {
        draft.status = "draft";
        draft.approvalId = null;
        draft.updatedAt = now;
        draft.version += 1;
      }
    }
    for (const proposal of this.state.calendarProposals) {
      if (proposal.status === "pending_approval") {
        proposal.status = "rejected";
        proposal.updatedAt = now;
        proposal.version += 1;
      }
    }
    this.state.sync = [];
    this.state.globalPaused = false;
    this.state.forcedOrb = null;
    this.state.transientOrb = null;
    this.voice.resetToIdle(false);
    for (const category of ADAPTER_CATEGORIES) {
      const adapter = this.adapter(category);
      adapter.mode = "online";
      adapter.lastError = null;
      adapter.consecutiveFailures = 0;
      adapter.circuit = "closed";
      adapter.lastSyncedAt = now;
    }
    for (const service of this.state.system.services) {
      if (service.status !== "online") {
        service.status = "online";
        service.latencyMs = 40;
        service.detail = "Dienst läuft";
        service.updatedAt = now;
      }
    }
    this.approvals.scheduleTimers();
    this.notifications.scheduleTimers();
    this.refresh();
    this.emit("friday.status.resync_required", { reason: "unknown", requestedSince: null, oldestAvailableSequence: null, latestSequence: this.highWater }, { source: "control-api://core", subject: "status/resync" });
  }
}

export { SYSTEM_ACTOR, CONTRACT_VERSION };
