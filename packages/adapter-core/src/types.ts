import type {
  AdapterCategory,
  AdapterManifest,
  HealthStatus,
  JarvisEventMap,
  JarvisEventType,
} from "@jarvis/sdk";
import type { Clock } from "./clock";
import type { Logger } from "./logger";
import type { PortCategory, PortMap } from "./ports";

export type DataMode = "mock" | "hybrid" | "live";

/**
 * Event as an adapter hands it to the hub. The hub assigns `id`, `time`, `sequence`, `specversion` and
 * `contractVersion`; `source` is `adapter://<adapterId>`.
 */
export type AdapterEventInput = {
  [K in JarvisEventType]: {
    type: K;
    /** Resource address, e.g. `task/task_01J...`. */
    subject: string;
    data: JarvisEventMap[K];
    correlationId?: string;
    causationId?: string;
  };
}[JarvisEventType];

export interface AdapterContext {
  readonly adapterId: string;
  readonly mode: DataMode;
  /** Logger bound to the adapter; messages and fields are secret-redacted by the registry. */
  readonly logger: Logger;
  /** Use this instead of `Date.now()` / `setTimeout` so that mocks and tests are deterministic. */
  readonly clock: Clock;
  /** Validated against the adapter's config schema; secret fields are NOT included, use `getSecret`. */
  readonly config: Readonly<Record<string, unknown>>;
  /** The only way to read a secret. Returns `undefined` when the field is not configured. */
  getSecret(field: string): string | undefined;
  /** Publishes a canonical event; payload is validated against the contract before it reaches the hub. */
  emit(event: AdapterEventInput): void;
  /** Aborted on shutdown; long-running work (polling, streams) must stop. */
  readonly signal: AbortSignal;
  /** Correlation id of the port call currently executing, or a fresh one for background work. */
  correlationId(): string;
}

/** What `healthCheck()` reports; the monitor completes it to the contract's `AdapterHealth`. */
export interface AdapterHealthReport {
  status: HealthStatus;
  latencyMs: number | null;
  /** Human-readable, German. For "offline"/"degraded" the reason. */
  message?: string;
  /** Machine-readable reason shown as `lastError.code`, e.g. `NOT_CONFIGURED`, `ADAPTER_TIMEOUT`. */
  errorCode?: string;
}

export interface CapabilitySet {
  /** `<module>.<flag>` strings, e.g. `tasks.read`. Must be a subset of the manifest's capabilities. */
  capabilities: string[];
}

/** PLAN §10.3. */
export interface JarvisAdapter {
  readonly manifest: AdapterManifest;
  initialize(context: AdapterContext): Promise<void>;
  /** Must never throw: an unreachable upstream is reported as `status: "offline"`. */
  healthCheck(): Promise<AdapterHealthReport>;
  getCapabilities(): Promise<CapabilitySet>;
  /** Releases timers, sockets and subscriptions. Port calls afterwards fail with ADAPTER_UNAVAILABLE. */
  shutdown(): Promise<void>;
  /**
   * Optional, for adapters with `*.stream`: performs one poll cycle of the provider's event source and emits the
   * resulting canonical events. Returns the number of emitted events. Background polling calls this as well.
   */
  pollEvents?(): Promise<number>;
}

/** An adapter of a port category: lifecycle plus the category's port. */
export type PortAdapter<C extends PortCategory = PortCategory> = JarvisAdapter &
  (C extends PortCategory ? PortMap[C] : never);

/** Factory registered under a provider id in the registry allowlist. */
export interface AdapterFactory<C extends AdapterCategory = AdapterCategory> {
  /** Provider id used in `config/adapters.yaml`, e.g. `example-tasks-http`. */
  readonly providerId: string;
  readonly category: C;
  /** JSON Schema (draft 2020-12) of the adapter's `config`. Referenced by `manifest.configSchemaRef`. */
  readonly configSchema: Readonly<Record<string, unknown>>;
  /** Data modes in which the factory may be used (mock adapters: ["mock"]). Default: all. */
  readonly modes?: readonly DataMode[];
  create(): JarvisAdapter;
}

export type { AdapterCategory, AdapterManifest };
