import { AdapterError, normalizeError } from "@friday/adapter-core";
import type { AuthedClient } from "./clients";
import { parseBoard, parseEventBatch, type WireEvent } from "./wire";

export interface KanbanDrainRequest {
  /** Dashboard base URL (http/https). */
  baseUrl: string;
  board: string;
  /** Events with `id > since` are wanted. */
  since: number;
  /** Dashboard session token. Part of the request URL for the WebSocket: never log the URL. */
  token: string;
  /** Max wait for the first message after connecting. */
  waitMs: number;
  /** Max silence after a message before the cycle ends. */
  idleMs: number;
  signal: AbortSignal;
}

export interface KanbanDrainResult {
  events: WireEvent[];
  cursor: number | null;
}

/**
 * Transport of the Kanban event stream. Production: `WebSocketKanbanTransport`
 * (`/api/plugins/kanban/events?board=&since=&token=`). Tests may inject an HTTP-backed double.
 */
export interface KanbanEventTransport {
  drain(request: KanbanDrainRequest): Promise<KanbanDrainResult>;
}

const wsError = (message: string, code: AdapterError["code"], phase: "connect" | "stream"): AdapterError =>
  new AdapterError({ code, message, retryable: code === "ADAPTER_UNAVAILABLE", details: { phase } });

/**
 * Connects, collects everything the server pushes until it goes quiet, then closes. The server replays events
 * `id > since` right after the first poll tick (0.3 s) and then pushes new ones; one cycle is a bounded drain.
 */
export class WebSocketKanbanTransport implements KanbanEventTransport {
  drain(request: KanbanDrainRequest): Promise<KanbanDrainResult> {
    const url = new URL("/api/plugins/kanban/events", request.baseUrl.replace(/^http/, "ws"));
    url.searchParams.set("board", request.board);
    url.searchParams.set("since", String(request.since));
    url.searchParams.set("token", request.token);

    return new Promise<KanbanDrainResult>((resolve, reject) => {
      if (request.signal.aborted) {
        reject(wsError("Event-Stream abgebrochen.", "ADAPTER_UNAVAILABLE", "connect"));
        return;
      }
      const events: WireEvent[] = [];
      let cursor: number | null = null;
      let opened = false;
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const socket = new WebSocket(url.toString());

      const finish = (error?: AdapterError): void => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try {
          socket.close(1000);
        } catch {
          // already closed; nothing left to release
        }
        if (error) reject(error);
        else resolve({ events, cursor });
      };
      const arm = (ms: number): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => finish(), ms);
      };
      const onAbort = (): void =>
        finish(wsError("Event-Stream abgebrochen.", "ADAPTER_UNAVAILABLE", opened ? "stream" : "connect"));
      request.signal.addEventListener("abort", onAbort, { once: true });

      socket.onopen = () => {
        opened = true;
        arm(request.waitMs);
      };
      socket.onmessage = (message) => {
        try {
          const batch = parseEventBatch(JSON.parse(String(message.data)));
          events.push(...batch.events);
          if (batch.cursor !== null) cursor = batch.cursor;
        } catch (error) {
          finish(normalizeError(error, { operation: "Kanban-Ereignisstrom" }));
          return;
        }
        arm(request.idleMs);
      };
      socket.onerror = () =>
        finish(
          wsError(
            "Der Hermes-Ereignisstrom ist nicht erreichbar.",
            "ADAPTER_UNAVAILABLE",
            opened ? "stream" : "connect",
          ),
        );
      socket.onclose = (event) => {
        if (finished) return;
        if (event.code === 1008) {
          finish(wsError("Der Hermes-Ereignisstrom hat das Token abgelehnt.", "UNAUTHENTICATED", "stream"));
        } else if (opened && (event.code === 1000 || event.code === 1001 || event.code === 1005)) {
          finish();
        } else {
          finish(
            wsError(
              "Der Hermes-Ereignisstrom wurde unerwartet beendet.",
              "ADAPTER_UNAVAILABLE",
              opened ? "stream" : "connect",
            ),
          );
        }
      };
    });
  }
}

export interface FeedBatch {
  board: string;
  events: WireEvent[];
  /** Cursor to store once the batch has been fully processed. */
  cursor: number;
  /** Events with `id <= historicUpTo` predate the adapter start (history look-back): buffer them, do not emit. */
  historicUpTo: number;
}

export interface KanbanFeedOptions {
  dashboard: AuthedClient;
  transport: KanbanEventTransport;
  boards: readonly string[];
  startCursor: "tail" | number;
  drainMs: number;
  /** Tail mode only: how many events before the tail are read as history. */
  historyDepth: number;
  signal: AbortSignal;
}

/**
 * Per-board event cursors over the Kanban event stream. `fetch()` never advances the cursors: callers map and emit
 * first and call `commit()` afterwards, so a failure in between loses nothing and a repeated cycle duplicates nothing.
 */
export class KanbanEventFeed {
  private readonly cursors = new Map<string, number>();
  private readonly tails = new Map<string, number>();
  private priming: Promise<void> | undefined;

  constructor(private readonly options: KanbanFeedOptions) {}

  /** Resolves the start cursor per board: a fixed id, or the board's current tail (`latest_event_id`). */
  private prime(): Promise<void> {
    const { startCursor, boards, dashboard } = this.options;
    if (startCursor !== "tail") {
      for (const board of boards) if (!this.cursors.has(board)) this.cursors.set(board, startCursor);
      return Promise.resolve();
    }
    this.priming ??= (async () => {
      for (const board of boards) {
        if (this.cursors.has(board)) continue;
        const response = await dashboard.request({
          method: "GET",
          path: "/api/plugins/kanban/board",
          query: { board },
          operation: "pollEvents",
          signal: this.options.signal,
        });
        const tail = parseBoard(response.body).latestEventId;
        this.tails.set(board, tail);
        this.cursors.set(board, Math.max(0, tail - this.options.historyDepth));
      }
    })().catch((error: unknown) => {
      this.priming = undefined;
      throw error;
    });
    return this.priming;
  }

  async fetch(): Promise<FeedBatch[]> {
    await this.prime();
    const batches: FeedBatch[] = [];
    for (const board of this.options.boards) {
      const since = this.cursors.get(board) ?? 0;
      const result = await this.drainBoard(board, since);
      const events = result.events.filter((event) => event.id > since).sort((a, b) => a.id - b.id);
      const last = events.at(-1);
      if (last) {
        batches.push({
          board,
          events,
          cursor: Math.max(last.id, result.cursor ?? 0),
          historicUpTo: this.tails.get(board) ?? 0,
        });
      }
    }
    return batches;
  }

  commit(batches: readonly FeedBatch[]): void {
    for (const batch of batches) {
      this.cursors.set(batch.board, Math.max(this.cursors.get(batch.board) ?? 0, batch.cursor));
    }
  }

  private async drainBoard(board: string, since: number): Promise<KanbanDrainResult> {
    const { dashboard, transport, drainMs, signal } = this.options;
    const attempt = async (): Promise<KanbanDrainResult> =>
      transport.drain({
        baseUrl: dashboard.baseUrl,
        board,
        since,
        token: await dashboard.credential.current(signal),
        waitMs: drainMs,
        idleMs: Math.max(20, Math.round(drainMs * 0.75)),
        signal,
      });

    try {
      return await attempt();
    } catch (raw) {
      const error = normalizeError(raw, { operation: "pollEvents" });
      const connectPhase = error.details.phase === "connect";
      if (error.code !== "UNAUTHENTICATED" && !(error.code === "ADAPTER_UNAVAILABLE" && connectPhase))
        throw error;
      // The stream cannot report why the handshake failed (rejected token vs. dashboard down). Probe with a REST call,
      // which re-reads the credential on 401; retry once only when the credential really changed.
      const before = dashboard.credential.known();
      await dashboard.request({
        method: "GET",
        path: "/api/plugins/kanban/boards",
        operation: "pollEvents",
        retry: false,
        signal,
      });
      if (dashboard.credential.known() === before) throw error;
      return attempt();
    }
  }
}
