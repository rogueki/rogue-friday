import { CONTRACT_VERSION, type FridayEvent, type FridayEventMap, type FridayEventType } from "@friday/sdk";
import type { EmitOptions, WorldEventListener } from "./types";

export interface EventBusDeps {
  nextId: () => string;
  nextCorrelationId: () => string;
  nextSequence: () => number;
  nowIso: () => string;
}

/**
 * In-process event source. Events leave it as complete CloudEvents-style envelopes (id, sequence, time), so a hub
 * only has to buffer and fan them out. Sequences are strictly increasing even across world resets.
 */
export class WorldEventBus {
  private readonly listeners = new Set<WorldEventListener>();
  private lastEventAt: string | null = null;
  private lastEventId: string | null = null;

  constructor(private readonly deps: EventBusDeps) {}

  subscribe(listener: WorldEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  get lastAt(): string | null {
    return this.lastEventAt;
  }

  get lastId(): string | null {
    return this.lastEventId;
  }

  emit<K extends FridayEventType>(type: K, data: FridayEventMap[K], options: EmitOptions): FridayEvent<K> {
    const event = {
      specversion: "1.0" as const,
      id: this.deps.nextId(),
      type,
      source: options.source,
      subject: options.subject,
      time: this.deps.nowIso(),
      sequence: this.deps.nextSequence(),
      correlationId: options.correlationId ?? this.deps.nextCorrelationId(),
      ...(options.causationId ? { causationId: options.causationId } : {}),
      contractVersion: CONTRACT_VERSION,
      data,
    } as unknown as FridayEvent<K>;
    this.lastEventAt = event.time;
    this.lastEventId = event.id;
    this.dispatch(event as unknown as FridayEvent);
    return event;
  }

  /** Re-publishes an already built envelope (used for raw dev events); the sequence is still assigned here. */
  private dispatch(event: FridayEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        // A faulty subscriber must never break the world; surface it for debugging.
        console.error("[mock-data] event listener failed", error);
      }
    }
  }
}
