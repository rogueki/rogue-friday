import type { SourceDescriptor } from "@friday/sdk";

/** Shared fixtures and fakes for the group-C module tests (not imported by production code). */

export const NOW = "2026-10-14T08:15:00Z";
export const SOURCE: SourceDescriptor = { adapterId: "mock-core", system: "mock", lastSyncedAt: NOW };
export const FRESH = { state: "fresh", asOf: NOW } as const;

export function listOf<T>(items: T[], extra: { hasNextPage?: boolean; totalCount?: number } = {}) {
  return {
    contractVersion: "2.0.0",
    items,
    pageInfo: { nextCursor: null, hasNextPage: extra.hasNextPage ?? false, ...(extra.totalCount === undefined ? {} : { totalCount: extra.totalCount }) },
    freshness: FRESH,
    sources: [SOURCE],
  };
}

export const single = <T>(data: T) => ({ contractVersion: "2.0.0", data, freshness: FRESH });

export function errorBody(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message, severity: "error", retryable: false, correlationId: "corr_01JTESTTESTTESTTESTTESTTES", details: {} } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type RouteHandler = (url: URL, request: Request) => unknown;

export interface RoutedFetch {
  fetch: typeof fetch;
  calls: { method: string; path: string; search: string; headers: Headers; body: string }[];
}

/**
 * Fake fetch keyed by "METHOD /api/v1/path"; handlers return a JSON-serialisable body or a ready `Response`.
 * Unknown routes answer 404 so a missing route is visible in the test instead of hanging.
 */
export function routedFetch(routes: Record<string, RouteHandler | unknown>): RoutedFetch {
  const calls: RoutedFetch["calls"] = [];
  const impl = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
    calls.push({ method: request.method, path: url.pathname, search: url.search, headers: request.headers, body });
    const key = `${request.method} ${url.pathname}`;
    if (!(key in routes)) return errorBody("NOT_FOUND", `Keine Testroute für ${key}`, 404);
    const route = routes[key];
    const result = typeof route === "function" ? (route as RouteHandler)(url, request) : route;
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: impl as typeof fetch, calls };
}

/** Gives scroll containers a size so TanStack Virtual renders rows in jsdom. */
export function mockElementSize(width = 1200, height = 600): () => void {
  const originalRect = Element.prototype.getBoundingClientRect;
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: height });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: width });
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = originalRect;
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  };
}
