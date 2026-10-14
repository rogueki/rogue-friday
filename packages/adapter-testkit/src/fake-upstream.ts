import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

export interface UpstreamRequest {
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  params: Record<string, string>;
  headers: Record<string, string>;
  /** Parsed JSON body, or the raw text when it is not JSON, or `undefined` for an empty body. */
  body: unknown;
}

export interface RecordedRequest extends UpstreamRequest {
  at: number;
}

export interface RouteResponse {
  status?: number;
  headers?: Record<string, string>;
  /** Serialized as JSON. */
  body?: unknown;
  /** Sent verbatim instead of `body` (e.g. malformed JSON). */
  raw?: string;
}

export type RouteHandler = (request: UpstreamRequest) => RouteResponse | Promise<RouteResponse>;

export type FaultBody =
  | string
  | number
  | boolean
  | null
  | readonly unknown[]
  | { readonly [key: string]: unknown }
  | ((request: UpstreamRequest) => unknown);

export interface Fault {
  /** Delay before the response is produced. */
  latencyMs?: number;
  /** Fixed status for the faulted requests. */
  status?: number;
  /** One status per request, consumed in order; afterwards the route behaves normally again. */
  statusSequence?: number[];
  /** Destroys the socket without answering (connection reset / stream drop). */
  drop?: boolean;
  /** Body for faulted responses; a function sees the request (to echo headers in error pages). */
  body?: FaultBody;
  raw?: string;
  headers?: Record<string, string>;
  /** Number of requests the fault applies to. Default: unlimited (until cleared). */
  times?: number;
}

interface RouteEntry {
  method: string;
  matcher: RegExp;
  keys: string[];
  handler: RouteHandler;
}

interface FaultEntry {
  method: string;
  matcher: RegExp;
  keys: string[];
  fault: Fault;
  remaining: number;
  sequenceIndex: number;
}

export type RoutePattern = string | RegExp;

function compile(pattern: RoutePattern): { matcher: RegExp; keys: string[] } {
  if (pattern instanceof RegExp) return { matcher: pattern, keys: [] };
  const keys: string[] = [];
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { matcher: new RegExp(`^${source}$`), keys };
}

export interface FakeUpstream {
  /** `http://127.0.0.1:<port>` (the port is fixed for the lifetime of the instance, also across `setOffline`). */
  readonly url: string;
  readonly port: number;
  readonly requests: RecordedRequest[];
  route(method: string, pattern: RoutePattern, handler: RouteHandler | RouteResponse): void;
  fault(method: string, pattern: RoutePattern, fault: Fault): void;
  clearFaults(): void;
  /** Requests recorded for a route (method + pattern match). */
  requestsFor(method: string, pattern: RoutePattern): RecordedRequest[];
  /** Stops accepting connections (clients see ECONNREFUSED) or resumes on the same port. */
  setOffline(offline: boolean): Promise<void>;
  /** Forgets routes, faults and recorded requests. */
  reset(): void;
  close(): Promise<void>;
}

/** Programmable HTTP upstream on 127.0.0.1 with a random port: latency, status sequences, dropped connections. */
export async function createFakeUpstream(): Promise<FakeUpstream> {
  const routes: RouteEntry[] = [];
  const faults: FaultEntry[] = [];
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();
  let server: Server = createServer();
  let port = 0;

  const readBody = async (request: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    if (text.length === 0) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  const send = (response: ServerResponse, result: RouteResponse): void => {
    const body = result.raw ?? (result.body === undefined ? "" : JSON.stringify(result.body));
    response.writeHead(result.status ?? 200, {
      ...(body.length > 0 ? { "content-type": "application/json" } : {}),
      ...result.headers,
    });
    response.end(body);
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = (request.method ?? "GET").toUpperCase();
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
    const upstreamRequest: UpstreamRequest = {
      method,
      path: url.pathname,
      query,
      params: {},
      headers,
      body: await readBody(request),
    };
    requests.push({ ...upstreamRequest, at: Date.now() });

    const activeFault = faults.find(
      (entry) => entry.method === method && entry.matcher.test(url.pathname) && entry.remaining > 0,
    );
    if (activeFault) {
      const { fault } = activeFault;
      if (!fault.statusSequence) activeFault.remaining -= 1;
      if (fault.latencyMs) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            timers.delete(timer);
            resolve();
          }, fault.latencyMs);
          timers.add(timer);
        });
        // The client may have given up (timeout) while we were sleeping.
        if (response.destroyed || request.socket.destroyed) return;
      }
      if (fault.drop) {
        request.socket.destroy();
        return;
      }
      const sequenceStatus = fault.statusSequence?.[activeFault.sequenceIndex];
      if (fault.statusSequence) {
        activeFault.sequenceIndex += 1;
        if (activeFault.sequenceIndex >= fault.statusSequence.length) activeFault.remaining = 0;
      }
      const status = sequenceStatus ?? fault.status;
      if (status !== undefined || fault.raw !== undefined || fault.body !== undefined) {
        const body =
          typeof fault.body === "function"
            ? (fault.body as (r: UpstreamRequest) => unknown)(upstreamRequest)
            : fault.body;
        send(response, {
          status: status ?? 200,
          ...(fault.headers ? { headers: fault.headers } : {}),
          ...(fault.raw !== undefined ? { raw: fault.raw } : { body: body ?? { error: `fault ${status}` } }),
        });
        return;
      }
    }

    const route = routes.find((entry) => entry.method === method && entry.matcher.test(url.pathname));
    if (!route) {
      send(response, { status: 404, body: { error: "no route", method, path: url.pathname } });
      return;
    }
    const match = route.matcher.exec(url.pathname);
    route.keys.forEach((key, index) => {
      upstreamRequest.params[key] = decodeURIComponent(match?.[index + 1] ?? "");
    });
    try {
      send(response, await route.handler(upstreamRequest));
    } catch (error) {
      send(response, {
        status: 500,
        body: { error: error instanceof Error ? error.message : "handler failed" },
      });
    }
  };

  const attach = (instance: Server): void => {
    instance.on("request", (request, response) => void handle(request, response));
    instance.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
  };

  const listen = (instance: Server, wantedPort: number): Promise<void> =>
    new Promise((resolve, reject) => {
      instance.once("error", reject);
      instance.listen(wantedPort, "127.0.0.1", () => {
        instance.off("error", reject);
        port = (instance.address() as AddressInfo).port;
        resolve();
      });
    });

  const stop = (instance: Server): Promise<void> =>
    new Promise((resolve) => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const socket of sockets) socket.destroy();
      instance.close(() => resolve());
    });

  attach(server);
  await listen(server, 0);
  let offline = false;

  return {
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    get port() {
      return port;
    },
    requests,
    route(method, pattern, handler) {
      const { matcher, keys } = compile(pattern);
      routes.unshift({
        method: method.toUpperCase(),
        matcher,
        keys,
        handler: typeof handler === "function" ? handler : () => handler,
      });
    },
    fault(method, pattern, fault) {
      const { matcher, keys } = compile(pattern);
      faults.push({
        method: method.toUpperCase(),
        matcher,
        keys,
        fault,
        remaining: fault.times ?? Number.POSITIVE_INFINITY,
        sequenceIndex: 0,
      });
    },
    clearFaults() {
      faults.length = 0;
    },
    requestsFor(method, pattern) {
      const { matcher } = compile(pattern);
      return requests.filter((entry) => entry.method === method.toUpperCase() && matcher.test(entry.path));
    },
    async setOffline(value) {
      if (value === offline) return;
      offline = value;
      if (value) {
        await stop(server);
      } else {
        server = createServer();
        attach(server);
        await listen(server, port);
      }
    },
    reset() {
      routes.length = 0;
      faults.length = 0;
      requests.length = 0;
    },
    async close() {
      if (!offline) await stop(server);
      offline = true;
    },
  };
}
