import { AsyncLocalStorage } from "node:async_hooks";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  CONTRACT_VERSION,
  createCorrelationId,
  type AdapterCategory,
  type AdapterHealth,
  type AdapterInfo,
  type AdapterManifest,
  type Capabilities,
} from "@jarvis/sdk";
import { systemClock, toIso, type Clock } from "./clock";
import { assertContract } from "./contract";
import { validatePortResult } from "./result-validation";
import { assertCanonicalEvent } from "./event-mapping";
import { AdapterError, normalizeError } from "./errors";
import { HealthMonitor } from "./health-monitor";
import { AdapterLifecycleMachine, isServing } from "./lifecycle";
import { createRedactingLogger, noopLogger, type Logger } from "./logger";
import { PORT_SPEC, allowedCapabilities, findMethodSpec, type MethodSpec } from "./port-spec";
import type { CallContext, PortCategory, PortMap } from "./ports";
import {
  CircuitBreaker,
  createResilientCaller,
  withTimeout,
  normalizeBreakerConfig,
  normalizeRetryConfig,
  type BreakerConfigInput,
  type ResilientCaller,
  type RetryConfigInput,
} from "./resilience";
import { createRedactor } from "./http-client";
import type { AdapterContext, AdapterEventInput, AdapterFactory, DataMode, JarvisAdapter } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------------

export interface AdapterEntryConfig {
  provider: string;
  enabled: boolean;
  /** Validated against the adapter's config schema. Secret fields are resolved by the `secretProvider`, not read here. */
  config?: Record<string, unknown>;
  /** Overall deadline per attempt of a port call. Default 10 000 ms. */
  timeoutMs?: number;
  retry?: RetryConfigInput | false;
  circuitBreaker?: BreakerConfigInput | false;
}

export interface RegistryConfig {
  mode: DataMode;
  adapters: Partial<Record<AdapterCategory, AdapterEntryConfig>>;
}

export interface SecretRequest {
  category: AdapterCategory;
  provider: string;
  adapterId: string;
  field: string;
}

export interface RegistryEvent {
  adapterId: string;
  event: AdapterEventInput;
}

export interface AdapterRegistryOptions {
  /** Provider ids that may be loaded. Anything else is refused. */
  allowlist: readonly string[];
  clock?: Clock;
  logger?: Logger;
  /** Resolves secret values (env, Windows Credential Manager). Values never appear in config, logs or events. */
  secretProvider?: (request: SecretRequest) => string | undefined;
  /** Receives every canonical event adapters and the registry emit; the hub assigns sequence/id/time. */
  onEvent?: (event: RegistryEvent) => void;
  healthIntervalMs?: number;
  /** Deadline for `initialize()` / `shutdown()` of a single adapter. Default 15 000 / 5 000 ms. */
  initTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  random?: () => number;
  /** Defaults for entries without their own resilience settings. */
  defaults?: Pick<AdapterEntryConfig, "timeoutMs" | "retry" | "circuitBreaker">;
}

export interface InitReport {
  category: AdapterCategory;
  provider: string;
  adapterId: string | undefined;
  enabled: boolean;
  state: AdapterHealth["lifecycle"];
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------------------------------------------------
// Runtime records
// ---------------------------------------------------------------------------------------------------------------------

interface Runtime {
  category: AdapterCategory;
  entry: AdapterEntryConfig;
  factory: AdapterFactory;
  adapter: JarvisAdapter;
  manifest: AdapterManifest;
  lifecycle: AdapterLifecycleMachine;
  monitor: HealthMonitor;
  caller: ResilientCaller;
  breaker: CircuitBreaker | undefined;
  abort: AbortController;
  capabilities: Set<string>;
  secrets: Map<string, string>;
  failure: { code: string; message: string } | undefined;
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const correlationStore = new AsyncLocalStorage<string>();

function majorOf(version: string): number {
  return Number.parseInt(version.split(".")[0] ?? "", 10);
}

const refuse = (message: string, details: Record<string, unknown> = {}): AdapterError =>
  new AdapterError({ code: "VALIDATION_FAILED", message, retryable: false, severity: "error", details });

// ---------------------------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Loads allowlisted adapters, isolates their failures, wraps every port call with timeout / retry / circuit breaker,
 * validates every result against the contract, and aggregates the capability document (PLAN §10.9, §10.10).
 */
export class AdapterRegistry {
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly allowlist: ReadonlySet<string>;
  private readonly factories = new Map<string, AdapterFactory>();
  private readonly runtimes = new Map<AdapterCategory, Runtime>();
  private readonly failedEntries = new Map<AdapterCategory, InitReport & { entry: AdapterEntryConfig }>();
  private readonly ports = new Map<PortCategory, PortMap[PortCategory]>();
  private config: RegistryConfig | undefined;
  private lastCapabilitiesKey: string | undefined;
  private readonly controlPlaneCapabilities = new Set<string>();
  private shuttingDown = false;
  private readonly ajv: Ajv2020;

  constructor(private readonly options: AdapterRegistryOptions) {
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.allowlist = new Set(options.allowlist);
    this.ajv = new Ajv2020({ strict: false, allErrors: true, useDefaults: true });
    (typeof addFormats === "function"
      ? addFormats
      : (addFormats as unknown as { default: typeof addFormats }).default)(this.ajv);
  }

  /** Registers the code of a provider. Providers outside the allowlist are refused. */
  registerFactory(providerId: string, factory: AdapterFactory): void {
    if (!this.allowlist.has(providerId)) {
      throw refuse(`Provider '${providerId}' ist nicht in der Allowlist und wird nicht geladen.`, {
        providerId,
      });
    }
    if (factory.providerId !== providerId) {
      throw refuse(`Factory meldet providerId '${factory.providerId}', registriert unter '${providerId}'.`, {
        providerId,
      });
    }
    this.factories.set(providerId, factory);
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------------

  /**
   * Initializes every enabled adapter. One failing adapter never blocks the others: it ends up OFFLINE with `lastError`
   * and shows up in the returned report. Never throws for per-adapter problems.
   */
  async initialize(config: RegistryConfig): Promise<InitReport[]> {
    this.config = config;
    this.shuttingDown = false;
    const entries = Object.entries(config.adapters) as Array<[AdapterCategory, AdapterEntryConfig]>;
    const reports = await Promise.all(entries.map(([category, entry]) => this.load(category, entry)));
    this.publishCapabilitiesIfChanged();
    return reports;
  }

  private async load(category: AdapterCategory, entry: AdapterEntryConfig): Promise<InitReport> {
    const base = { category, provider: entry.provider, enabled: entry.enabled };
    this.runtimes.delete(category);
    this.failedEntries.delete(category);
    try {
      const factory = this.resolveFactory(category, entry);
      const adapter = factory.create();
      const manifest = this.validateManifest(category, factory, adapter);
      if (this.findByAdapterId(manifest.id)) {
        throw refuse(`Adapter-ID '${manifest.id}' ist bereits registriert.`, { adapterId: manifest.id });
      }
      const runtime = this.buildRuntime(category, entry, factory, adapter, manifest);
      this.runtimes.set(category, runtime);
      if (!entry.enabled) return { ...base, adapterId: manifest.id, state: "UNREGISTERED" };

      await this.startRuntime(runtime);
      return {
        ...base,
        adapterId: manifest.id,
        state: runtime.monitor.snapshot().lifecycle,
        ...(runtime.failure ? { error: runtime.failure } : {}),
      };
    } catch (raw) {
      const error = normalizeError(raw);
      this.logger.error("Adapter konnte nicht geladen werden", {
        category,
        provider: entry.provider,
        code: error.code,
        message: error.message,
      });
      const report: InitReport = {
        ...base,
        adapterId: undefined,
        state: "OFFLINE",
        error: { code: error.code, message: error.message },
      };
      this.failedEntries.set(category, { ...report, entry });
      return report;
    }
  }

  private resolveFactory(category: AdapterCategory, entry: AdapterEntryConfig): AdapterFactory {
    if (!this.allowlist.has(entry.provider)) {
      throw refuse(
        `Provider '${entry.provider}' (${category}) ist nicht in der Allowlist und wird nicht geladen.`,
        {
          provider: entry.provider,
        },
      );
    }
    const factory = this.factories.get(entry.provider);
    if (!factory) {
      throw refuse(`Provider '${entry.provider}' ist erlaubt, aber es wurde keine Factory registriert.`, {
        provider: entry.provider,
      });
    }
    if (factory.category !== category) {
      throw refuse(
        `Provider '${entry.provider}' gehört zur Kategorie '${factory.category}', nicht '${category}'.`,
        {
          provider: entry.provider,
        },
      );
    }
    const mode = this.config?.mode ?? "mock";
    if (factory.modes && !factory.modes.includes(mode)) {
      throw refuse(`Provider '${entry.provider}' ist im Modus '${mode}' nicht zulässig.`, {
        provider: entry.provider,
        mode,
      });
    }
    return factory;
  }

  private validateManifest(
    category: AdapterCategory,
    factory: AdapterFactory,
    adapter: JarvisAdapter,
  ): AdapterManifest {
    const manifest = adapter.manifest;
    assertContract("AdapterManifest", manifest, `Manifest von ${factory.providerId}`);
    if (!SAFE_ID.test(manifest.id)) throw refuse(`Ungültige Adapter-ID '${manifest.id}'.`);
    if (manifest.category !== category) {
      throw refuse(`Manifest-Kategorie '${manifest.category}' passt nicht zur Konfiguration '${category}'.`);
    }
    if (majorOf(manifest.contractVersion) !== majorOf(CONTRACT_VERSION)) {
      throw refuse(
        `Contract-Version ${manifest.contractVersion} ist mit ${CONTRACT_VERSION} nicht kompatibel.`,
        {
          adapterContract: manifest.contractVersion,
          hostContract: CONTRACT_VERSION,
        },
      );
    }
    if (category in PORT_SPEC) {
      const allowed = allowedCapabilities(category as PortCategory);
      const unknown = manifest.capabilities.filter((capability) => !allowed.has(capability));
      if (unknown.length > 0)
        throw refuse(`Manifest deklariert unbekannte Capabilities: ${unknown.join(", ")}.`, { unknown });
    }
    const schemaId = (factory.configSchema as { $id?: unknown }).$id;
    if (typeof schemaId === "string" && schemaId !== manifest.configSchemaRef) {
      throw refuse(
        `configSchemaRef '${manifest.configSchemaRef}' verweist nicht auf das exportierte Schema '${schemaId}'.`,
      );
    }
    return manifest;
  }

  private resolveSecrets(
    category: AdapterCategory,
    entry: AdapterEntryConfig,
    manifest: AdapterManifest,
  ): Map<string, string> {
    const secrets = new Map<string, string>();
    for (const field of manifest.secretFields) {
      const value = this.options.secretProvider?.({
        category,
        provider: entry.provider,
        adapterId: manifest.id,
        field,
      });
      if (value !== undefined && value !== "") secrets.set(field, value);
    }
    return secrets;
  }

  private validateConfig(
    factory: AdapterFactory,
    manifest: AdapterManifest,
    entry: AdapterEntryConfig,
    secrets: Map<string, string>,
  ) {
    const candidate: Record<string, unknown> = structuredClone(entry.config ?? {});
    for (const field of manifest.secretFields) delete candidate[field]; // secrets never travel through config files
    const withSecrets = { ...candidate, ...Object.fromEntries(secrets) };
    const validate = this.ajv.compile(factory.configSchema);
    if (!validate(withSecrets)) {
      const issues = (validate.errors ?? []).map((error) => ({
        path: error.instancePath || "/",
        message: error.message ?? "ungültig",
        ...(error.keyword === "required"
          ? { missing: (error.params as { missingProperty?: string }).missingProperty }
          : {}),
      }));
      throw refuse(`Konfiguration von '${manifest.id}' ist ungültig.`, { issues });
    }
    for (const field of manifest.secretFields) delete withSecrets[field];
    return withSecrets as Record<string, unknown>;
  }

  private buildRuntime(
    category: AdapterCategory,
    entry: AdapterEntryConfig,
    factory: AdapterFactory,
    adapter: JarvisAdapter,
    manifest: AdapterManifest,
  ): Runtime {
    const lifecycle = new AdapterLifecycleMachine();
    const abort = new AbortController();
    const defaults = this.options.defaults ?? {};
    const timeoutMs = entry.timeoutMs ?? defaults.timeoutMs ?? 10_000;
    // The adapter's HTTP client retries transport errors; the registry level retry is opt-in to avoid retry storms.
    const retry = normalizeRetryConfig(entry.retry ?? defaults.retry) ?? { maxAttempts: 1 };
    const circuitBreaker = normalizeBreakerConfig(entry.circuitBreaker ?? defaults.circuitBreaker) ?? {};
    const breaker =
      circuitBreaker === false ? undefined : new CircuitBreaker(circuitBreaker, { clock: this.clock });
    const caller = createResilientCaller(
      { timeoutMs, retry, circuitBreaker },
      {
        clock: this.clock,
        ...(this.options.random ? { random: this.options.random } : {}),
        ...(breaker ? { breaker } : {}),
      },
    );

    const runtime: Runtime = {
      category,
      entry,
      factory,
      adapter,
      manifest,
      lifecycle,
      breaker,
      caller,
      abort,
      capabilities: new Set(),
      secrets: new Map(),
      failure: undefined,
      monitor: undefined as unknown as HealthMonitor,
    };
    runtime.monitor = new HealthMonitor({
      adapterId: manifest.id,
      adapter,
      lifecycle,
      clock: this.clock,
      logger: this.logger.child({ adapterId: manifest.id }),
      emit: (event) => this.dispatch(manifest.id, event),
      onCapabilitiesChanged: (set) => {
        runtime.capabilities = this.clampCapabilities(runtime, set.capabilities);
        this.publishCapabilitiesIfChanged();
      },
      ...(breaker ? { breaker } : {}),
      ...(this.options.healthIntervalMs ? { intervalMs: this.options.healthIntervalMs } : {}),
    });
    breaker?.onStateChange(() => runtime.monitor.notifyChange());
    lifecycle.onChange(() => this.publishCapabilitiesIfChanged());
    return runtime;
  }

  private clampCapabilities(runtime: Runtime, declared: readonly string[]): Set<string> {
    const manifestCaps = new Set(runtime.manifest.capabilities);
    const extra = declared.filter((capability) => !manifestCaps.has(capability));
    if (extra.length > 0) {
      this.logger.warn("getCapabilities() meldet mehr als das Manifest; Überschuss wird ignoriert", {
        adapterId: runtime.manifest.id,
        extra,
      });
    }
    return new Set(declared.filter((capability) => manifestCaps.has(capability)));
  }

  private async startRuntime(runtime: Runtime): Promise<void> {
    const { adapter, lifecycle, manifest, entry, category } = runtime;
    runtime.failure = undefined;
    lifecycle.transition("INITIALIZING", "start");
    try {
      const secrets = this.resolveSecrets(category, entry, manifest);
      runtime.secrets = secrets;
      const config = this.validateConfig(runtime.factory, manifest, entry, secrets);
      const redact = createRedactor(() => secrets.values());
      const context = this.createContext(runtime, config, redact);

      await this.withDeadline(
        () => adapter.initialize(context),
        this.options.initTimeoutMs ?? 15_000,
        `${manifest.id}.initialize`,
      );
      const declared = await adapter.getCapabilities();
      runtime.capabilities = this.clampCapabilities(runtime, declared.capabilities);
      runtime.monitor.rememberCapabilities({ capabilities: [...runtime.capabilities] });
    } catch (raw) {
      const error = normalizeError(raw);
      runtime.failure = { code: error.code, message: error.message };
      this.logger.error("Adapter-Initialisierung fehlgeschlagen", {
        adapterId: manifest.id,
        code: error.code,
        message: error.message,
      });
      if (lifecycle.state === "INITIALIZING") lifecycle.transition("OFFLINE", error.message);
      runtime.monitor.setFailure(runtime.failure);
      runtime.monitor.notifyChange();
      // No health polling: an adapter that failed to initialize is not usable until `restart()` (e.g. after a config fix).
      return;
    }
    await runtime.monitor.checkNow();
    runtime.monitor.start();
  }

  private createContext(
    runtime: Runtime,
    config: Record<string, unknown>,
    redact: (text: string) => string,
  ): AdapterContext {
    const adapterId = runtime.manifest.id;
    const secrets = runtime.secrets;
    const secretFields = new Set(runtime.manifest.secretFields);
    return {
      adapterId,
      mode: this.config?.mode ?? "mock",
      logger: createRedactingLogger(this.logger.child({ adapterId }), redact),
      clock: this.clock,
      config: Object.freeze(config),
      getSecret: (field) => (secretFields.has(field) ? secrets.get(field) : undefined),
      emit: (event) => {
        assertCanonicalEvent(event, `${adapterId} emit`);
        this.dispatch(adapterId, event);
      },
      signal: runtime.abort.signal,
      correlationId: () => correlationStore.getStore() ?? createCorrelationId(),
    };
  }

  private dispatch(adapterId: string, event: AdapterEventInput): void {
    try {
      this.options.onEvent?.({ adapterId, event });
    } catch (error) {
      this.logger.error("Event-Listener hat einen Fehler geworfen", {
        adapterId,
        type: event.type,
        error: normalizeError(error).message,
      });
    }
  }

  private withDeadline<T>(operation: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return withTimeout(() => operation(), { timeoutMs, clock: this.clock, operation: label });
  }

  /** Restarts one adapter: shutdown, fresh instance from the factory, initialize again. */
  async restart(adapterId: string): Promise<InitReport> {
    const runtime = this.findByAdapterId(adapterId);
    if (!runtime)
      throw new AdapterError({
        code: "NOT_FOUND",
        message: `Adapter '${adapterId}' ist nicht geladen.`,
        retryable: false,
      });
    await this.stop(runtime);
    this.runtimes.delete(runtime.category);
    return this.load(runtime.category, runtime.entry);
  }

  private async stop(runtime: Runtime): Promise<void> {
    const { lifecycle, monitor, adapter, abort, manifest } = runtime;
    monitor.stop();
    if (lifecycle.state === "STOPPED" || lifecycle.state === "UNREGISTERED") return;
    if (lifecycle.canTransition("STOPPING")) lifecycle.transition("STOPPING", "shutdown");
    abort.abort(new DOMException("Adapter shutdown", "AbortError"));
    try {
      await this.withDeadline(
        () => adapter.shutdown(),
        this.options.shutdownTimeoutMs ?? 5_000,
        `${manifest.id}.shutdown`,
      );
    } catch (error) {
      this.logger.error("Adapter-Shutdown fehlgeschlagen", {
        adapterId: manifest.id,
        error: normalizeError(error).message,
      });
    } finally {
      if (lifecycle.state === "STOPPING") lifecycle.transition("STOPPED", "shutdown complete");
      monitor.notifyChange();
    }
  }

  /** Stops every adapter; a failing shutdown of one never prevents the others. */
  async shutdownAll(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all([...this.runtimes.values()].map((runtime) => this.stop(runtime)));
  }

  // ---- introspection ---------------------------------------------------------------------------------------------

  private findByAdapterId(adapterId: string): Runtime | undefined {
    for (const runtime of this.runtimes.values()) if (runtime.manifest.id === adapterId) return runtime;
    return undefined;
  }

  listAdapters(): AdapterInfo[] {
    const infos: AdapterInfo[] = [];
    for (const runtime of this.runtimes.values()) {
      infos.push({
        manifest: runtime.manifest,
        health: runtime.monitor.snapshot(),
        enabled: runtime.entry.enabled,
        provider: runtime.entry.provider,
        mode: runtime.factory.modes?.length === 1 && runtime.factory.modes[0] === "mock" ? "mock" : "live",
      });
    }
    return infos;
  }

  /** Entries that could not be loaded at all (refused provider, invalid manifest). */
  listFailures(): InitReport[] {
    return [...this.failedEntries.values()].map(({ entry: _entry, ...report }) => report);
  }

  getHealth(adapterId: string): AdapterHealth {
    const runtime = this.findByAdapterId(adapterId);
    if (!runtime)
      throw new AdapterError({
        code: "NOT_FOUND",
        message: `Adapter '${adapterId}' ist nicht geladen.`,
        retryable: false,
      });
    return runtime.monitor.snapshot();
  }

  /** Forces a health check (used by "Verbindung testen"). */
  async checkHealth(adapterId: string): Promise<AdapterHealth> {
    const runtime = this.findByAdapterId(adapterId);
    if (!runtime)
      throw new AdapterError({
        code: "NOT_FOUND",
        message: `Adapter '${adapterId}' ist nicht geladen.`,
        retryable: false,
      });
    return runtime.monitor.checkNow();
  }

  /** Capability document of PLAN §9.2. Only adapters that currently serve (ONLINE/DEGRADED) contribute. */
  aggregateCapabilities(): Capabilities {
    const modules = emptyModules();
    for (const runtime of this.runtimes.values()) {
      if (!runtime.entry.enabled || !isServing(runtime.lifecycle.state)) continue;
      const adapterId = runtime.manifest.id;
      const touched = new Set<string>();
      for (const capability of runtime.capabilities) {
        const [moduleName, flag] = capability.split(".");
        if (!moduleName || !flag) continue;
        const targets = moduleName === "communication" ? ["communication", "mail"] : [moduleName];
        for (const target of targets) {
          const module = modules[target];
          if (!module || !(flag in module) || flag === "sources") continue;
          if (target === "mail" && flag === "multiChannel") continue;
          module[flag] = true;
          touched.add(target);
        }
      }
      for (const target of touched) {
        const sources = modules[target]?.sources as string[];
        if (!sources.includes(adapterId)) sources.push(adapterId);
      }
    }
    for (const capability of this.controlPlaneCapabilities) {
      const [moduleName, flag] = capability.split(".");
      const module = moduleName ? modules[moduleName] : undefined;
      if (module && flag && flag in module && flag !== "sources") module[flag] = true;
    }
    return { contractVersion: CONTRACT_VERSION, modules: modules as unknown as Capabilities["modules"] };
  }

  /**
   * Capabilities the control plane offers itself, independent of what the adapters declare (e.g. `system.restartAdapter`:
   * the registry restarts any loaded adapter). They are switched on in the aggregated document and in its change events.
   */
  provideControlPlaneCapabilities(capabilities: readonly string[]): void {
    this.controlPlaneCapabilities.clear();
    for (const capability of capabilities) this.controlPlaneCapabilities.add(capability);
    this.publishCapabilitiesIfChanged();
  }

  private publishCapabilitiesIfChanged(): void {
    if (this.shuttingDown) return;
    const document = this.aggregateCapabilities();
    const key = JSON.stringify(document);
    if (this.lastCapabilitiesKey === key) return;
    const initial = this.lastCapabilitiesKey === undefined;
    this.lastCapabilitiesKey = key;
    if (initial) return;
    this.dispatch("registry", {
      type: "jarvis.adapter.capabilities_changed",
      subject: "capabilities",
      data: document,
    });
  }

  /** True when the category has an enabled, serving adapter that declares the capability of `method`. */
  supports(category: PortCategory, method: string): boolean {
    const runtime = this.runtimes.get(category);
    const spec = findMethodSpec(category, method);
    return Boolean(
      runtime?.entry.enabled &&
      spec &&
      isServing(runtime.lifecycle.state) &&
      runtime.capabilities.has(spec.capability),
    );
  }

  // ---- ports -----------------------------------------------------------------------------------------------------

  /**
   * Returns the port of a category as a proxy. It exists even when nothing is configured; calling a method then throws
   * `CAPABILITY_MISSING` (disabled / not configured / capability not declared) or `ADAPTER_UNAVAILABLE` (offline).
   * Every call runs through timeout, retry and circuit breaker, and its result is validated against the contract.
   */
  getPort<C extends PortCategory>(category: C): PortMap[C] {
    let port = this.ports.get(category);
    if (!port) {
      port = this.createPortProxy(category);
      this.ports.set(category, port);
    }
    return port as PortMap[C];
  }

  private createPortProxy(category: PortCategory): PortMap[PortCategory] {
    const spec = PORT_SPEC[category] as Record<string, MethodSpec>;
    const handlers = new Map<string, (params: unknown, call: CallContext) => Promise<unknown>>();
    const target = {} as Record<string, unknown>;
    return new Proxy(target, {
      get: (_, property) => {
        if (typeof property !== "string" || !(property in spec)) return undefined;
        let handler = handlers.get(property);
        if (!handler) {
          handler = (params, call) =>
            this.invoke(category, property, spec[property] as MethodSpec, params, call);
          handlers.set(property, handler);
        }
        return handler;
      },
      has: (_, property) => typeof property === "string" && property in spec,
      ownKeys: () => Object.keys(spec),
      getOwnPropertyDescriptor: (_, property) =>
        typeof property === "string" && property in spec
          ? { enumerable: true, configurable: true }
          : undefined,
    }) as unknown as PortMap[PortCategory];
  }

  private async invoke(
    category: PortCategory,
    method: string,
    spec: MethodSpec,
    params: unknown,
    call: CallContext,
  ): Promise<unknown> {
    const correlationId = call?.correlationId ?? createCorrelationId();
    const callWithId: CallContext = { ...call, correlationId };
    const runtime = this.runtimes.get(category);
    const operation = `${category}.${method}`;
    try {
      if (!runtime || !runtime.entry.enabled) {
        throw new AdapterError({
          code: "CAPABILITY_MISSING",
          message: `Für '${category}' ist kein Adapter konfiguriert.`,
          retryable: false,
          details: { category, method },
        });
      }
      if (this.shuttingDown || !isServing(runtime.lifecycle.state)) {
        throw new AdapterError({
          code: "ADAPTER_UNAVAILABLE",
          message: `Der Adapter '${runtime.manifest.id}' ist derzeit nicht erreichbar (${runtime.lifecycle.state}).`,
          retryable: true,
          details: { adapterId: runtime.manifest.id, lifecycle: runtime.lifecycle.state },
        });
      }
      const implementation = (runtime.adapter as unknown as Record<string, unknown>)[method];
      if (!runtime.capabilities.has(spec.capability) || typeof implementation !== "function") {
        throw new AdapterError({
          code: "CAPABILITY_MISSING",
          message: `Der Adapter '${runtime.manifest.id}' unterstützt '${spec.capability}' nicht.`,
          retryable: false,
          details: { adapterId: runtime.manifest.id, capability: spec.capability },
        });
      }

      const mutationKey = (call as { idempotencyKey?: string } | undefined)?.idempotencyKey;
      const retryAllowed = !spec.mutating || Boolean(mutationKey);
      const result = await correlationStore.run(correlationId, () =>
        runtime.caller.call(
          (signal) => {
            const merged = call?.signal ? AbortSignal.any([signal, call.signal]) : signal;
            return (implementation as (params: unknown, call: CallContext) => Promise<unknown>).call(
              runtime.adapter,
              params,
              {
                ...callWithId,
                signal: merged,
              },
            );
          },
          { operation, retry: retryAllowed, ...(call?.signal ? { signal: call.signal } : {}) },
        ),
      );
      return validatePortResult(spec, result, {
        what: `${runtime.manifest.id} ${operation}`,
        onInvalid: ({ schema, error }) =>
          this.logger.error("Adapter lieferte vertragswidrige Daten; Ergebnis verworfen", {
            adapterId: runtime.manifest.id,
            operation,
            schema,
            issues: error.details.issues,
          }),
      });
    } catch (raw) {
      const error = normalizeError(raw, { operation }).withCorrelationId(correlationId);
      const level = error.code === "NOT_FOUND" || error.code === "CAPABILITY_MISSING" ? "debug" : "warn";
      this.logger[level]("Port-Aufruf fehlgeschlagen", { operation, code: error.code, correlationId });
      throw error;
    }
  }

  /** Provider/health summary used by the control API's overview. */
  describe(): Array<{
    category: AdapterCategory;
    adapterId: string;
    provider: string;
    lifecycle: string;
    capabilities: string[];
    updatedAt: string;
  }> {
    return [...this.runtimes.values()].map((runtime) => ({
      category: runtime.category,
      adapterId: runtime.manifest.id,
      provider: runtime.entry.provider,
      lifecycle: runtime.lifecycle.state,
      capabilities: [...runtime.capabilities],
      updatedAt: toIso(this.clock),
    }));
  }
}

type ModuleFlags = Record<string, boolean | string[]>;

const MODULE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  tasks: ["read", "create", "update", "cancel", "retry", "pause", "resume", "stream", "input"],
  activity: ["read", "stream", "backfill"],
  memory: ["read", "write", "delete", "search", "lock", "export", "resolveConflict"],
  agents: ["read", "pause", "resume", "stop", "assignTask"],
  approvals: ["read", "decide", "requestContext", "editBeforeApprove"],
  mail: ["read", "draft", "send"],
  communication: ["read", "draft", "send", "multiChannel"],
  calendar: ["read", "create", "reschedule", "cancel", "invite", "respond", "propose"],
  automations: ["read", "create", "update", "test", "enable", "disable", "pauseAll", "versions"],
  research: ["read", "create", "export"],
  files: ["read", "preview", "download", "delete", "upload", "rename"],
  voice: ["read", "test", "stop", "enroll", "deleteHistory"],
  notifications: ["read", "acknowledge", "snooze", "resolve"],
  system: ["read", "healthcheck", "restartAdapter", "openLogs"],
  audit: ["read", "export", "hashChain"],
  commands: ["execute", "stop", "pause", "resume", "history"],
  telephony: ["read", "call"],
};

function emptyModules(): Record<string, ModuleFlags> {
  return Object.fromEntries(
    Object.entries(MODULE_FLAGS).map(([name, flags]) => [
      name,
      { ...Object.fromEntries(flags.map((flag) => [flag, false])), sources: [] as string[] },
    ]),
  );
}
