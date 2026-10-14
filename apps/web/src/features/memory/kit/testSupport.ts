import type { Capabilities, Freshness, SourceDescriptor } from "@jarvis/sdk";

/** Fixtures and a routed fake `fetch` for the group-B module tests (never imported by production code). */

export const NOW = "2026-10-14T08:15:00Z";
export const SOURCE: SourceDescriptor = { adapterId: "mock-b", system: "mock", lastSyncedAt: NOW };
export const FRESH: Freshness = { state: "fresh", asOf: NOW };

export const resource = (id: string, version = 1) => ({ id, version, createdAt: NOW, updatedAt: NOW, source: SOURCE });

export function listOf<T>(items: T[], extra: { freshness?: Freshness; hasNextPage?: boolean; totalCount?: number } = {}) {
  return {
    contractVersion: "1.0.0",
    items,
    pageInfo: { nextCursor: null, hasNextPage: extra.hasNextPage ?? false, ...(extra.totalCount === undefined ? {} : { totalCount: extra.totalCount }) },
    freshness: extra.freshness ?? FRESH,
    sources: [SOURCE],
  };
}

export const single = <T>(data: T, freshness: Freshness = FRESH) => ({ contractVersion: "1.0.0", data, freshness });

export function errorResponse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message, severity: "error", retryable: false, correlationId: "corr_01JTESTTESTTESTTESTTESTTES", details: {} } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type RouteHandler = (url: URL, request: Request, body: unknown) => unknown;

export interface RoutedFetch {
  fetch: typeof fetch;
  calls: { method: string; path: string; search: string; headers: Headers; body: unknown }[];
  /** Calls to `METHOD path` (path without query). */
  to: (method: string, path: string) => RoutedFetch["calls"];
}

/**
 * Fake fetch keyed by `"METHOD /api/v1/path"`. A handler returns a JSON body or a ready `Response`; unknown routes answer
 * 404 so a missing route fails visibly instead of hanging.
 */
export function routedFetch(routes: Record<string, RouteHandler | unknown>): RoutedFetch {
  const calls: RoutedFetch["calls"] = [];
  const impl = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
    const body: unknown = text === "" ? undefined : JSON.parse(text);
    calls.push({ method: request.method, path: url.pathname, search: url.search, headers: request.headers, body });
    const key = `${request.method} ${url.pathname}`;
    if (!(key in routes)) return errorResponse("NOT_FOUND", `Keine Testroute für ${key}`, 404);
    const route = routes[key];
    const result = typeof route === "function" ? (route as RouteHandler)(url, request, body) : route;
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: impl as typeof fetch, calls, to: (method, path) => calls.filter((call) => call.method === method && call.path === path) };
}

/** Capability document with every flag of the given modules set from `flags` (unlisted flags false). */
export function modules(flags: Record<string, Record<string, boolean>>): Capabilities {
  return { contractVersion: "1.0.0", modules: flags } as unknown as Capabilities;
}

export const FULL = {
  memory: { read: true, write: true, delete: true, search: true, lock: true, export: true, resolveConflict: true },
  notifications: { read: true, acknowledge: true, snooze: true, resolve: true },
  communication: { read: true, draft: true, send: true, multiChannel: true },
  mail: { read: true, draft: true, send: true },
  calendar: { read: true, create: true, reschedule: true, cancel: true, invite: true, respond: true, propose: true },
  automations: { read: true, create: true, update: true, test: true, enable: true, disable: true, pauseAll: true, versions: true },
};
