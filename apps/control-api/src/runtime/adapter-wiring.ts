import {
  AdapterRegistry,
  type AdapterEntryConfig,
  type AdapterFactory,
  type InitReport,
  type Logger as AdapterLogger,
  type RegistryConfig,
  type SecretRequest,
} from "@jarvis/adapter-core";
import { calendarFactory } from "@jarvis/adapter-calendar-placeholder";
import { exampleTasksFactory } from "@jarvis/adapter-example-http";
import { hermesFactories as hermesLiveFactories } from "@jarvis/adapter-hermes";
import { hermesFactories as hermesPlaceholderFactories } from "@jarvis/adapter-hermes-placeholder";
import { mailFactory } from "@jarvis/adapter-mail-placeholder";
import { createMockFactories } from "@jarvis/adapter-mock";
import { localSystemFactory } from "@jarvis/adapter-system-local";
import { systemFactory } from "@jarvis/adapter-system-placeholder";
import { voiceHttpFactory } from "@jarvis/adapter-voice-http";
import { voiceFactory } from "@jarvis/adapter-voice-placeholder";
import {
  isSecretRefState,
  resolveSecret,
  type AdapterCategory,
  type JarvisConfig,
  type ResolvedAdapterConfig,
  type SecretRefState,
} from "@jarvis/config";
import type { Logger } from "@jarvis/observability";
import { MockWorld } from "@jarvis/mock-data";
import type { AdapterOverrideStore } from "../db/stores";
import type { EventHub } from "../realtime/hub";

export interface RuntimeSecrets {
  /** Secret values set through the settings UI. Kept in memory only: nothing secret is persisted (PLAN §49.6). */
  set(adapterId: string, field: string, value: string): void;
  get(adapterId: string, field: string): string | undefined;
  has(adapterId: string, field: string): boolean;
}

export function createRuntimeSecrets(): RuntimeSecrets {
  const values = new Map<string, string>();
  const key = (adapterId: string, field: string): string => `${adapterId}\u0000${field}`;
  return {
    set: (adapterId, field, value) => void values.set(key(adapterId, field), value),
    get: (adapterId, field) => values.get(key(adapterId, field)),
    has: (adapterId, field) => values.has(key(adapterId, field)),
  };
}

/**
 * Placeholder packages that a real adapter package supersedes. The real packages deliberately reuse the placeholder
 * provider ids (`hermes-tasks`, `hermes-activity`, `hermes-agents`, `jarvis-voice-http`), so an existing
 * `allowlist` entry that still points to the placeholder package keeps working and silently gets the real adapter
 * (a warning is logged). `windows-wsl-system` has no successor under the same id: the real system adapter is
 * `local-system` (`@jarvis/adapter-system-local`), the placeholder stays selectable.
 */
const SUPERSEDED_BY: Readonly<Record<string, string>> = {
  "@jarvis/adapter-hermes-placeholder": "@jarvis/adapter-hermes",
  "@jarvis/adapter-voice-placeholder": "@jarvis/adapter-voice-http",
};

/** Factories of every package the allowlist can point to. The API bundles them statically (no dynamic import). */
function packageFactories(world: MockWorld | undefined): Record<string, AdapterFactory[]> {
  return {
    "@jarvis/adapter-mock": world ? createMockFactories({ world }) : [],
    "@jarvis/adapter-example-http": [exampleTasksFactory],
    "@jarvis/adapter-mail-placeholder": [mailFactory],
    "@jarvis/adapter-calendar-placeholder": [calendarFactory],
    "@jarvis/adapter-voice-placeholder": [voiceFactory],
    "@jarvis/adapter-system-placeholder": [systemFactory],
    "@jarvis/adapter-hermes-placeholder": [...hermesPlaceholderFactories],
    "@jarvis/adapter-hermes": [...hermesLiveFactories],
    "@jarvis/adapter-voice-http": [voiceHttpFactory],
    "@jarvis/adapter-system-local": [localSystemFactory],
  };
}

export interface AdapterWiringOptions {
  config: JarvisConfig;
  logger: Logger;
  hub: EventHub;
  world: MockWorld | undefined;
  overrides: AdapterOverrideStore;
  secrets: RuntimeSecrets;
  env: NodeJS.ProcessEnv;
  healthIntervalMs?: number;
}

export interface AdapterWiring {
  readonly registry: AdapterRegistry;
  readonly factories: ReadonlyMap<string, AdapterFactory>;
  /** The entry objects handed to the registry; mutated in place before `registry.restart()`. */
  readonly entries: ReadonlyMap<AdapterCategory, AdapterEntryConfig>;
  /** Secret references from the config files per category/field (values are never read into config objects). */
  readonly secretRefs: ReadonlyMap<AdapterCategory, Readonly<Record<string, SecretRefState>>>;
  readonly resolved: ReadonlyMap<AdapterCategory, ResolvedAdapterConfig>;
  initialize(): Promise<InitReport[]>;
  isSecretConfigured(category: AdapterCategory, adapterId: string, field: string): boolean;
}

const isMockProvider = (provider: string): boolean => provider.startsWith("mock-");

/** Splits an adapter config into plain values and secret references. */
function splitConfig(config: Readonly<Record<string, unknown>>): {
  values: Record<string, unknown>;
  refs: Record<string, SecretRefState>;
} {
  const values: Record<string, unknown> = {};
  const refs: Record<string, SecretRefState> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isSecretRefState(value)) refs[key] = value;
    else values[key] = structuredClone(value);
  }
  return { values, refs };
}

export function wireAdapters(options: AdapterWiringOptions): AdapterWiring {
  const { config, logger, hub, world, overrides, secrets, env } = options;
  const factories = new Map<string, AdapterFactory>();
  const available = packageFactories(world);
  for (const [providerId, packageName] of Object.entries(config.allowlist)) {
    const successor = SUPERSEDED_BY[packageName];
    const real = successor ? available[successor]?.find((candidate) => candidate.providerId === providerId) : undefined;
    if (real) {
      logger.warn("Allowlist verweist auf ein Placeholder-Paket; der echte Adapter wird verwendet", { providerId, packageName, using: successor });
      factories.set(providerId, real);
      continue;
    }
    const factory = available[packageName]?.find((candidate) => candidate.providerId === providerId);
    if (factory) factories.set(providerId, factory);
    else logger.warn("Provider ist in der Allowlist, aber nicht im Build enthalten", { providerId, packageName });
  }

  const entries = new Map<AdapterCategory, AdapterEntryConfig>();
  const secretRefs = new Map<AdapterCategory, Readonly<Record<string, SecretRefState>>>();
  const resolvedByCategory = new Map<AdapterCategory, ResolvedAdapterConfig>();
  const savedOverrides = new Map(overrides.list().map((entry) => [entry.category, entry]));

  for (const [category, resolved] of Object.entries(config.adapters) as Array<[AdapterCategory, ResolvedAdapterConfig]>) {
    resolvedByCategory.set(category, resolved);
    if (resolved.provider === null) continue; // live mode, category not configured: no adapter at all
    const saved = savedOverrides.get(category);
    const { values, refs } = splitConfig(resolved.config);
    const mock = isMockProvider(resolved.provider);
    const provider = saved?.provider && !mock && config.dataMode !== "mock" ? saved.provider : resolved.provider;
    const entry: AdapterEntryConfig = {
      provider,
      enabled: saved?.enabled ?? resolved.enabled,
      config: { ...values, ...(saved?.config ?? {}) },
      timeoutMs: resolved.timeoutMs,
      // Mock adapters fail deterministically: retries and the breaker would only delay dev scenarios.
      retry: mock ? false : resolved.retry,
      circuitBreaker: mock ? false : resolved.circuitBreaker,
    };
    entries.set(category, entry);
    secretRefs.set(category, refs);
  }

  const secretProvider = (request: SecretRequest): string | undefined => {
    const runtime = secrets.get(request.adapterId, request.field);
    if (runtime !== undefined) return runtime;
    const ref = secretRefs.get(request.category)?.[request.field];
    if (!ref) return undefined;
    const result = resolveSecret(ref.ref, { env });
    return result.ok ? result.secret.reveal() : undefined;
  };

  const registry = new AdapterRegistry({
    allowlist: Object.keys(config.allowlist),
    logger: logger as unknown as AdapterLogger,
    secretProvider,
    onEvent: ({ adapterId, event }) => {
      hub.publish(`adapter://${adapterId}`, {
        type: event.type,
        subject: event.subject,
        data: event.data,
        correlationId: event.correlationId,
        causationId: event.causationId,
      } as Parameters<EventHub["publish"]>[1]);
    },
    ...(options.healthIntervalMs ? { healthIntervalMs: options.healthIntervalMs } : {}),
  });
  for (const [providerId, factory] of factories) registry.registerFactory(providerId, factory);

  return {
    registry,
    factories,
    entries,
    secretRefs,
    resolved: resolvedByCategory,
    async initialize() {
      const registryConfig: RegistryConfig = { mode: config.dataMode, adapters: Object.fromEntries(entries) };
      return registry.initialize(registryConfig);
    },
    isSecretConfigured(category, adapterId, field) {
      if (secrets.has(adapterId, field)) return true;
      const ref = secretRefs.get(category)?.[field];
      return ref ? resolveSecret(ref.ref, { env }).ok : false;
    },
  };
}

export function createWorld(
  config: JarvisConfig,
  options: { realTime: boolean; seed?: number; profile?: string; nextSequence?: (floor: number) => number; assistantName?: () => string },
): MockWorld | undefined {
  if (config.dataMode === "live") return undefined;
  return new MockWorld({
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.profile ? { profile: options.profile as never } : {}),
    ...(options.nextSequence ? { nextSequence: options.nextSequence } : {}),
    ...(options.assistantName ? { assistantName: options.assistantName } : {}),
    realTime: options.realTime,
  });
}
