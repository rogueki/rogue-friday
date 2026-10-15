import type { FridayEvent } from "@friday/sdk";
import { CONTRACT_VERSION } from "@friday/sdk";
import type { MockWorld } from "../world/world";

export interface HubOptions {
  /** Ring buffer size (conventions §4: default 5 000). */
  bufferSize?: number;
}

export interface HubSubscribeOptions {
  /** Replay everything after this sequence (`?since=`). */
  since?: number;
}

export type HubListener = (event: FridayEvent) => void;

/**
 * Ring buffer and fan-out over a world's event bus. Events already carry id, sequence and time; the hub adds replay
 * (`?since=`), the `resync_required` fallback for too-old cursors and heartbeat frames.
 */
export class MockEventHub {
  private buffer: FridayEvent[] = [];
  private readonly listeners = new Set<HubListener>();
  private readonly size: number;
  private unsubscribe: (() => void) | null;

  constructor(
    private readonly world: MockWorld,
    options: HubOptions = {},
  ) {
    this.size = options.bufferSize ?? 5_000;
    this.unsubscribe = world.events.subscribe((event) => this.ingest(event));
  }

  get latestSequence(): number {
    return this.buffer[this.buffer.length - 1]?.sequence ?? 0;
  }

  get oldestSequence(): number | null {
    return this.buffer[0]?.sequence ?? null;
  }

  get bufferedCount(): number {
    return this.buffer.length;
  }

  /** Events after `since`, or `null` when the cursor is older than the buffer (resync needed). */
  replay(since: number): FridayEvent[] | null {
    const oldest = this.oldestSequence;
    if (oldest === null) return since > this.latestSequence ? null : [];
    if (since < oldest - 1) return null;
    return this.buffer.filter((event) => event.sequence > since);
  }

  subscribe(listener: HubListener, options: HubSubscribeOptions = {}): () => void {
    if (options.since !== undefined) {
      const missed = this.replay(options.since);
      if (missed === null) listener(this.resyncEvent(options.since));
      else for (const event of missed) listener(event);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Control frame (not an envelope, no sequence). */
  pingFrame(): string {
    return JSON.stringify({ kind: "ping", ts: this.world.clock.now() });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }

  private ingest(event: FridayEvent): void {
    if (event.type === "friday.status.resync_required") {
      // State was replaced wholesale: older events would mislead replaying clients.
      this.buffer = [];
    } else {
      this.buffer.push(event);
      if (this.buffer.length > this.size) this.buffer.splice(0, this.buffer.length - this.size);
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error("[mock-data] hub listener failed", error);
      }
    }
  }

  private resyncEvent(requestedSince: number): FridayEvent {
    return {
      specversion: "1.0",
      id: this.world.id("evt"),
      type: "friday.status.resync_required",
      source: "control-api://core",
      subject: "status/resync",
      time: this.world.nowIso(),
      sequence: this.latestSequence,
      correlationId: this.world.id("corr"),
      contractVersion: CONTRACT_VERSION,
      data: { reason: "sequence_too_old", requestedSince, oldestAvailableSequence: this.oldestSequence, latestSequence: this.latestSequence },
    } as FridayEvent;
  }
}
