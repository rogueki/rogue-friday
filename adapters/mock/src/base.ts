import {
  AdapterError,
  allowedCapabilities,
  sleep,
  systemClock,
  type AdapterContext,
  type AdapterHealthReport,
  type CallContext,
  type CapabilitySet,
  type JarvisAdapter,
  type MutationContext,
  type Page,
  type PortCategory,
  type Single,
} from "@jarvis/adapter-core";
import { CONTRACT_VERSION, type AdapterManifest, type JarvisEvent } from "@jarvis/sdk";
import { CATEGORY_LABEL, MODULE_CATEGORY, adapterIdFor, type MockWorld, type OpContext } from "@jarvis/mock-data";
import type { MockTransport } from "./transport";
import { worldTransport } from "./transport";

export interface MockAdapterOptions {
  /** Shared in-memory platform every mock adapter wraps. */
  world: MockWorld;
  /**
   * Seam in front of every port call and health probe. The default simulates availability, latency and errors through
   * the world; conformance tests plug in an HTTP-backed transport to inject real transport faults (docs/ADAPTER_CONFORMANCE.md).
   */
  transport?: MockTransport;
}

export const MOCK_CONFIG_SCHEMA_ID = (category: PortCategory): string => `urn:jarvis:adapter:${adapterIdFor(category)}:config`;

const SECRET_FIELDS: Partial<Record<PortCategory, string[]>> = {
  communication: ["imapPassword", "smtpPassword"],
  system: ["workerToken"],
};

export const mockSecretFields = (category: PortCategory): string[] => SECRET_FIELDS[category] ?? [];

/** JSON Schema of the mock adapter's configuration (rendered as a form in Settings). Secrets are write-only. */
export function mockConfigSchema(category: PortCategory): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    seed: { type: "integer", minimum: 0, title: "Seed (nur wirksam, wenn gesetzt)", description: "Setzt die Welt mit diesem Seed neu auf." },
    profile: {
      type: "string",
      enum: ["default", "empty", "highLoad", "longGerman"],
      title: "Datenprofil",
      description: "Setzt die Welt mit diesem Profil neu auf.",
    },
    latencyMs: { type: "integer", minimum: 0, maximum: 10_000, default: 0, title: "Simulierte Latenz (ms)" },
    errorRate: { type: "number", minimum: 0, maximum: 1, default: 0, title: "Fehlerquote (0 bis 1)" },
  };
  if (category === "communication") {
    properties.imapHost = { type: "string", default: "imap.gmx.example", title: "IMAP-Server" };
    properties.imapPassword = { type: "string", format: "password", title: "IMAP-Passwort", writeOnly: true };
    properties.smtpPassword = { type: "string", format: "password", title: "SMTP-Passwort", writeOnly: true };
  }
  if (category === "system") {
    properties.workerToken = { type: "string", format: "password", title: "Worker-Token", writeOnly: true };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: MOCK_CONFIG_SCHEMA_ID(category),
    title: `Mock ${CATEGORY_LABEL[category]}`,
    type: "object",
    properties,
    additionalProperties: false,
  };
}

export function mockManifest(category: PortCategory): AdapterManifest {
  return {
    id: adapterIdFor(category),
    name: `Mock ${CATEGORY_LABEL[category]}`,
    adapterVersion: "1.0.0",
    contractVersion: CONTRACT_VERSION,
    apiVersion: "v1",
    category,
    capabilities: [...allowedCapabilities(category)].sort(),
    configSchemaRef: MOCK_CONFIG_SCHEMA_ID(category),
    secretFields: mockSecretFields(category),
  };
}

/**
 * Capabilities of one category as the world currently offers them: the manifest's capabilities whose flag is on in the
 * world's capability document. Also used by the Control API to notice dev toggles without waiting for a restart.
 */
export function worldCapabilities(world: MockWorld, category: PortCategory): string[] {
  const manifest = new Set(mockManifest(category).capabilities);
  const modules = world.state.capabilities.modules as unknown as Record<string, Record<string, unknown>>;
  const capabilities: string[] = [];
  for (const [moduleName, flags] of Object.entries(modules)) {
    const owner = MODULE_CATEGORY[moduleName as keyof typeof MODULE_CATEGORY];
    // `mail` mirrors `communication`; only the canonical module names are reported.
    if (owner !== category || moduleName === "mail" || moduleName === "telephony") continue;
    for (const [flag, value] of Object.entries(flags)) {
      const capability = `${moduleName}.${flag}`;
      if (value === true && manifest.has(capability)) capabilities.push(capability);
    }
  }
  return capabilities.sort();
}

const ORB_AND_CORE_SOURCES = /^control-api:\/\//;

/**
 * Common lifecycle of the mock adapters: wraps one category of the shared `MockWorld`, forwards that category's
 * events, derives health and capabilities from the world's adapter state and routes every call through the transport.
 */
export abstract class MockAdapterBase implements JarvisAdapter {
  readonly manifest: AdapterManifest;
  protected readonly world: MockWorld;
  private readonly transport: MockTransport;
  private context: AdapterContext | undefined;
  private unsubscribe: (() => void) | undefined;
  private closed = true;

  protected constructor(
    protected readonly category: PortCategory,
    options: MockAdapterOptions,
  ) {
    this.world = options.world;
    this.transport = options.transport ?? worldTransport();
    this.manifest = mockManifest(category);
  }

  async initialize(context: AdapterContext): Promise<void> {
    this.context = context;
    this.closed = false;
    const config = context.config;
    const profile = config.profile;
    const seed = config.seed;
    if (
      (typeof profile === "string" && profile !== this.world.profile) ||
      (typeof seed === "number" && seed !== this.world.seed)
    ) {
      this.world.loadProfile((typeof profile === "string" ? profile : this.world.profile) as typeof this.world.profile, {
        ...(typeof seed === "number" ? { seed } : {}),
      });
    }
    if (typeof config.latencyMs === "number") this.world.setLatency(config.latencyMs, this.category);
    if (typeof config.errorRate === "number") this.world.setErrorRate(config.errorRate, this.category);
    this.unsubscribe = this.world.events.subscribe((event) => this.forward(event));
    await this.transport.open?.(context);
  }

  async healthCheck(): Promise<AdapterHealthReport> {
    if (this.closed) return { status: "offline", latencyMs: null, message: "Adapter ist gestoppt.", errorCode: "ADAPTER_UNAVAILABLE" };
    const state = this.world.state.adapters.find((adapter) => adapter.category === this.category);
    try {
      const probe = await this.transport.probe(this.context?.signal);
      if (!state) return { status: "online", latencyMs: probe.latencyMs };
      const health = this.world.adapterHealth(this.category as never);
      if (!state.enabled) return { status: "offline", latencyMs: null, message: "Adapter ist deaktiviert.", errorCode: "ADAPTER_UNAVAILABLE" };
      if (health.status === "offline") {
        return {
          status: "offline",
          latencyMs: null,
          message: health.lastError?.message ?? "Adapter nicht erreichbar.",
          errorCode: health.lastError?.code ?? "ADAPTER_UNAVAILABLE",
        };
      }
      return {
        status: health.status,
        latencyMs: Math.max(0, Math.round(health.latencyMs ?? probe.latencyMs)),
        ...(health.status === "degraded"
          ? { message: health.lastError?.message ?? "Eingeschränkt verfügbar.", errorCode: health.lastError?.code ?? "ADAPTER_UNAVAILABLE" }
          : {}),
      };
    } catch (error) {
      const failure = error instanceof AdapterError ? error : undefined;
      return {
        status: "offline",
        latencyMs: null,
        message: failure?.message ?? "Adapter nicht erreichbar.",
        errorCode: failure?.code ?? "ADAPTER_UNAVAILABLE",
      };
    }
  }

  /** Capabilities currently switched on in the world (`dev` capability toggles are reflected here). */
  async getCapabilities(): Promise<CapabilitySet> {
    return { capabilities: worldCapabilities(this.world, this.category) };
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.transport.close?.();
  }

  // ---- helpers for the concrete adapters ------------------------------------------------------------------------

  /**
   * Runs one port call: refuses after shutdown, passes the transport (faults), applies the world's injected latency and
   * then executes `operation` against the world.
   */
  protected async call<T>(
    method: string,
    context: CallContext | MutationContext,
    operation: () => T,
    options: { mutating?: boolean } = {},
  ): Promise<T> {
    if (this.closed) {
      throw new AdapterError({
        code: "ADAPTER_UNAVAILABLE",
        message: `Der Adapter '${this.manifest.id}' wurde beendet.`,
        retryable: false,
        details: { adapterId: this.manifest.id },
      });
    }
    const mutation = context as MutationContext;
    await this.transport.beforeCall({
      method,
      mutating: options.mutating === true,
      ...(mutation.idempotencyKey ? { idempotencyKey: mutation.idempotencyKey } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
      correlationId: context.correlationId,
    });
    const delayMs = this.latency();
    if (delayMs > 0) await sleep(this.context?.clock ?? systemClock, delayMs, context.signal);
    return operation();
  }

  private latency(): number {
    try {
      return this.world.latencyFor(this.category as never);
    } catch {
      return 0;
    }
  }

  protected op(context: CallContext | MutationContext): OpContext {
    const mutation = context as MutationContext;
    return {
      correlationId: context.correlationId,
      ...(context.actor ? { actor: context.actor } : {}),
      ...(mutation.idempotencyKey ? { idempotencyKey: mutation.idempotencyKey } : {}),
      ...(mutation.ifMatchVersion !== undefined ? { ifMatch: mutation.ifMatchVersion } : {}),
    };
  }

  /** World queries do not know `cursor: null`; the port contract allows it. */
  protected q<T extends { cursor?: string | null }>(params: T): Omit<T, "cursor"> & { cursor?: string } {
    const { cursor, ...rest } = params;
    return { ...rest, ...(cursor ? { cursor } : {}) };
  }

  protected page<T>(page: { items: T[]; pageInfo: Page<T>["pageInfo"] }): Page<T> {
    return {
      items: page.items,
      pageInfo: page.pageInfo,
      freshness: this.world.freshness(this.category as never),
      sources: this.world.sources(this.category as never),
    };
  }

  protected single<T>(data: T): Single<T> {
    return { data, freshness: this.world.freshness(this.category as never) };
  }

  private forward(event: JarvisEvent): void {
    // Only this category's own events leave the adapter. Core events (orb, overall status, resync) belong to the hub,
    // and adapter-health / capability changes are re-derived from health checks by the registry.
    if (ORB_AND_CORE_SOURCES.test(event.source)) return;
    if (event.source !== `adapter://${this.manifest.id}`) return;
    const context = this.context;
    if (!context || this.closed) return;
    try {
      context.emit({
        type: event.type,
        subject: event.subject,
        data: event.data,
        ...(event.correlationId ? { correlationId: event.correlationId } : {}),
        ...(event.causationId ? { causationId: event.causationId } : {}),
      } as Parameters<AdapterContext["emit"]>[0]);
    } catch (error) {
      context.logger.warn("Mock-Ereignis wurde vom Vertrag abgelehnt", {
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

