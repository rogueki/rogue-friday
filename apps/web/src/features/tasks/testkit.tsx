import type { ActivityEvent, Agent, Approval, Task } from "@jarvis/sdk";
import { makeAgent, makeTask } from "@/test/fixtures";

/**
 * Test helpers of the module pages (not shipped: only test files import this). A router-style fake `fetch` for the SDK
 * client plus fixtures for the models of Tasks, Live Activity, Approvals and Agents.
 */

export type RouteResult = Response | { status?: number; body?: unknown; headers?: Record<string, string> } | unknown;
export type RouteHandler = RouteResult | ((request: Request, body: unknown) => RouteResult | Promise<RouteResult>);

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
}

export interface RouterFetch {
  fetch: typeof fetch;
  calls: RecordedCall[];
  /** Calls to `METHOD /path` (path without the /api/v1 prefix). */
  callsTo: (key: string) => RecordedCall[];
}

/** Keys are `"GET /tasks"` (without `/api/v1`); an unmatched request never settles, like a hanging network. */
export function routerFetch(routes: Record<string, RouteHandler>): RouterFetch {
  const calls: RecordedCall[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    let body: unknown;
    const text = await request.clone().text();
    if (text) body = JSON.parse(text) as unknown;
    calls.push({ method: request.method, path, query: url.searchParams, headers: request.headers, body });
    const handler = routes[`${request.method} ${path}`] ?? Object.entries(routes).find(([key]) => matches(key, request.method, path))?.[1];
    if (!handler) return new Promise<Response>(() => undefined);
    const result = typeof handler === "function" ? await (handler as (request: Request, body: unknown) => RouteResult | Promise<RouteResult>)(request, body) : handler;
    if (result instanceof Response) return result;
    if (result && typeof result === "object" && ("body" in result || "status" in result || "headers" in result)) {
      const { status = 200, body: payload, headers = {} } = result as { status?: number; body?: unknown; headers?: Record<string, string> };
      return new Response(payload === undefined ? null : JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  };
  return {
    fetch: impl as typeof fetch,
    calls,
    callsTo: (key) => calls.filter((call) => `${call.method} ${call.path}` === key || matches(key, call.method, call.path)),
  };
}

/** `"POST /approvals/:id/approve"` matches any id. */
function matches(key: string, method: string, path: string): boolean {
  const [keyMethod, keyPath] = key.split(" ");
  if (keyMethod !== method || !keyPath) return false;
  const pattern = new RegExp(`^${keyPath.replace(/:[a-z]+/gi, "[^/]+")}$`);
  return pattern.test(path);
}

const NOW = "2026-10-14T08:15:00Z";
const SOURCE = { adapterId: "mock-core", system: "mock", lastSyncedAt: NOW } as const;

export const listOf = <T,>(items: T[], extra: { nextCursor?: string | null; totalCount?: number; freshness?: "fresh" | "stale" | "offline-cache" } = {}) => ({
  contractVersion: "1.0.0",
  items,
  pageInfo: { nextCursor: extra.nextCursor ?? null, hasNextPage: Boolean(extra.nextCursor), ...(extra.totalCount === undefined ? {} : { totalCount: extra.totalCount }) },
  freshness: { state: extra.freshness ?? "fresh", asOf: NOW },
  sources: [SOURCE],
});

export const dataOf = <T,>(data: T, state: "fresh" | "stale" = "fresh") => ({ contractVersion: "1.0.0", data, freshness: { state, asOf: NOW } });

export { makeAgent, makeTask };

let counter = 0;
const suffix = (prefix: string): string => `${prefix}_${String(++counter).padStart(26, "0")}`;

export function makeTaskWith(partial: Partial<Task> = {}): Task {
  return makeTask({ id: suffix("task"), ...partial });
}

export function makeAgentWith(partial: Partial<Agent> = {}): Agent {
  return makeAgent({ id: suffix("agent"), ...partial });
}

export function makeApproval(partial: Partial<Approval> = {}): Approval {
  return {
    id: suffix("appr"),
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
    source: SOURCE,
    type: "send_email",
    action: "E-Mail an Frau Becker senden",
    riskTier: 2,
    agentId: null,
    taskId: null,
    rationale: "Der Entwurf liegt vor und der Termin ist frei.",
    impacts: [{ kind: "communication", description: "Externe Person erhält die Nachricht.", severity: "warning" }],
    preview: { kind: "email", title: "Terminbestätigung", body: "Sehr geehrte Frau Becker,\n\nder Termin ist bestätigt.", fields: [{ label: "An", value: "becker@example.org" }] },
    expiresAt: "2099-01-01T00:00:00Z",
    requiredAuth: "confirm",
    status: "pending",
    sourceRef: null,
    editable: true,
    correlationId: "corr_00000000000000000000000001",
    ...partial,
  };
}

let sequence = 1000;
export function makeEvent(partial: Partial<ActivityEvent> = {}): ActivityEvent {
  sequence += 1;
  const n = sequence;
  return {
    id: `act_${String(n).padStart(26, "0")}`,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    source: SOURCE,
    sequence: n,
    kind: "tool_call",
    severity: "info",
    title: `Ereignis ${n}`,
    status: "succeeded",
    parentId: null,
    correlationId: "corr_00000000000000000000000002",
    occurredAt: new Date(Date.parse(NOW) + n * 1000).toISOString(),
    durationMs: 120,
    ...partial,
  };
}

/**
 * jsdom has no layout: TanStack Virtual would see a 0 px viewport and render no rows. This gives every element a size
 * and returns the function that restores the originals.
 */
export function mockElementSize(width = 1200, height = 800): () => void {
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  const rect = Element.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: height });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: width });
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
  };
  return () => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    Element.prototype.getBoundingClientRect = rect;
  };
}
