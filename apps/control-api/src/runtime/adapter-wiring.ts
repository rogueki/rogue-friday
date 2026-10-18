import {
  AdapterRegistry,
  type AdapterEntryConfig,
  type AdapterFactory,
  type InitReport,
  type Logger as AdapterLogger,
  type RegistryConfig,
  type SecretRequest,
} from "@friday/adapter-core";
import { calendarFactory } from "@friday/adapter-calendar-placeholder";
import { exampleTasksFactory } from "@friday/adapter-example-http";
import { hermesFactories as hermesLiveFactories } from "@friday/adapter-hermes";
import { hermesFactories as hermesPlaceholderFactories } from "@friday/adapter-hermes-placeholder";
import { mailFactory } from "@friday/adapter-mail-placeholder";
import { createMockFactories } from "@friday/adapter-mock";
import { localSystemFactory } from "@friday/adapter-system-local";
import { systemFactory } from "@friday/adapter-system-placeholder";
import { voiceHttpFactory } from "@friday/adapter-voice-http";
import { voiceFactory } from "@friday/adapter-voice-placeholder";
import {
  isSecretRefState,
  resolveSecret,
  type AdapterCategory,
  type FridayConfig,
  type ResolvedAdapterConfig,
  type SecretRefState,
} from "@friday/config";
import type { Logger } from "@friday/observability";
import { MockWorld } from "@friday/mock-data";
import type { AdapterOverrideStore } from "../db/stores";
import type { EventHub } from "../realtime/hub";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { kvGet, kvSet, type Db } from "../db/database";

export interface RuntimeSecrets {
  /** Secrets set through settings. Calendar credentials are encrypted in the local database. */
  set(adapterId: string, field: string, value: string): void;
  get(adapterId: string, field: string): string | undefined;
  has(adapterId: string, field: string): boolean;
}

export function createRuntimeSecrets(db?: Db, calendarKey?: Buffer): RuntimeSecrets {
  const values = new Map<string, string>();
  const key = (adapterId: string, field: string): string => `${adapterId}\u0000${field}`;
  const calendarFields = new Set(["feedUrl", "calendarUrl", "username", "password"]);
  const storage = (field: string) => field === "feedUrl"
    ? { slot: "calendar.feed-url.v1", aad: "friday/calendar-feed/v1" }
    : { slot: `calendar.caldav.${field}.v1`, aad: `friday/calendar-caldav/${field}/v1` };
  for (const field of calendarFields) {
    const stored = db ? kvGet(db, storage(field).slot) : undefined;
    if (stored && calendarKey) {
      try {
        const [nonce, tag, body] = stored.split(":").map((value) => Buffer.from(value, "base64"));
        if (!nonce || !tag || !body || nonce.length !== 12 || tag.length !== 16) throw new Error("invalid envelope");
        const decipher = createDecipheriv("aes-256-gcm", calendarKey, nonce);
        decipher.setAAD(Buffer.from(storage(field).aad));
        decipher.setAuthTag(tag);
        values.set(key("caldav-calendar", field), Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
      } catch { /* Fail closed for this field. */ }
    }
  }
  return {
    set: (adapterId, field, value) => {
      if (adapterId === "caldav-calendar" && calendarFields.has(field) && db && calendarKey) {
        const { slot, aad } = storage(field);
        if (value) {
          const nonce = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", calendarKey, nonce);
          cipher.setAAD(Buffer.from(aad));
          const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
          kvSet(db, slot, [nonce, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(":"));
        } else {
          db.prepare("DELETE FROM kv WHERE key = ?").run(slot);
        }
      }
      if (value) values.set(key(adapterId, field), value);
      else values.delete(key(adapterId, field));
    },
    get: (adapterId, field) => values.get(key(adapterId, field)),
    has: (adapterId, field) => values.has(key(adapterId, field)),
  };
}

/**
 * Placeholder packages that a real adapter package supersedes. The real packages deliberately reuse the placeholder
 * provider ids (`hermes-tasks`, `hermes-activity`, `hermes-agents`, `friday-voice-http`), so an existing
 * `allowlist` entry that still points to the placeholder package keeps working and silently gets the real adapter
 * (a warning is logged). `windows-wsl-system` has no successor under the same id: the real system adapter is
 * `local-system` (`@friday/adapter-system-local`), the placeholder stays selectable.
 */
const SUPERSEDED_BY: Readonly<Record<string, string>> = {
  "@friday/adapter-hermes-placeholder": "@friday/adapter-hermes",
  "@friday/adapter-voice-placeholder": "@friday/adapter-voice-http",
};

/** Factories of every package the allowlist can point to. The API bundles them statically (no dynamic import). */
function packageFactories(world: MockWorld | undefined): Record<string, AdapterFactory[]> {
  return {
    "@friday/adapter-mock": world ? createMockFactories({ world }) : [],
    "@friday/adapter-example-http": [exampleTasksFactory],
    "@friday/adapter-mail-placeholder": [mailFactory],
    "@friday/adapter-calendar-placeholder": [calendarFactory],
    "@friday/adapter-voice-placeholder": [voiceFactory],
    "@friday/adapter-system-placeholder": [systemFactory],
    "@friday/adapter-hermes-placeholder": [...hermesPlaceholderFactories],
    "@friday/adapter-hermes": [...hermesLiveFactories],
    "@friday/adapter-voice-http": [voiceHttpFactory],
    "@friday/adapter-system-local": [localSystemFactory],
  };
}

export interface AdapterWiringOptions {
  config: FridayConfig;
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
    const provider = saved?.provider && (!mock || category === "calendar") && config.dataMode !== "mock" ? saved.provider : resolved.provider;
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
  config: FridayConfig,
  options: { realTime: boolean; seed?: number; profile?: string; nextSequence?: (floor: number) => number; assistantName?: () => string },
): MockWorld | undefined {
  if (config.dataMode === "live") return undefined;
  return new MockWorld({
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    // Hybrid's fallback adapters provide empty placeholders on a normal installation. Explicit demo profiles and
    // standalone mock mode keep their curated scenarios; neither path touches persisted live-adapter data.
    profile: (options.profile ?? (config.dataMode === "hybrid" ? "empty" : "default")) as never,
    ...(options.nextSequence ? { nextSequence: options.nextSequence } : {}),
    ...(options.assistantName ? { assistantName: options.assistantName } : {}),
    realTime: options.realTime,
  });
}
