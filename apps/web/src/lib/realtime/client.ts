import { isControlFrame, isJarvisEvent, type JarvisEvent, type ResyncRequired } from "@jarvis/sdk";
import { POLLING_AFTER_FAILURES, POLL_INTERVAL_MS, reconnectDelay } from "./backoff";
import type { RealtimeTransport, TransportCloseInfo, TransportFactory } from "./transport";

export type RealtimeState = "connecting" | "online" | "degraded" | "offline" | "polling";

export interface RealtimeSnapshot {
  state: RealtimeState;
  /** Last measured ping roundtrip in ms. */
  roundtripMs: number | null;
  /** Epoch ms of the last applied event. */
  lastEventAt: number | null;
  /** Last applied global sequence. */
  sequence: number | null;
  /** Consecutive failed connection attempts. */
  failures: number;
}

export interface SequenceGap {
  lastApplied: number;
  received: number;
}

export interface RealtimeCallbacks {
  /** Called exactly once per event (deduplicated, in arrival order). */
  onEvent: (event: JarvisEvent) => void;
  /** `sequence > last + 1`: events were missed; the owner backfills and/or refreshes snapshots. */
  onGap?: (gap: SequenceGap) => void;
  /** Server cannot replay `?since=`; snapshots must be reloaded. */
  onResync?: (data: ResyncRequired) => void;
  /** Polling fallback tick: refetch the key queries. */
  onPoll?: () => void;
  onStateChange?: (snapshot: RealtimeSnapshot) => void;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface RealtimeOptions {
  /** Builds the URL for the next connection attempt (`since` = last applied sequence). */
  getUrl: (since: number | null) => string;
  transportFactory: TransportFactory;
  callbacks: RealtimeCallbacks;
  /** sessionStorage by default; `null` disables persistence (tests, private mode). */
  storage?: StorageLike | null;
  storageKey?: string;
  random?: () => number;
  now?: () => number;
  pingIntervalMs?: number;
  /** A ping unanswered for this long marks the stream as degraded. */
  pongTimeoutMs?: number;
  /** No frame at all for this long: the connection is considered dead and replaced. */
  silenceTimeoutMs?: number;
  /** A connection counts as stable (backoff resets) after being open for this long. */
  stableAfterMs?: number;
  /** Roundtrips above this mark the stream as degraded. */
  slowRoundtripMs?: number;
}

export const DEFAULT_SEQUENCE_STORAGE_KEY = "jarvis.realtime.sequence";

function safeStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    // Access to sessionStorage throws in sandboxed iframes / blocked-cookie modes.
    return null;
  }
}

/**
 * Framework-free realtime client (PLAN §12.5, conventions §4): sequence persistence, `?since=` replay, deduplication,
 * gap detection, heartbeat/roundtrip, exponential reconnect with jitter, polling fallback, online/visibility awareness.
 * All I/O goes through the injected transport, so the same logic runs against WebSocket and the in-memory mock stream.
 */
export class RealtimeClient {
  private readonly options: Required<Pick<RealtimeOptions, "pingIntervalMs" | "pongTimeoutMs" | "silenceTimeoutMs" | "stableAfterMs" | "slowRoundtripMs">> &
    RealtimeOptions;
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly random: () => number;
  private readonly now: () => number;

  private transport: RealtimeTransport | null = null;
  private open = false;
  private started = false;
  private offline = false;
  private hidden = false;
  private degraded = false;
  private failures = 0;
  private sequence: number | null;
  private lastEventAt: number | null = null;
  private roundtripMs: number | null = null;
  private lastFrameAt = 0;
  private pendingPingAt: number | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;

  /** Counters for diagnostics (system page, tests). */
  readonly stats = { duplicates: 0, gaps: 0, malformed: 0, reconnects: 0 };

  constructor(options: RealtimeOptions) {
    this.options = {
      pingIntervalMs: 10_000,
      pongTimeoutMs: 5_000,
      silenceTimeoutMs: 45_000,
      stableAfterMs: 3_000,
      slowRoundtripMs: 1_500,
      ...options,
    };
    this.storage = options.storage === undefined ? safeStorage() : options.storage;
    this.storageKey = options.storageKey ?? DEFAULT_SEQUENCE_STORAGE_KEY;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.sequence = this.readPersistedSequence();
  }

  get callbacks(): RealtimeCallbacks {
    return this.options.callbacks;
  }

  snapshot(): RealtimeSnapshot {
    return {
      state: this.deriveState(),
      roundtripMs: this.roundtripMs,
      lastEventAt: this.lastEventAt,
      sequence: this.sequence,
      failures: this.failures,
    };
  }

  /** Last applied sequence (persisted), `null` before the first event. */
  getSequence(): number | null {
    return this.sequence;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.offline = false;
    this.connect();
  }

  stop(): void {
    this.started = false;
    this.clearTimers();
    this.closeTransport();
    this.open = false;
    this.degraded = false;
    this.publish();
  }

  /** `window` "online" event. */
  notifyOnline(): void {
    if (!this.started) return;
    this.offline = false;
    this.failures = 0;
    this.clearTimer("reconnect");
    this.connect();
  }

  /** `window` "offline" event: stop retrying until the browser reports connectivity again. */
  notifyOffline(): void {
    if (!this.started) return;
    this.offline = true;
    this.clearTimers();
    this.closeTransport();
    this.open = false;
    this.publish();
  }

  /** `document.visibilitychange`. Hidden tabs skip client pings; returning reconnects/pings immediately. */
  notifyVisibility(visible: boolean): void {
    this.hidden = !visible;
    if (!this.started || this.offline || !visible) return;
    if (this.open) this.sendPing();
    else if (this.transport === null) {
      this.clearTimer("reconnect");
      this.connect();
    }
  }

  /** Drops the sequence cursor, e.g. after the user logged out; the next connect starts without `?since=`. */
  resetSequence(): void {
    this.sequence = null;
    try {
      this.storage?.removeItem(this.storageKey);
    } catch {
      // Storage may be unavailable (private mode); the in-memory value is still reset.
    }
  }

  /** Test seam: feeds a raw message through the same path as the transport. */
  handleMessage(data: unknown): void {
    this.lastFrameAt = this.now();
    let payload = data;
    if (typeof data === "string") {
      try {
        payload = JSON.parse(data);
      } catch {
        this.stats.malformed += 1;
        return;
      }
    }
    if (isControlFrame(payload)) {
      this.handleControlFrame(payload);
      return;
    }
    if (!isJarvisEvent(payload)) {
      this.stats.malformed += 1;
      return;
    }
    this.handleEvent(payload);
  }

  // ── connection lifecycle ────────────────────────────────────────────────

  private connect(): void {
    if (!this.started || this.offline) return;
    this.closeTransport();
    const url = this.options.getUrl(this.sequence);
    const transport = this.options.transportFactory({ url, since: this.sequence });
    this.transport = transport;
    this.publish();
    transport.connect({
      onOpen: () => {
        if (this.transport !== transport) return;
        this.handleOpen();
      },
      onMessage: (data) => {
        if (this.transport !== transport) return;
        this.handleMessage(data);
      },
      onClose: (info) => {
        if (this.transport !== transport) return;
        this.handleClose(info);
      },
    });
  }

  private handleOpen(): void {
    this.open = true;
    this.degraded = false;
    this.lastFrameAt = this.now();
    this.pendingPingAt = null;
    this.clearTimer("poll");
    this.clearTimer("reconnect");
    this.clearTimer("stable");
    // Backoff only resets after the connection proved stable; otherwise a server that accepts and drops immediately would
    // be hammered with 0.5 s retries.
    this.stableTimer = setTimeout(() => {
      this.failures = 0;
      this.stableTimer = null;
      this.publish();
    }, this.options.stableAfterMs);
    this.pingTimer = setInterval(() => this.tick(), this.options.pingIntervalMs);
    this.publish();
    this.sendPing();
  }

  private handleClose(info: TransportCloseInfo): void {
    this.transport = null;
    this.open = false;
    this.clearTimer("ping");
    this.clearTimer("stable");
    this.pendingPingAt = null;
    this.degraded = false;
    if (info.clean || !this.started) {
      this.publish();
      return;
    }
    this.failures += 1;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.started || this.offline) {
      this.publish();
      return;
    }
    const delay = reconnectDelay(this.failures - 1, this.random);
    this.clearTimer("reconnect");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.stats.reconnects += 1;
      this.connect();
    }, delay);
    if (this.failures >= POLLING_AFTER_FAILURES) this.startPolling();
    this.publish();
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.options.callbacks.onPoll?.();
    this.pollTimer = setInterval(() => this.options.callbacks.onPoll?.(), POLL_INTERVAL_MS);
  }

  /** Periodic liveness work: client ping, pong timeout (degraded) and silence timeout (replace the connection). */
  private tick(): void {
    if (!this.open) return;
    const now = this.now();
    if (now - this.lastFrameAt > this.options.silenceTimeoutMs) {
      // A half-open socket never reports `close`; replace it ourselves.
      this.closeTransport();
      this.open = false;
      this.clearTimer("ping");
      this.failures += 1;
      this.scheduleReconnect();
      return;
    }
    if (this.pendingPingAt !== null && now - this.pendingPingAt > this.options.pongTimeoutMs && !this.degraded) {
      this.degraded = true;
      this.publish();
    }
    if (!this.hidden) this.sendPing();
  }

  private sendPing(): void {
    if (!this.open || !this.transport) return;
    const ts = this.now();
    if (this.pendingPingAt === null) this.pendingPingAt = ts;
    this.transport.send({ kind: "ping", ts });
  }

  private handleControlFrame(frame: { kind: "ping" | "pong"; ts: number }): void {
    if (frame.kind === "ping") {
      this.transport?.send({ kind: "pong", ts: frame.ts });
      return;
    }
    const roundtrip = Math.max(0, this.now() - frame.ts);
    this.roundtripMs = roundtrip;
    this.pendingPingAt = null;
    this.degraded = roundtrip > this.options.slowRoundtripMs;
    this.publish();
  }

  // ── events ──────────────────────────────────────────────────────────────

  private handleEvent(event: JarvisEvent): void {
    if (event.type === "jarvis.status.resync_required") {
      const data = event.data;
      this.options.callbacks.onResync?.(data);
      // The snapshot reload that follows covers everything up to `latestSequence`.
      this.setSequence(data.latestSequence);
      this.lastEventAt = this.now();
      this.publish();
      return;
    }
    const sequence = event.sequence;
    if (this.sequence !== null && sequence <= this.sequence) {
      this.stats.duplicates += 1;
      return;
    }
    if (this.sequence !== null && sequence > this.sequence + 1) {
      this.stats.gaps += 1;
      this.options.callbacks.onGap?.({ lastApplied: this.sequence, received: sequence });
    }
    this.setSequence(sequence);
    this.lastEventAt = this.now();
    this.options.callbacks.onEvent(event);
    this.publish();
  }

  private setSequence(sequence: number): void {
    this.sequence = sequence;
    try {
      this.storage?.setItem(this.storageKey, String(sequence));
    } catch {
      // Quota exceeded or storage disabled: the cursor stays in memory only.
    }
  }

  private readPersistedSequence(): number | null {
    try {
      const raw = this.storage?.getItem(this.storageKey);
      if (raw === null || raw === undefined) return null;
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private deriveState(): RealtimeState {
    if (!this.started || this.offline) return "offline";
    if (this.open) return this.degraded ? "degraded" : "online";
    return this.failures >= POLLING_AFTER_FAILURES ? "polling" : "connecting";
  }

  private publish(): void {
    this.options.callbacks.onStateChange?.(this.snapshot());
  }

  private closeTransport(): void {
    const transport = this.transport;
    this.transport = null;
    transport?.close();
  }

  private clearTimer(kind: "reconnect" | "ping" | "poll" | "stable"): void {
    if (kind === "reconnect" && this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    } else if (kind === "stable" && this.stableTimer !== null) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    } else if (kind === "ping" && this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    } else if (kind === "poll" && this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearTimer("reconnect");
    this.clearTimer("ping");
    this.clearTimer("poll");
    this.clearTimer("stable");
  }
}
