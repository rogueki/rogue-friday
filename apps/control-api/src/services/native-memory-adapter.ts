import {
  AdapterError, createId, normalizeError, toIso,
  type ActionOutcome, type AdapterContext, type AdapterFactory, type AdapterHealthReport, type CallContext,
  type CapabilitySet, type FridayAdapter, type IdParam, type ListMemoryParams, type MemoryPort, type MutationContext,
  type Page, type Single,
} from "@friday/adapter-core";
import { CONTRACT_VERSION, type AdapterManifest, type Memory, type SourceDescriptor } from "@friday/sdk";
import { stableUserId } from "../security/auth-service";
import type { DurableMemoryService, IntegrationEvent } from "./durable-memory";

export const NATIVE_MEMORY_PROVIDER_ID = "friday-memory";
export const NATIVE_MEMORY_CONFIG_SCHEMA_ID = "urn:friday:adapter:friday-memory:config";
export const nativeMemoryConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: NATIVE_MEMORY_CONFIG_SCHEMA_ID,
  title: "Friday-Gedächtnis (Obsidian)",
  description: "Eingebauter Adapter ohne Einstellungen: liest das Obsidian-Gesprächsarchiv von F.R.I.D.A.Y. (Ordner Conversations).",
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;
export const nativeMemoryManifest: AdapterManifest = {
  id: NATIVE_MEMORY_PROVIDER_ID,
  name: "Friday-Gedächtnis (Obsidian)",
  adapterVersion: "1.0.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "memory",
  // Read-only archive; forgetting maps to DurableMemoryService.forget. No write/search/lock/export claimed.
  capabilities: ["memory.read", "memory.delete"],
  configSchemaRef: NATIVE_MEMORY_CONFIG_SCHEMA_ID,
  secretFields: [],
};

const KIND_LABEL: Record<IntegrationEvent["eventType"], string> = {
  user_utterance: "Äußerung des Nutzers",
  assistant_response: "Antwort des Assistenten",
  action_result: "Aktionsergebnis",
};
const OUTCOME_LABEL: Record<IntegrationEvent["outcome"], string> = {
  completed: "abgeschlossen",
  aborted: "abgebrochen",
  uncertain: "Ergebnis unsicher",
};
const sourceOf = (lastSyncedAt: string): SourceDescriptor =>
  ({ adapterId: NATIVE_MEMORY_PROVIDER_ID, system: "obsidian", lastSyncedAt });

const OWNER_IDENTITIES: readonly string[] = [stableUserId("owner"), stableUserId("local-auto-owner")];

export function memoryIdOf(eventId: string): string {
  return createId("mem", `friday-memory:${eventId}`);
}

export function memoryIdentitiesFor(call: CallContext | undefined): readonly string[] {
  // Both owner sessions (password login and local automatic login) are the one local owner: voice and Hermes
  // conversations are stored under the password owner's id, dashboard ones under the session's own id.
  if (call?.actor?.type === "user" && !OWNER_IDENTITIES.includes(call.actor.id)) return [call.actor.id];
  return OWNER_IDENTITIES;
}

function contentOf(event: IntegrationEvent): string {
  if (event.payload.kind === "text") return event.payload.text.trim() ? event.payload.text : "(leere Nachricht)";
  const target = event.payload.targetId ? `\nZiel: ${event.payload.targetId}` : "";
  return `Aktion ${event.payload.actionId}: ${OUTCOME_LABEL[event.outcome]}${target}`;
}

function titleOf(content: string): string {
  const line = content.split("\n").find((candidate) => candidate.trim()) ?? "";
  const collapsed = line.replace(/\s+/g, " ").trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 79)}…` : collapsed;
}

const encodeCursor = (offset: number): string => Buffer.from(`o:${offset}`).toString("base64url");

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const match = /^o:(\d+)$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!match) throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungültiger Cursor.", retryable: false });
  return Number(match[1]);
}

export function createNativeMemoryFactory(memory: () => DurableMemoryService): AdapterFactory<"memory"> {
  return {
    providerId: NATIVE_MEMORY_PROVIDER_ID,
    category: "memory",
    configSchema: nativeMemoryConfigSchema,
    modes: ["live", "hybrid"],
    create: () => new NativeMemoryAdapter(memory),
  };
}

export class NativeMemoryAdapter implements FridayAdapter, MemoryPort {
  readonly manifest = nativeMemoryManifest;
  /** Memory id -> event id, so repeated reads do not rescan the identity's written events. */
  private readonly ids = new Map<string, string>();
  private service: DurableMemoryService | undefined;
  private context: AdapterContext | undefined;

  constructor(private readonly memory: () => DurableMemoryService) {}

  async initialize(context: AdapterContext): Promise<void> {
    this.context = context;
    this.service = this.memory();
  }

  async getCapabilities(): Promise<CapabilitySet> {
    return { capabilities: [...nativeMemoryManifest.capabilities] };
  }

  async shutdown(): Promise<void> {
    // The runtime owns the service instance; the adapter only drops its reference.
    this.service = undefined;
    this.context = undefined;
    this.ids.clear();
  }

  async healthCheck(): Promise<AdapterHealthReport> {
    const context = this.context;
    const service = this.service;
    if (!context || !service)
      return { status: "offline", latencyMs: null, message: "Adapter ist nicht aktiv", errorCode: "ADAPTER_UNAVAILABLE" };
    const started = context.clock.now();
    let report: { vaultReadable: boolean; indexError: string | null; pending: number; lastError: string | null };
    try {
      report = service.health();
    } catch (raw) {
      return { status: "offline", latencyMs: null, message: "Gedächtnisindex ist nicht lesbar", errorCode: normalizeError(raw).code };
    }
    const latencyMs = Math.max(0, Math.round(context.clock.now() - started));
    if (!report.vaultReadable)
      return { status: "offline", latencyMs: null, errorCode: "VAULT_UNAVAILABLE",
        message: "Obsidian-Vault ist nicht erreichbar (Ordner mit .obsidian fehlt oder ist nicht lesbar)." };
    if (report.indexError)
      return { status: "degraded", latencyMs, message: `Gedächtnisindex unvollständig: ${report.indexError}`,
        errorCode: "INDEX_INCOMPLETE" };
    if (report.pending > 0 && report.lastError)
      return { status: "degraded", latencyMs, message: `${report.pending} Einträge warten auf den Vault: ${report.lastError}`,
        errorCode: "VAULT_WRITE_PENDING" };
    return { status: "online", latencyMs };
  }

  async listMemory(params: ListMemoryParams, call: CallContext): Promise<Page<Memory>> {
    const { service, context } = this.ready();
    const limit = Math.min(200, Math.max(1, Math.floor(params.limit ?? 50)));
    const offset = decodeCursor(params.cursor);
    const syncedAt = toIso(context.clock);
    const source = sourceOf(syncedAt);
    const freshness = { state: "fresh" as const, asOf: syncedAt };
    // The archive holds only normal-sensitivity, unlocked, unpinned episode memories.
    const filtered = (params.type !== undefined && params.type.length > 0 && !params.type.includes("episode")) ||
      (params.sensitivity !== undefined && params.sensitivity.length > 0 && !params.sensitivity.includes("normal")) ||
      params.locked === true || params.pinned === true;
    if (filtered)
      return { items: [], pageInfo: { nextCursor: null, hasNextPage: false, totalCount: 0 }, freshness, sources: [source] };
    const { total, events } = service.listWritten({
      identityIds: memoryIdentitiesFor(call), limit, offset,
      ...(params.q ? { q: params.q } : {}), ...(params.tag ? { channel: params.tag } : {}),
    });
    const items = events.map((event) => this.toMemory(event, syncedAt));
    const next = offset + items.length;
    const pageInfo = next < total
      ? { nextCursor: encodeCursor(next), hasNextPage: true, totalCount: total }
      : { nextCursor: null, hasNextPage: false, totalCount: total };
    return { items, pageInfo, freshness, sources: [source] };
  }

  async getMemory({ id }: IdParam, call: CallContext): Promise<Single<Memory>> {
    const { service, context } = this.ready();
    const eventId = this.resolve(id, call);
    const event = eventId ? service.getWritten(eventId) : null;
    if (!event || !memoryIdentitiesFor(call).includes(event.identityId ?? ""))
      throw new AdapterError({ code: "NOT_FOUND", message: "Gedächtniseintrag nicht gefunden.", retryable: false, details: { id } });
    const syncedAt = toIso(context.clock);
    return { data: this.toMemory(event, syncedAt), freshness: { state: "fresh", asOf: syncedAt } };
  }

  async deleteMemory({ id }: IdParam, call: MutationContext): Promise<ActionOutcome> {
    const { service } = this.ready();
    const eventId = this.resolve(id, call);
    const event = eventId ? service.getWritten(eventId) : null;
    if (!eventId || !event || !memoryIdentitiesFor(call).includes(event.identityId ?? ""))
      throw new AdapterError({ code: "NOT_FOUND", message: "Gedächtniseintrag nicht gefunden.", retryable: false, details: { id } });
    // Every derived memory is at version 1; anything else is a stale client view.
    if (call.ifMatchVersion !== undefined && call.ifMatchVersion !== 1)
      throw new AdapterError({ code: "CONFLICT", message: "Der Gedächtniseintrag hat eine andere Version.", retryable: false,
        details: { expectedVersion: call.ifMatchVersion, currentVersion: 1, id } });
    service.forget(eventId);
    this.ids.delete(id);
    return { accepted: true, status: "completed", correlationId: call.correlationId, resourceId: id,
      message: "Gedächtniseintrag vergessen; die Obsidian-Notiz wird entfernt." };
  }

  private ready(): { service: DurableMemoryService; context: AdapterContext } {
    if (!this.service || !this.context)
      throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "Der Adapter ist nicht aktiv.", retryable: false });
    return { service: this.service, context: this.context };
  }

  private resolve(id: string, call: CallContext): string | undefined {
    const cached = this.ids.get(id);
    if (cached) return cached;
    if (!/^mem_[0-9A-Za-z]{26}$/.test(id)) return undefined;
    const { service } = this.ready();
    for (const eventId of service.writtenEventIds(memoryIdentitiesFor(call))) {
      const memoryId = memoryIdOf(eventId);
      if (this.ids.size > 50_000) this.ids.clear();
      this.ids.set(memoryId, eventId);
      if (memoryId === id) return eventId;
    }
    return undefined;
  }

  private toMemory(event: IntegrationEvent, syncedAt: string): Memory {
    const id = memoryIdOf(event.eventId);
    if (this.ids.size > 50_000) this.ids.clear();
    this.ids.set(id, event.eventId);
    const at = Number.isFinite(Date.parse(event.occurredAt)) ? new Date(event.occurredAt).toISOString() : syncedAt;
    const content = contentOf(event);
    return {
      id, version: 1, createdAt: at, updatedAt: at,
      source: { ...sourceOf(syncedAt), externalId: event.eventId },
      type: "episode", title: titleOf(content), content, confidence: 1, confirmedAt: null, expiresAt: null,
      tags: [event.channel], entities: [], locked: false, pinned: false, sensitivity: "normal",
      provenance: { kind: "conversation", referenceId: event.eventId,
        description: `${KIND_LABEL[event.eventType]} · ${event.channel} (${event.source})` },
      usageCount: 0, lastUsedAt: null, conflicts: [], history: [],
    };
  }
}
