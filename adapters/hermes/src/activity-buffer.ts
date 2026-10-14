import type { ActivityEvent } from "@jarvis/sdk";
import { AdapterError, defineMapper, type ListActivityParams, type MapContext } from "@jarvis/adapter-core";
import type { ActivityDraft } from "./activity-mapping";

const validator = defineMapper<ActivityEvent, ActivityEvent>({
  name: "Hermes Aktivität -> ActivityEvent",
  schema: "ActivityEvent",
  toCanonical: (event) => event,
});

export interface UpsertResult {
  event: ActivityEvent;
  /** `true` when the id was not in the buffer yet. */
  created: boolean;
}

const sortKey = (event: ActivityEvent): [number, number] => [Date.parse(event.occurredAt), event.sequence];

function parseCursor(cursor: string): [number, number] {
  const match = /^(\d+):(\d+)$/.exec(cursor);
  if (!match) {
    throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungültiger Cursor.", retryable: false });
  }
  return [Number(match[1]), Number(match[2])];
}

/**
 * In-memory ring buffer of the activity stream. Hermes has no activity feed, so the adapter assembles one from Kanban
 * events and session messages. `sequence` is adapter-local (assigned on first sight, monotonic per process); the hub
 * assigns its own global sequence to emitted events. Items are ordered newest first by (occurredAt, sequence).
 */
export class ActivityBuffer {
  private readonly events = new Map<string, ActivityEvent>();
  private sequence = 0;

  constructor(private readonly capacity: number) {}

  /** Inserts a new event or silently refreshes an existing one (e.g. a tool call whose result arrived later). */
  upsert(draft: ActivityDraft, context: MapContext): UpsertResult {
    const existing = this.events.get(draft.id);
    if (existing) {
      const { sequence, version, ...previous } = existing;
      const { version: _draftVersion, ...next } = draft;
      if (JSON.stringify(previous) === JSON.stringify(next)) return { event: existing, created: false };
      const updated = validator.map({ ...draft, version: version + 1, sequence }, context);
      this.events.set(updated.id, updated);
      return { event: updated, created: false };
    }
    this.sequence += 1;
    const created = validator.map({ ...draft, sequence: this.sequence }, context);
    this.events.set(created.id, created);
    this.evict();
    return { event: created, created: true };
  }

  /** Validates a draft against the contract without storing it (call before mutating anything). */
  validate(draft: ActivityDraft, context: MapContext): void {
    validator.map({ ...draft, sequence: 0 }, context);
  }

  get(id: string): ActivityEvent | undefined {
    return this.events.get(id);
  }

  get size(): number {
    return this.events.size;
  }

  /** Highest adapter-local sequence handed out so far. */
  get lastSequence(): number {
    return this.sequence;
  }

  query(params: ListActivityParams, limit: number): { items: ActivityEvent[]; nextCursor: string | null } {
    let items = [...this.events.values()].filter((event) => matches(event, params));
    if (params.sinceSequence !== undefined) {
      // Backfill walks forward in sequence order so that a client can resume from the last item it saw.
      const since = params.sinceSequence;
      items = items.filter((event) => event.sequence > since).sort((a, b) => a.sequence - b.sequence);
      const offset = params.cursor ? Number(parseCursorSequence(params.cursor)) : 0;
      const page = items.slice(offset, offset + limit);
      const next = offset + limit < items.length ? `s${offset + limit}` : null;
      return { items: page, nextCursor: next };
    }
    items.sort((a, b) => {
      const [at, as] = sortKey(a);
      const [bt, bs] = sortKey(b);
      return bt - at || bs - as;
    });
    if (params.cursor) {
      const [time, seq] = parseCursor(params.cursor);
      items = items.filter((event) => {
        const [at, as] = sortKey(event);
        return at < time || (at === time && as < seq);
      });
    }
    const page = items.slice(0, limit);
    const last = page.at(-1);
    const more = items.length > limit && last !== undefined;
    return {
      items: page,
      nextCursor: more && last ? `${Date.parse(last.occurredAt)}:${last.sequence}` : null,
    };
  }

  private evict(): void {
    if (this.events.size <= this.capacity) return;
    const oldest = [...this.events.values()].sort((a, b) => {
      const [at, as] = sortKey(a);
      const [bt, bs] = sortKey(b);
      return at - bt || as - bs;
    });
    for (const event of oldest.slice(0, this.events.size - this.capacity)) this.events.delete(event.id);
  }
}

function parseCursorSequence(cursor: string): number {
  const match = /^s(\d+)$/.exec(cursor);
  if (!match) {
    throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungültiger Cursor.", retryable: false });
  }
  return Number(match[1]);
}

function matches(event: ActivityEvent, params: ListActivityParams): boolean {
  if (params.kind && params.kind.length > 0 && !params.kind.includes(event.kind)) return false;
  if (params.severity && params.severity.length > 0 && !params.severity.includes(event.severity))
    return false;
  if (params.agentId !== undefined && event.agentId !== params.agentId) return false;
  if (params.taskId !== undefined && event.taskId !== params.taskId) return false;
  if (params.tool !== undefined && event.tool !== params.tool) return false;
  if (params.adapterId !== undefined && event.adapterId !== params.adapterId) return false;
  if (params.model !== undefined && event.model !== params.model) return false;
  if (params.status !== undefined && event.status !== params.status) return false;
  if (params.correlationId !== undefined && event.correlationId !== params.correlationId) return false;
  if (params.parentId !== undefined && event.parentId !== params.parentId) return false;
  if (params.from !== undefined && Date.parse(event.occurredAt) < Date.parse(params.from)) return false;
  if (params.to !== undefined && Date.parse(event.occurredAt) > Date.parse(params.to)) return false;
  return true;
}
