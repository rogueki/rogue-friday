import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CONTRACT_VERSION,
  FRIDAY_EVENT_DATA_SCHEMA_IDS,
  isFridayEventType,
  type FridayEvent,
  type FridayEventEnvelope,
  type FridayEventMap,
  type FridayEventType,
  type SchemaValidator,
} from "@friday/sdk";
import { getCorrelationId, type FridayMetrics, type Logger } from "@friday/observability";
import { createCorrelationId } from "@friday/observability";
import { newEventId } from "../util/ids";

export const EVENTS_PATH = "/api/v1/events";

const CORRELATION_ID = /^corr_[0-9A-Za-z]{26}$/;
const EVENT_ID = /^evt_[0-9A-Za-z]{26}$/;
/** A client whose socket buffer exceeds this is too slow: it is dropped and must resync. */
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

/** What producers hand to the hub; id, sequence, time and contract version are assigned here. */
export interface HubEventInput<K extends FridayEventType = FridayEventType> {
  type: K;
  subject: string;
  data: FridayEventMap[K];
  correlationId?: string | undefined;
  causationId?: string | undefined;
}

export interface HubPrincipal {
  userId: string;
  role: string;
  sessionIdHash: string;
}

export interface HubOptions {
  logger: Logger;
  metrics: FridayMetrics;
  validator: SchemaValidator;
  ringBufferSize: number;
  heartbeatMs: number;
  /** Last sequence handed out by a previous run; new sequences continue above it so cursors never go backwards. */
  startSequence: number;
  /** Persists the sequence high-water mark (called every few events and on close). */
  persistSequence?: (sequence: number) => void;
  /** Throw on a payload that violates its schema (tests); production logs and drops the event. */
  strict?: boolean;
  now?: () => number;
}

interface Client {
  socket: WebSocket;
  principal: HubPrincipal;
  alive: boolean;
  lastSeen: number;
  connectedAt: number;
}

export interface HubStats {
  clients: number;
  latestSequence: number;
  oldestSequence: number | null;
  buffered: number;
  published: number;
  dropped: number;
}

export type UpgradeAuthenticator = (request: IncomingMessage) => HubPrincipal | null;
export type OriginGuard = (request: IncomingMessage) => boolean;

/**
 * Realtime hub (PLAN §12, conventions §4): wraps adapter and core events into CloudEvents-style envelopes with a global
 * monotonic sequence, keeps a replay ring buffer and fans out to WebSocket clients on `GET /api/v1/events`.
 */
export class EventHub {
  private sequence: number;
  private ring: FridayEvent[] = [];
  private readonly clients = new Set<Client>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private heartbeat: NodeJS.Timeout | undefined;
  private attached: { server: Server; onUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void } | undefined;
  private published = 0;
  private dropped = 0;
  private sinceLastPersist = 0;
  private lastAt: string | null = null;
  private readonly listeners = new Set<(event: FridayEvent) => void>();
  private readonly now: () => number;

  constructor(private readonly options: HubOptions) {
    this.sequence = options.startSequence;
    this.now = options.now ?? Date.now;
  }

  // ---- publishing -----------------------------------------------------------------------------------------------

  /** Validates, sequences, buffers and broadcasts. Returns the envelope, or null when the payload was rejected. */
  publish<K extends FridayEventType>(source: string, input: HubEventInput<K>): FridayEvent<K> | null {
    const { type } = input;
    if (!isFridayEventType(type)) {
      this.reject(`Unbekannter Ereignistyp ${String(type)}`, source, type);
      return null;
    }
    const schemaId = FRIDAY_EVENT_DATA_SCHEMA_IDS[type];
    const check = this.options.validator.validate(schemaId, input.data);
    if (!check.valid) {
      this.reject(`Ereignisdaten verletzen ${schemaId}`, source, type, check.errors.slice(0, 5));
      return null;
    }
    if (!/^(adapter|control-api):\/\/[a-z0-9-]+$/.test(source)) {
      this.reject(`Ungültige Ereignisquelle ${source}`, source, type);
      return null;
    }

    const correlationId =
      input.correlationId && CORRELATION_ID.test(input.correlationId)
        ? input.correlationId
        : (getCorrelationId() && CORRELATION_ID.test(getCorrelationId() as string) ? (getCorrelationId() as string) : createCorrelationId());
    const envelope = {
      specversion: "1.0" as const,
      id: newEventId(),
      type,
      source,
      subject: input.subject,
      time: new Date(this.now()).toISOString(),
      sequence: ++this.sequence,
      correlationId,
      ...(input.causationId && EVENT_ID.test(input.causationId) ? { causationId: input.causationId } : {}),
      contractVersion: CONTRACT_VERSION,
      data: input.data,
    } as unknown as FridayEvent<K>;

    if (type === "friday.status.resync_required") {
      // State was replaced wholesale: events before this point must not be replayed to anyone.
      this.ring = [];
    }
    this.ring.push(envelope as unknown as FridayEvent);
    if (this.ring.length > this.options.ringBufferSize) this.ring.splice(0, this.ring.length - this.options.ringBufferSize);
    this.published += 1;
    this.lastAt = envelope.time;
    this.options.metrics.recordEvent(type);
    this.persistIfDue();

    const frame = JSON.stringify(envelope);
    for (const client of [...this.clients]) this.send(client, frame);
    for (const listener of [...this.listeners]) {
      try {
        listener(envelope as unknown as FridayEvent);
      } catch (error) {
        this.options.logger.error("Hub-Listener hat einen Fehler geworfen", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return envelope;
  }

  /** In-process subscription (orb/status tracker, metrics). */
  subscribe(listener: (event: FridayEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private reject(message: string, source: string, type: unknown, issues?: unknown): void {
    this.dropped += 1;
    this.options.logger.error(`Ereignis verworfen: ${message}`, { source, type: String(type), issues });
    if (this.options.strict) throw new Error(`Ereignis verworfen: ${message} (${String(type)} von ${source})`);
  }

  private persistIfDue(): void {
    this.sinceLastPersist += 1;
    if (this.sinceLastPersist >= 50) {
      this.sinceLastPersist = 0;
      this.options.persistSequence?.(this.sequence);
    }
  }

  // ---- replay ---------------------------------------------------------------------------------------------------

  get lastEventAt(): string | null {
    return this.lastAt;
  }

  get latestSequence(): number {
    return this.sequence;
  }

  /**
   * Raises the sequence counter so the next published event is numbered above `floor`. Used when a producer (the mock
   * world) already numbered content, e.g. seeded activity items, that must stay below every live event. Never lowers it.
   */
  ensureSequenceAtLeast(floor: number): void {
    if (floor <= this.sequence) return;
    this.sequence = floor;
    this.options.persistSequence?.(this.sequence);
  }

  get oldestSequence(): number | null {
    return this.ring[0]?.sequence ?? null;
  }

  /** Events after `since`, or null when the cursor is outside the buffer (client must reload its snapshots). */
  replay(since: number): FridayEvent[] | null {
    if (since > this.sequence) return null; // client is from a different run
    const oldest = this.oldestSequence;
    if (oldest === null) return since === this.sequence ? [] : null;
    if (since < oldest - 1) return null;
    return this.ring.filter((event) => event.sequence > since);
  }

  private resyncEnvelope(requestedSince: number | null, reason: "sequence_too_old" | "buffer_overflow" | "server_restart"): FridayEvent {
    // Per-client frame: reuses the head sequence instead of burning a number that other clients would see as a gap.
    return {
      specversion: "1.0",
      id: newEventId(),
      type: "friday.status.resync_required",
      source: "control-api://core",
      subject: "status/resync",
      time: new Date(this.now()).toISOString(),
      sequence: this.sequence,
      correlationId: createCorrelationId(),
      contractVersion: CONTRACT_VERSION,
      data: { reason, requestedSince, oldestAvailableSequence: this.oldestSequence, latestSequence: this.sequence },
    } as unknown as FridayEvent;
  }

  // ---- WebSocket ------------------------------------------------------------------------------------------------

  attach(server: Server, guards: { authenticate: UpgradeAuthenticator; originAllowed: OriginGuard; hostAllowed: OriginGuard }): void {
    const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== EVENTS_PATH) {
        socket.destroy(); // no other upgrade endpoints exist
        return;
      }
      const reject = (status: number, reason: string): void => {
        socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        socket.destroy();
      };
      if (!guards.hostAllowed(request)) return reject(403, "Forbidden");
      if (!guards.originAllowed(request)) return reject(403, "Forbidden");
      const principal = guards.authenticate(request);
      if (!principal) return reject(401, "Unauthorized");
      this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws, principal, url));
    };
    server.on("upgrade", onUpgrade);
    this.attached = { server, onUpgrade };
    this.startHeartbeat();
  }

  private accept(socket: WebSocket, principal: HubPrincipal, url: URL): void {
    const client: Client = { socket, principal, alive: true, lastSeen: this.now(), connectedAt: this.now() };
    this.clients.add(client);
    this.options.metrics.wsConnections.set(this.clients.size);

    socket.on("message", (raw) => {
      client.alive = true;
      client.lastSeen = this.now();
      const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : Array.isArray(raw) ? Buffer.concat(raw).toString("utf8") : Buffer.from(raw).toString("utf8");
      try {
        const frame = JSON.parse(text) as { kind?: unknown; ts?: unknown };
        if (frame.kind === "ping" && typeof frame.ts === "number") socket.send(JSON.stringify({ kind: "pong", ts: frame.ts }));
        // `pong` only refreshes liveness (done above); anything else is ignored.
      } catch {
        // Non-JSON frames are ignored, like unknown control frames.
      }
    });
    socket.on("close", () => this.drop(client));
    socket.on("error", () => this.drop(client));

    const sinceParam = url.searchParams.get("since");
    if (sinceParam !== null && sinceParam !== "") {
      const since = Number(sinceParam);
      if (!Number.isInteger(since) || since < 0) {
        socket.close(1008, "since must be a non-negative integer");
        return;
      }
      const missed = this.replay(since);
      if (missed === null) {
        const reason = since > this.sequence ? "server_restart" : "sequence_too_old";
        this.send(client, JSON.stringify(this.resyncEnvelope(since, reason)));
      } else {
        for (const event of missed) this.send(client, JSON.stringify(event));
      }
    }
  }

  private send(client: Client, frame: string): void {
    const { socket } = client;
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      // Backpressure: a slow consumer must not grow our memory. It reconnects and replays or resyncs.
      this.options.logger.warn("WebSocket-Client zu langsam; Verbindung wird beendet", {
        buffered: socket.bufferedAmount,
        userId: client.principal.userId,
      });
      try {
        socket.send(JSON.stringify(this.resyncEnvelope(null, "buffer_overflow")));
      } catch {
        // socket already unusable
      }
      socket.close(1013, "slow consumer");
      this.drop(client);
      return;
    }
    socket.send(frame, (error) => {
      if (error) this.drop(client);
    });
  }

  private drop(client: Client): void {
    if (this.clients.delete(client)) this.options.metrics.wsConnections.set(this.clients.size);
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const ts = this.now();
      const frame = JSON.stringify({ kind: "ping", ts });
      for (const client of [...this.clients]) {
        // No frame since the previous ping: the peer is gone (half-open TCP, sleeping laptop).
        if (!client.alive) {
          client.socket.terminate();
          this.drop(client);
          continue;
        }
        client.alive = false;
        try {
          client.socket.send(frame);
        } catch {
          this.drop(client);
        }
      }
    }, this.options.heartbeatMs);
    this.heartbeat.unref?.();
  }

  /** Closes the sockets of a revoked session ("logout all"). */
  closeSession(sessionIdHash: string): number {
    let closed = 0;
    for (const client of [...this.clients]) {
      if (client.principal.sessionIdHash !== sessionIdHash) continue;
      client.socket.close(4401, "session ended");
      this.drop(client);
      closed += 1;
    }
    return closed;
  }

  closeUser(userId: string): number {
    let closed = 0;
    for (const client of [...this.clients]) {
      if (client.principal.userId !== userId) continue;
      client.socket.close(4401, "session ended");
      this.drop(client);
      closed += 1;
    }
    return closed;
  }

  stats(): HubStats {
    return {
      clients: this.clients.size,
      latestSequence: this.sequence,
      oldestSequence: this.oldestSequence,
      buffered: this.ring.length,
      published: this.published,
      dropped: this.dropped,
    };
  }

  /**
   * Sends every client a "going away" close frame and waits briefly for the handshake, then terminates stragglers.
   * Must run before the HTTP server closes: upgraded sockets keep `server.close()` pending until they are gone.
   */
  async disconnectAll(graceMs = 1_000): Promise<void> {
    const sockets = [...this.clients].map((client) => client.socket);
    this.clients.clear();
    this.options.metrics.wsConnections.set(0);
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.readyState === socket.CLOSED) return resolve();
            const timer = setTimeout(() => {
              socket.terminate();
              resolve();
            }, graceMs);
            timer.unref?.();
            socket.once("close", () => {
              clearTimeout(timer);
              resolve();
            });
            if (socket.readyState === socket.OPEN) socket.close(1001, "server shutting down");
          }),
      ),
    );
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    if (this.attached) this.attached.server.off("upgrade", this.attached.onUpgrade);
    this.attached = undefined;
    this.options.persistSequence?.(this.sequence);
    for (const client of [...this.clients]) client.socket.close(1001, "server shutting down");
    this.clients.clear();
    this.options.metrics.wsConnections.set(0);
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

export type { FridayEventEnvelope };
