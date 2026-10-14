import type {
  Memory,
  MemoryCreateRequest,
  MemoryHistoryEntry,
  MemorySearchHit,
  MemorySearchRequest,
  MemoryUpdateRequest,
  ActionResult,
} from "@jarvis/sdk";
import { CONTRACT_VERSION } from "@jarvis/sdk";
import { conflict, notFound } from "../../core/errors";
import { asBool, asList, clone, compareDesc, matchesQuery, normalizeText, tokenize, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { checkEnum, MEMORY_TYPES, pageOf, SENSITIVITIES, type Query } from "./shared";

export type MemoryListQuery = Query<"listMemory">;

function trigrams(text: string): Set<string> {
  const normalized = `  ${normalizeText(text)}  `;
  const out = new Set<string>();
  for (let i = 0; i < normalized.length - 2; i++) out.add(normalized.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

export class MemoryService {
  constructor(private readonly w: MockWorld) {}

  find(id: string): Memory {
    const memory = this.w.state.memory.find((candidate) => candidate.id === id);
    if (!memory) throw notFound("Memory", id);
    return memory;
  }

  isExpired(memory: Memory): boolean {
    return memory.expiresAt !== null && Date.parse(memory.expiresAt) <= this.w.nowMs();
  }

  list(query: MemoryListQuery = {}): Page<Memory> {
    return this.w.read("listMemory", () => {
      const types = asList(query.type);
      const sensitivities = asList(query.sensitivity);
      checkEnum("type", types, MEMORY_TYPES);
      checkEnum("sensitivity", sensitivities, SENSITIVITIES);
      const locked = asBool(query.locked);
      const pinned = asBool(query.pinned);
      const items = this.w.state.memory
        .filter((memory) => {
          if (types.length && !types.includes(memory.type)) return false;
          if (sensitivities.length && !sensitivities.includes(memory.sensitivity)) return false;
          if (query.tag && !memory.tags.includes(query.tag)) return false;
          if (locked !== undefined && memory.locked !== locked) return false;
          if (pinned !== undefined && memory.pinned !== pinned) return false;
          return matchesQuery(`${memory.title ?? ""} ${memory.content} ${memory.tags.join(" ")} ${memory.entities.map((entity) => entity.label).join(" ")}`, query.q);
        })
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || compareDesc(a.updatedAt, b.updatedAt) || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  get(id: string): Memory {
    return this.w.read("getMemory", () => clone(this.find(id)));
  }

  create(body: MemoryCreateRequest, ctx?: OpContext): Memory {
    return this.w.run("createMemory", ctx, body, () => {
      this.w.validate("MemoryCreateRequest", body);
      const now = this.w.nowIso();
      const actor = this.w.actorOf(ctx);
      const memory: Memory = {
        id: this.w.id("mem"),
        version: 1,
        createdAt: now,
        updatedAt: now,
        source: this.w.source("memory"),
        type: body.type,
        ...(body.title ? { title: body.title } : {}),
        content: body.content,
        confidence: body.confidence ?? 0.7,
        confirmedAt: null,
        expiresAt: body.expiresAt ?? null,
        tags: body.tags ?? [],
        entities: body.entities ?? [],
        locked: false,
        pinned: body.pinned ?? false,
        sensitivity: body.sensitivity ?? "normal",
        provenance: { kind: actor.type === "user" ? "manual" : "inference", description: actor.type === "user" ? "Über das Dashboard angelegt" : "Vom Agenten abgeleitet" },
        usageCount: 0,
        lastUsedAt: null,
        conflicts: [],
        history: [{ version: 1, changedAt: now, actor, change: "created", summary: "Eintrag angelegt.", before: null, after: body.content }],
      };
      this.w.state.memory.push(memory);
      this.publish("jarvis.memory.created", memory, ctx, "memory.created", null);
      return clone(memory);
    });
  }

  update(id: string, body: MemoryUpdateRequest, ctx?: OpContext): Memory {
    return this.w.run("updateMemory", ctx, { id, body }, () => {
      this.w.validate("MemoryUpdateRequest", body);
      const memory = this.find(id);
      this.w.assertVersion(memory, ctx, "Memory");
      const contentFields: (keyof MemoryUpdateRequest)[] = ["type", "content", "title", "confidence", "tags", "entities", "sensitivity", "expiresAt"];
      const touchesContent = contentFields.some((field) => body[field] !== undefined);
      if (memory.locked && touchesContent && body.locked !== false) {
        throw conflict("Dieser Eintrag ist gesperrt. Entsperren Sie ihn zuerst, um Inhalte zu ändern.", { locked: true });
      }
      const actor = this.w.actorOf(ctx);
      const now = this.w.nowIso();
      const before = memory.content;
      const history: MemoryHistoryEntry[] = [];
      const push = (change: MemoryHistoryEntry["change"], summary: string, from: string | null = null, to: string | null = null): void => {
        history.push({ version: memory.version + 1 + history.length, changedAt: now, actor, change, summary, before: from, after: to });
      };
      if (body.type !== undefined) memory.type = body.type;
      if (body.title !== undefined) memory.title = body.title;
      if (body.content !== undefined && body.content !== memory.content) {
        memory.content = body.content;
        push("updated", "Inhalt geändert.", before, body.content);
      }
      if (body.confidence !== undefined) memory.confidence = body.confidence;
      if (body.tags !== undefined) memory.tags = body.tags;
      if (body.entities !== undefined) memory.entities = body.entities;
      if (body.sensitivity !== undefined) memory.sensitivity = body.sensitivity;
      if (body.expiresAt !== undefined) memory.expiresAt = body.expiresAt;
      if (body.confirm) {
        memory.confirmedAt = now;
        push("confirmed", "Vom Benutzer bestätigt.");
      }
      if (body.locked !== undefined && body.locked !== memory.locked) {
        memory.locked = body.locked;
        push(body.locked ? "locked" : "unlocked", body.locked ? "Gegen automatische Änderungen gesperrt." : "Sperre aufgehoben.");
      }
      if (body.pinned !== undefined && body.pinned !== memory.pinned) {
        memory.pinned = body.pinned;
        push("pinned", body.pinned ? "Angeheftet." : "Anheftung entfernt.");
      }
      if (history.length === 0) push("updated", "Metadaten aktualisiert.");
      memory.history.push(...history);
      this.publish("jarvis.memory.updated", memory, ctx, "memory.updated", { content: before });
      return clone(memory);
    });
  }

  delete(id: string, ctx?: OpContext): ActionResult {
    return this.w.run("deleteMemory", ctx, { id }, () => {
      const memory = this.find(id);
      this.w.assertVersion(memory, ctx, "Memory");
      if (memory.locked) throw conflict("Gesperrte Einträge können nicht gelöscht werden.", { locked: true });
      const correlationId = this.w.correlationId(ctx);
      this.w.state.memory = this.w.state.memory.filter((candidate) => candidate.id !== id);
      for (const other of this.w.state.memory) {
        other.conflicts = other.conflicts.map((entry) => (entry.memoryId === id ? { ...entry, resolution: "replaced" as const } : entry));
      }
      this.w.emitFor("memory", "jarvis.memory.deleted", { id, deletedAt: this.w.nowIso(), deletedBy: this.w.actorOf(ctx) }, `memory/${id}`, correlationId);
      const audit = this.w.recordAudit({
        category: "user_action",
        action: "memory.deleted",
        correlationId,
        adapterId: "mock-memory",
        actor: this.w.actorOf(ctx),
        severity: memory.sensitivity === "normal" ? "info" : "warning",
        before: { type: memory.type, title: memory.title ?? null, sensitivity: memory.sensitivity },
        after: null,
      });
      return { contractVersion: CONTRACT_VERSION, accepted: true, status: "completed", correlationId, resourceId: id, auditEventId: audit.id, message: "Eintrag wurde vergessen. Die Löschung bleibt im Audit nachvollziehbar." };
    });
  }

  /** Token-overlap search (plus trigram similarity when `semantic` is set), highest score first. */
  search(request: MemorySearchRequest): MemorySearchHit[] {
    return this.w.read("searchMemory", () => {
      this.w.validate("MemorySearchRequest", request);
      const queryTokens = tokenize(request.query);
      const queryTrigrams = trigrams(request.query);
      const limit = request.limit ?? 20;
      const hits: MemorySearchHit[] = [];
      for (const memory of this.w.state.memory) {
        if (request.types?.length && !request.types.includes(memory.type)) continue;
        if (request.tags?.length && !request.tags.some((tag) => memory.tags.includes(tag))) continue;
        if (request.sensitivity?.length && !request.sensitivity.includes(memory.sensitivity)) continue;
        if (request.minConfidence !== undefined && memory.confidence < request.minConfidence) continue;
        if (!request.includeExpired && this.isExpired(memory)) continue;
        const title = tokenize(memory.title ?? "");
        const content = tokenize(memory.content);
        const tags = memory.tags.flatMap(tokenize);
        const entities = memory.entities.flatMap((entity) => tokenize(entity.label));
        let raw = 0;
        const highlights = new Set<string>();
        for (const token of queryTokens) {
          const inTitle = title.some((candidate) => candidate.startsWith(token));
          const inContent = content.some((candidate) => candidate.startsWith(token));
          const inTags = tags.some((candidate) => candidate.startsWith(token));
          const inEntities = entities.some((candidate) => candidate.startsWith(token));
          if (inTitle) raw += 3;
          if (inEntities) raw += 2;
          if (inTags) raw += 2;
          if (inContent) raw += 1;
          if (inTitle || inEntities || inTags || inContent) highlights.add(token);
        }
        let score = queryTokens.length ? raw / (queryTokens.length * 3) : 0;
        if (request.semantic) {
          const similarity = jaccard(queryTrigrams, trigrams(`${memory.title ?? ""} ${memory.content}`));
          score = Math.max(score, similarity * 1.4);
        }
        if (score <= 0) continue;
        score = Math.min(1, score * (0.75 + memory.confidence * 0.25));
        hits.push({ memory: clone(memory), score: Math.round(score * 1000) / 1000, ...(highlights.size ? { highlights: [...highlights] } : {}) });
      }
      hits.sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));
      const result = hits.slice(0, limit);
      for (const hit of result) {
        const live = this.find(hit.memory.id);
        live.usageCount += 1;
        live.lastUsedAt = this.w.nowIso();
      }
      return result;
    });
  }

  private publish(type: "jarvis.memory.created" | "jarvis.memory.updated", memory: Memory, ctx: OpContext | undefined, action: string, before: Record<string, unknown> | null): void {
    if (type === "jarvis.memory.updated") this.w.bump(memory);
    else memory.version = Math.max(memory.version, 1);
    // History versions follow the resource version so the timeline stays consistent.
    const correlationId = this.w.correlationId(ctx);
    this.w.emitFor("memory", type, memory, `memory/${memory.id}`, correlationId);
    this.w.logActivity({ kind: "system", title: `Memory ${type === "jarvis.memory.created" ? "angelegt" : "aktualisiert"}: ${memory.title ?? memory.type}`, correlationId, adapterId: "mock-memory", actor: this.w.actorOf(ctx) });
    this.w.recordAudit({
      category: ctx?.actor?.type === "agent" ? "agent_action" : "user_action",
      action,
      correlationId,
      adapterId: "mock-memory",
      actor: this.w.actorOf(ctx),
      severity: memory.sensitivity === "normal" ? "info" : "warning",
      before,
      after: { type: memory.type, locked: memory.locked, pinned: memory.pinned },
    });
  }
}
