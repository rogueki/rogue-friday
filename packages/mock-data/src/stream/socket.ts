import type { TimerHandle } from "../core/clock";
import type { MockWorld } from "../world/world";
import { MockEventHub, type HubOptions } from "./hub";

type Listener = (event: unknown) => void;

export const EVENTS_PATH = "/api/v1/events";
const PING_INTERVAL_MS = 15_000;

function createMessageEvent(data: string): unknown {
  return typeof MessageEvent === "function" ? new MessageEvent("message", { data }) : { type: "message", data };
}

/**
 * Browser-side fake of the event WebSocket. Speaks the production protocol: JSON envelopes with a global sequence,
 * `?since=` replay, `resync_required`, and `{kind:"ping"}` / `{kind:"pong"}` frames every 15 s (mock clock).
 * Implements the subset of the WebSocket API that the web client uses.
 */
export class MockEventSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  binaryType: "blob" | "arraybuffer" = "blob";
  bufferedAmount = 0;
  onopen: Listener | null = null;
  onmessage: Listener | null = null;
  onclose: Listener | null = null;
  onerror: Listener | null = null;

  private readonly listeners = new Map<string, Set<Listener>>();
  private unsubscribe: (() => void) | null = null;
  private pingTimer: TimerHandle | null = null;

  constructor(
    private readonly world: MockWorld,
    private readonly hub: MockEventHub,
    url: string,
  ) {
    this.url = url;
    queueMicrotask(() => this.open());
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Client frames: `pong` answers our ping; `ping` is answered with a pong carrying the same timestamp. */
  send(data: string): void {
    if (this.readyState !== MockEventSocket.OPEN) throw new Error("MockEventSocket is not open");
    try {
      const frame = JSON.parse(data) as { kind?: string; ts?: number };
      if (frame.kind === "ping") this.deliver(JSON.stringify({ kind: "pong", ts: frame.ts ?? this.world.clock.now() }));
    } catch {
      // Ignore frames that are not JSON, like the real server.
    }
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === MockEventSocket.CLOSED) return;
    this.readyState = MockEventSocket.CLOSING;
    this.teardown();
    this.readyState = MockEventSocket.CLOSED;
    this.dispatch("close", { type: "close", code, reason, wasClean: true });
  }

  private open(): void {
    if (this.readyState !== MockEventSocket.CONNECTING) return;
    this.readyState = MockEventSocket.OPEN;
    this.dispatch("open", { type: "open" });
    const since = new URL(this.url, "http://localhost").searchParams.get("since");
    this.unsubscribe = this.hub.subscribe((event) => this.deliver(JSON.stringify(event)), since !== null && since !== "" ? { since: Number(since) } : {});
    this.pingTimer = this.world.clock.setInterval(() => {
      if (this.readyState === MockEventSocket.OPEN) this.deliver(this.hub.pingFrame());
    }, PING_INTERVAL_MS);
  }

  private deliver(payload: string): void {
    if (this.readyState !== MockEventSocket.OPEN) return;
    this.dispatch("message", createMessageEvent(payload));
  }

  private teardown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pingTimer?.cancel();
    this.pingTimer = null;
  }

  private dispatch(type: "open" | "message" | "close" | "error", event: unknown): void {
    const handler = (this as unknown as Record<string, Listener | null>)[`on${type}`];
    handler?.(event);
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

export interface MockEventSourceHandle {
  hub: MockEventHub;
  /** Constructor with the WebSocket call signature; use it directly or via `install()`. */
  WebSocketImpl: new (url: string | URL, protocols?: string | string[]) => MockEventSocket;
  connect(url?: string): MockEventSocket;
  /** Replaces `globalThis.WebSocket` for event-stream URLs; other URLs go to the native implementation. */
  install(target?: { WebSocket?: unknown }): () => void;
  dispose(): void;
}

export interface MockEventSourceOptions extends HubOptions {
  hub?: MockEventHub;
}

export function createMockEventSource(world: MockWorld, options: MockEventSourceOptions = {}): MockEventSourceHandle {
  const hub = options.hub ?? new MockEventHub(world, options);
  const ownsHub = !options.hub;
  class WebSocketImpl extends MockEventSocket {
    constructor(url: string | URL) {
      super(world, hub, String(url));
    }
  }
  return {
    hub,
    WebSocketImpl,
    connect: (url = `ws://localhost${EVENTS_PATH}`) => new WebSocketImpl(url),
    install(target = globalThis as { WebSocket?: unknown }) {
      const Native = target.WebSocket as (new (url: string | URL, protocols?: string | string[]) => unknown) | undefined;
      const Patched = function (this: unknown, url: string | URL, protocols?: string | string[]) {
        if (String(url).includes(EVENTS_PATH) || !Native) return new WebSocketImpl(url);
        return new Native(url, protocols);
      } as unknown as typeof WebSocket;
      Object.assign(Patched, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      target.WebSocket = Patched;
      return () => {
        target.WebSocket = Native;
      };
    },
    dispose() {
      if (ownsHub) hub.dispose();
    },
  };
}
