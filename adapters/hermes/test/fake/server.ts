import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { UpstreamRequest } from "@friday/adapter-testkit";
import { apiRoutes, dashboardRoutes, type RouteDef } from "./routes";
import { HermesState } from "./state";
import { acceptWebSocket } from "./ws-server";

export interface RecordedCall {
  listener: "api" | "dashboard";
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: unknown;
}

interface Compiled {
  def: RouteDef;
  matcher: RegExp;
  keys: string[];
}

function compile(def: RouteDef): Compiled {
  const keys: string[] = [];
  const source = def.pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { def, matcher: new RegExp(`^${source}$`), keys };
}

class Listener {
  readonly sockets = new Set<Socket>();
  /** Fixed status for every request (e.g. 401 to simulate an expired credential). */
  forceStatus: number | undefined;
  /** Delay before answering (timeout tests). */
  latencyMs = 0;
  private server: Server | undefined;
  private port = 0;
  private readonly routes: Compiled[];

  constructor(
    readonly name: "api" | "dashboard",
    defs: RouteDef[],
    private readonly calls: RecordedCall[],
    private readonly state: HermesState,
    private readonly onUpgrade?: (request: IncomingMessage, socket: Socket) => void,
  ) {
    this.routes = defs.map(compile);
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    await this.listen(0);
  }

  private async listen(port: number): Promise<void> {
    const server = createServer((request, response) => void this.handle(request, response));
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    if (this.onUpgrade) {
      server.on("upgrade", (request, socket) => this.onUpgrade?.(request, socket as Socket));
    }
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        this.port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async setOffline(offline: boolean): Promise<void> {
    if (offline && this.server) await this.stop();
    else if (!offline && !this.server) await this.listen(this.port);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = (request.method ?? "GET").toUpperCase();
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const query: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const all = url.searchParams.getAll(key);
      query[key] = all.length === 1 ? (all[0] as string) : all;
    }
    const headers = Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(",") : (value ?? ""),
      ]),
    );
    const upstream: UpstreamRequest = { method, path: url.pathname, query, params: {}, headers, body };
    this.calls.push({ listener: this.name, method, path: url.pathname, query, headers, body });

    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    if (response.destroyed) return;
    if (this.forceStatus !== undefined) {
      this.send(
        response,
        this.forceStatus,
        JSON.stringify(
          this.name === "dashboard" ? { detail: "Unauthorized" } : { error: { message: "forced" } },
        ),
        {},
      );
      return;
    }
    const route = this.routes.find(
      (entry) => entry.def.method === method && entry.matcher.test(url.pathname),
    );
    if (!route) {
      this.send(response, 404, JSON.stringify({ detail: "Not Found" }), {});
      return;
    }
    const match = route.matcher.exec(url.pathname);
    route.keys.forEach((key, index) => {
      upstream.params[key] = decodeURIComponent(match?.[index + 1] ?? "");
    });
    try {
      const result = route.def.handler(upstream);
      if ((method === "PATCH" || method === "POST") && url.pathname.startsWith("/api/plugins/kanban/") &&
          this.state.mutationResponseDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.state.mutationResponseDelayMs));
      }
      if (response.destroyed) return;
      const raw = result.raw ?? (result.body === undefined ? "" : JSON.stringify(result.body));
      this.send(response, result.status ?? 200, raw, result.headers ?? {});
    } catch (error) {
      this.send(
        response,
        500,
        JSON.stringify({ detail: error instanceof Error ? error.message : "handler failed" }),
        {},
      );
    }
  }

  private send(
    response: ServerResponse,
    status: number,
    body: string,
    headers: Record<string, string>,
  ): void {
    response.writeHead(status, { ...(body ? { "content-type": "application/json" } : {}), ...headers });
    response.end(body);
  }
}

export interface HermesFakeOptions {
  /** Interval of the event WebSocket's DB poll (the real one: 300 ms). */
  eventPollMs?: number;
}

export interface HermesFake {
  state: HermesState;
  /** Fake A: API server (`:43693` equivalent). */
  apiUrl: string;
  /** Fake B: dashboard (`:43691` equivalent). */
  dashboardUrl: string;
  calls: RecordedCall[];
  callsTo(listener: "api" | "dashboard", path: string | RegExp): RecordedCall[];
  setOffline(listener: "api" | "dashboard" | "both", offline: boolean): Promise<void>;
  setLatency(listener: "api" | "dashboard", ms: number): void;
  /** Answers every request of the listener with this status (`undefined` clears it). */
  forceStatus(listener: "api" | "dashboard", status: number | undefined): void;
  /** Number of event WebSocket connections accepted so far. */
  readonly wsConnections: number;
  /** Close code to use right after accepting an event WebSocket (simulates the 1008 policy close); `undefined` = normal. */
  wsCloseWith: number | undefined;
  close(): Promise<void>;
}

/** Two listeners on 127.0.0.1 (API server + dashboard incl. WebSocket events), driven by one in-memory state. */
export async function createHermesFake(options: HermesFakeOptions = {}): Promise<HermesFake> {
  const state = new HermesState();
  const calls: RecordedCall[] = [];
  const pollMs = options.eventPollMs ?? 40;
  let wsConnections = 0;

  const dashboard = new Listener("dashboard", dashboardRoutes(state), calls, state, (request, socket) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    calls.push({
      listener: "dashboard",
      method: "WS",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {},
      body: undefined,
    });
    if (url.pathname !== "/api/plugins/kanban/events") {
      socket.destroy();
      return;
    }
    if (!state.acceptAnyCredentials && url.searchParams.get("token") !== state.token) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const timers: Array<ReturnType<typeof setInterval>> = [];
    const peer = acceptWebSocket(request, socket, () => {
      for (const timer of timers) clearInterval(timer);
    });
    if (!peer) return;
    wsConnections += 1;
    if (fake.wsCloseWith !== undefined) {
      peer.close(fake.wsCloseWith);
      return;
    }
    const board = state.boards.get(url.searchParams.get("board") || "default");
    if (!board) {
      peer.close(1008);
      return;
    }
    const sinceParam = url.searchParams.get("since");
    let cursor =
      sinceParam !== null && sinceParam.trim() !== ""
        ? Math.max(0, Number(sinceParam) || 0)
        : board.nextEventId - 1;
    timers.push(
      setInterval(() => {
        const events = board.events.filter((event) => event.id > cursor).slice(0, 200);
        if (events.length === 0) return;
        cursor = events.at(-1)?.id ?? cursor;
        peer.send(JSON.stringify({ events, cursor }));
      }, pollMs),
    );
  });
  const api = new Listener("api", apiRoutes(state), calls, state);
  await Promise.all([dashboard.start(), api.start()]);

  const listeners = { api, dashboard };
  const fake: HermesFake = {
    state,
    get apiUrl() {
      return api.url;
    },
    get dashboardUrl() {
      return dashboard.url;
    },
    calls,
    callsTo: (listener, path) =>
      calls.filter(
        (call) =>
          call.listener === listener &&
          (typeof path === "string" ? call.path === path : path.test(call.path)),
      ),
    setOffline: async (listener, offline) => {
      if (listener === "both") await Promise.all([api.setOffline(offline), dashboard.setOffline(offline)]);
      else await listeners[listener].setOffline(offline);
    },
    setLatency: (listener, ms) => {
      listeners[listener].latencyMs = ms;
    },
    forceStatus: (listener, status) => {
      listeners[listener].forceStatus = status;
    },
    get wsConnections() {
      return wsConnections;
    },
    wsCloseWith: undefined,
    close: async () => {
      await Promise.all([api.stop(), dashboard.stop()]);
    },
  };
  return fake;
}
