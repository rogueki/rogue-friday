import { isJarvisApiError, type AdapterCategory, type AdapterInfo, type Capabilities, type HealthStatus, type Overview } from "@jarvis/sdk";
import { capabilityState } from "@/lib/capabilities";

/**
 * One decision table for "why is this module not usable" (PLAN §9.3, §1.1 rules 10/11). Three different situations must
 * never look alike:
 *
 *  - `not-configured`: no adapter serves the module (none registered, disabled, or a placeholder without configuration).
 *  - `outage`: an adapter is registered and enabled but offline/unreachable (health, lifecycle or error code say so).
 *  - `unsupported`: the adapter is up but does not offer the capability (`Lesen verfügbar / X nicht verfügbar`).
 *
 * Inputs are `/adapters` (manifest + health), `/capabilities` and the API error code; nothing is derived from message text.
 */

/** Capability module -> adapter category that serves it (mirrors the Control API's registry). */
export const MODULE_CATEGORY: Readonly<Record<string, AdapterCategory>> = {
  tasks: "tasks",
  activity: "activity",
  memory: "memory",
  agents: "agents",
  approvals: "approvals",
  mail: "communication",
  communication: "communication",
  calendar: "calendar",
  automations: "automations",
  research: "research",
  files: "files",
  voice: "voice",
  notifications: "notifications",
  system: "system",
  audit: "audit",
  commands: "commands",
};

/** Labels the Control API puts into `overview.degradedSections[].section` (one per adapter category). */
const SECTION_LABEL_CATEGORY: Readonly<Record<string, AdapterCategory>> = {
  Aufgaben: "tasks",
  "Live-Aktivität": "activity",
  Gedächtnis: "memory",
  Agenten: "agents",
  Freigaben: "approvals",
  "E-Mail & Kommunikation": "communication",
  Kalender: "calendar",
  Automationen: "automations",
  Recherche: "research",
  Dateien: "files",
  Sprache: "voice",
  Benachrichtigungen: "notifications",
  System: "system",
  Audit: "audit",
  Befehle: "commands",
};

/** Overview panel ids that are not adapter categories but read from one. */
const PANEL_CATEGORY: Readonly<Record<string, AdapterCategory>> = {
  models: "system",
  services: "system",
  alerts: "notifications",
  mail: "communication",
  timeline: "activity",
  quickCommands: "commands",
};

/** Resolves a section id or label (`"tasks"`, `"Aufgaben"`, `"models"`) to its adapter category. */
export function categoryOfSection(section: string): AdapterCategory | undefined {
  if (section in SECTION_LABEL_CATEGORY) return SECTION_LABEL_CATEGORY[section];
  if (section in PANEL_CATEGORY) return PANEL_CATEGORY[section];
  return Object.values(MODULE_CATEGORY).includes(section as AdapterCategory) ? (section as AdapterCategory) : MODULE_CATEGORY[section];
}

/** Nav label key (i18n) of the page that belongs to an adapter category. */
export const CATEGORY_NAV_KEY: Readonly<Record<AdapterCategory, string>> = {
  tasks: "nav.tasks",
  activity: "nav.activity",
  memory: "nav.memory",
  agents: "nav.agents",
  approvals: "nav.approvals",
  communication: "nav.communication",
  calendar: "nav.calendar",
  automations: "nav.automations",
  research: "nav.research",
  files: "nav.files",
  voice: "nav.voice",
  notifications: "nav.alerts",
  system: "nav.system",
  audit: "nav.audit",
  commands: "nav.overview",
};

export const UNCONFIGURED_PREFIX = "unconfigured-";

type DegradedSection = Overview["degradedSections"][number];

/** Category of a degraded overview entry: the label, an `unconfigured-<category>` id, or the registered adapter. */
export function categoryOfDegradedEntry(entry: DegradedSection, adapters?: readonly AdapterInfo[]): AdapterCategory | undefined {
  const fromSection = categoryOfSection(entry.section);
  if (fromSection) return fromSection;
  if (entry.adapterId.startsWith(UNCONFIGURED_PREFIX)) return categoryOfSection(entry.adapterId.slice(UNCONFIGURED_PREFIX.length));
  return adapters?.find((adapter) => adapter.manifest.id === entry.adapterId)?.manifest.category;
}

/** True for the Control API's marker of a category without any adapter ("Kein Adapter konfiguriert."). */
export function isUnconfiguredEntry(entry: DegradedSection): boolean {
  return entry.adapterId.startsWith(UNCONFIGURED_PREFIX);
}

export interface OutageInfo {
  adapterId: string;
  /** Manifest name of the adapter, e.g. "Voice HTTP"; the id when the manifest is unknown. */
  adapterName: string;
  reason?: string;
  /** When the outage began as far as this client knows (first observation, else the last success). */
  since?: string | null;
  lastSuccessAt?: string | null;
  status?: HealthStatus;
  /** Lifecycle RECOVERING: reachable again but not yet confirmed online. */
  recovering?: boolean;
}

export type Availability =
  /** Adapter and capability information still loading. */
  | { kind: "pending" }
  | { kind: "ok" }
  | { kind: "not-configured"; category: AdapterCategory; adapterId?: string }
  | { kind: "outage"; category: AdapterCategory; outage: OutageInfo }
  | { kind: "unsupported"; category: AdapterCategory; capability: string; adapterId?: string; adapterName?: string };

export interface AvailabilityInput {
  /** Capability module (`voice`, `mail`, …) or the adapter category directly. */
  module: string;
  /** `undefined` while loading or when the list is not readable for this role. */
  adapters: readonly AdapterInfo[] | undefined;
  adaptersPending: boolean;
  capabilities: Capabilities | undefined;
  capabilitiesPending: boolean;
  /** Error of the module's own query, when it failed. */
  error?: unknown;
  /** Capability that must be granted (default `read`). */
  action?: string;
}

const NOT_CONFIGURED_CODE = "NOT_CONFIGURED";

/** Offline health or an adapter that is not serving (lifecycle) counts as an outage; a placeholder without config does not. */
function adapterOutage(adapter: AdapterInfo): boolean {
  const { status, lifecycle, lastError } = adapter.health;
  if (lastError?.code === NOT_CONFIGURED_CODE) return false;
  if (lifecycle === "OFFLINE" || lifecycle === "RECOVERING" || lifecycle === "STOPPED" || lifecycle === "STOPPING") return true;
  return status === "offline";
}

export function adapterNotConfigured(adapter: AdapterInfo): boolean {
  return !adapter.enabled || adapter.health.lastError?.code === NOT_CONFIGURED_CODE;
}

export function outageOf(adapter: AdapterInfo, since?: string | null): OutageInfo {
  return {
    adapterId: adapter.manifest.id,
    adapterName: adapter.manifest.name,
    reason: adapter.health.lastError?.message,
    since: since ?? adapter.health.lastSuccessAt ?? null,
    lastSuccessAt: adapter.health.lastSuccessAt,
    status: adapter.health.status,
    recovering: adapter.health.lifecycle === "RECOVERING",
  };
}

/** Outage info from an overview entry when `/adapters` has no better data (name defaults to the adapter id). */
export function outageFromSection(entry: DegradedSection, adapter?: AdapterInfo, since?: string | null): OutageInfo {
  if (adapter) return { ...outageOf(adapter, since), reason: entry.reason || adapter.health.lastError?.message };
  return { adapterId: entry.adapterId, adapterName: adapterLabel(entry.adapterId), reason: entry.reason, since: since ?? null, lastSuccessAt: null, status: "offline" };
}

/** Adapter id as a name; empty for the `unconfigured-<category>` placeholder (the caller names the module instead). */
function adapterLabel(id: string): string {
  return id.startsWith(UNCONFIGURED_PREFIX) ? "" : id;
}

const OUTAGE_ERROR_CODES: ReadonlySet<string> = new Set(["ADAPTER_UNAVAILABLE", "ADAPTER_TIMEOUT"]);

/** Error codes that mean "the backing adapter cannot serve this" (outage or not configured), never "bad request". */
export function isAdapterOutage(error: unknown): boolean {
  return isJarvisApiError(error) && (OUTAGE_ERROR_CODES.has(error.code) || error.code === "CAPABILITY_MISSING");
}

/** Pure decision; see the file comment. `since` resolves the outage start from the client's first observation. */
export function classifyAvailability(input: AvailabilityInput, since: (adapterId: string) => string | undefined = () => undefined): Availability {
  const category = MODULE_CATEGORY[input.module] ?? categoryOfSection(input.module);
  if (!category) return { kind: "ok" };
  const action = input.action ?? "read";
  const capMissing = input.capabilities !== undefined && capabilityState(input.capabilities, input.module, action) === "missing";
  const adapter = input.adapters?.find((candidate) => candidate.manifest.category === category);
  const error = isJarvisApiError(input.error) ? input.error : null;

  if (input.adapters) {
    if (adapter && adapterNotConfigured(adapter)) return { kind: "not-configured", category, adapterId: adapter.manifest.id };
    if (adapter && adapterOutage(adapter)) return { kind: "outage", category, outage: outageOf(adapter, since(adapter.manifest.id)) };
    if (error && OUTAGE_ERROR_CODES.has(error.code)) {
      // Adapter list says "online" but the call failed: trust the call (the health probe may lag behind).
      const id = adapter?.manifest.id ?? (typeof error.details.adapterId === "string" ? error.details.adapterId : `unconfigured-${category}`);
      return {
        kind: "outage",
        category,
        outage: adapter
          ? { ...outageOf(adapter, since(adapter.manifest.id)), reason: error.message }
          : { adapterId: id, adapterName: adapterLabel(id), reason: error.message, since: since(id) ?? null, lastSuccessAt: null },
      };
    }
    const missing = capMissing || error?.code === "CAPABILITY_MISSING";
    if (!adapter && missing) return { kind: "not-configured", category };
    if (adapter && missing) return { kind: "unsupported", category, capability: `${input.module}.${action}`, adapterId: adapter.manifest.id, adapterName: adapter.manifest.name };
    return !input.capabilities && input.capabilitiesPending ? { kind: "pending" } : { kind: "ok" };
  }

  // No adapter list (pending, or not readable for this role): fall back on capabilities and the error code alone.
  if (error && OUTAGE_ERROR_CODES.has(error.code)) {
    const id = typeof error.details.adapterId === "string" ? error.details.adapterId : `unconfigured-${category}`;
    return { kind: "outage", category, outage: { adapterId: id, adapterName: adapterLabel(id), reason: error.message, since: since(id) ?? null, lastSuccessAt: null } };
  }
  if (capMissing || error?.code === "CAPABILITY_MISSING") {
    return input.adaptersPending ? { kind: "pending" } : { kind: "not-configured", category };
  }
  if (!input.capabilities && input.capabilitiesPending) return { kind: "pending" };
  return { kind: "ok" };
}

