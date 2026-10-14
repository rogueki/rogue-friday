import { MockApiError } from "../core/errors";
import { MockApprovalTokens } from "./approval-tokens";
import { ScenarioEngine } from "../scenarios/engine";
import type { OpContext } from "../world/types";
import type { MockWorld } from "../world/world";
import { ROUTES, type HttpMethod, type RouteDef, type RouteInput, type RouteResult } from "./routes";

export interface ApiHandlerOptions {
  /** Delay responses by the injected per-category latency (default true; 0 ms means no delay). */
  simulateLatency?: boolean;
  /** Reject mutating requests whose X-CSRF-Token differs from the session token (default: tolerated). */
  enforceCsrf?: boolean;
  /** Scenario engine to use; defaults to the engine shared per world. */
  engine?: ScenarioEngine;
  /**
   * Behave like the Control API for approvals (PLAN §32.5): `GET /approvals/{id}` issues a single-use token in the
   * `X-Approval-Token` header and `POST /approvals/{id}/approve` is refused (403 APPROVAL_REQUIRED) without a valid one.
   * Off by default; the MSW handlers of the browser mock switch it on.
   */
  approvalTokens?: boolean;
}

export const API_PREFIX = "/api/v1";

interface CompiledRoute {
  route: RouteDef;
  pattern: RegExp;
  names: string[];
}

const COMPILED: CompiledRoute[] = ROUTES.map((route) => {
  const names: string[] = [];
  const source = route.path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { route, pattern: new RegExp(`^${source}$`), names };
});

const CORRELATION = /^corr_[0-9A-Za-z]{26}$/;
const MUTATING: ReadonlySet<string> = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function matchRoute(method: string, path: string): { route: RouteDef; params: Record<string, string> } | "method-not-allowed" | null {
  let pathMatched = false;
  for (const compiled of COMPILED) {
    const match = compiled.pattern.exec(path);
    if (!match) continue;
    pathMatched = true;
    if (compiled.route.method !== method) continue;
    const params: Record<string, string> = {};
    compiled.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] as string);
    });
    return { route: compiled.route, params };
  }
  return pathMatched ? "method-not-allowed" : null;
}

function queryOf(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    out[key] = values.length > 1 ? values : (values[0] as string);
  }
  return out;
}

function json(status: number, body: unknown, correlationId: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "X-Correlation-Id": correlationId, ...headers } });
}

function errorResponse(error: MockApiError, correlationId: string): Response {
  return json(error.status, error.toResponse(correlationId), correlationId, error.status === 503 ? { "Retry-After": "2" } : {});
}

/**
 * Framework-free REST dispatcher: turns a fetch `Request` for `/api/v1/*` into the contract `Response`. MSW handlers,
 * tests and the Control API's mock mode all go through it, so they share status codes, envelopes and error shapes.
 */
export async function handleApiRequest(world: MockWorld, request: Request, options: ApiHandlerOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const prefixAt = url.pathname.indexOf(API_PREFIX);
  const path = prefixAt >= 0 ? url.pathname.slice(prefixAt + API_PREFIX.length) || "/" : url.pathname;
  const headerCorrelation = request.headers.get("X-Correlation-Id");
  const correlationId = headerCorrelation && CORRELATION.test(headerCorrelation) ? headerCorrelation : world.id("corr");
  const method = request.method.toUpperCase();

  try {
    const matched = matchRoute(method, path);
    if (matched === null) throw new MockApiError({ code: "NOT_FOUND", message: `Die Route ${method} ${path} existiert nicht.`, details: { path } });
    if (matched === "method-not-allowed") throw new MockApiError({ code: "NOT_FOUND", message: `Die Methode ${method} ist für ${path} nicht vorgesehen.`, status: 405, details: { path, method } });

    world.auth.requireRole(matched.route.role);
    if (options.enforceCsrf && MUTATING.has(method) && matched.route.role !== "none" && request.headers.get("X-CSRF-Token") !== world.state.session.csrfToken) {
      throw new MockApiError({ code: "CSRF_INVALID", message: "Das CSRF-Token fehlt oder ist ungültig." });
    }

    let body: unknown;
    if (MUTATING.has(method)) {
      const text = await request.text();
      if (text.trim() !== "") {
        try {
          body = JSON.parse(text);
        } catch {
          throw new MockApiError({ code: "VALIDATION_FAILED", message: "Der Anfragekörper ist kein gültiges JSON.", status: 400 });
        }
      }
    }

    const ctx: OpContext = { correlationId };
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey) ctx.idempotencyKey = idempotencyKey;
    const ifMatch = request.headers.get("If-Match");
    if (ifMatch) ctx.ifMatch = ifMatch;
    const channel = request.headers.get("X-Input-Channel");
    if (channel === "voice" || channel === "api" || channel === "dashboard") ctx.inputChannel = channel;

    const input: RouteInput = { params: matched.params, query: queryOf(url), body, ctx, raw: url.searchParams };
    const engine = options.engine ?? ScenarioEngine.for(world);
    if (options.approvalTokens) requireApprovalToken(world, matched.route.operationId, matched.params.id, body, request.headers.get("X-Approval-Token"));
    const result = matched.route.run(world, engine, input);
    if (options.approvalTokens) issueApprovalToken(world, matched.route.operationId, result);

    if (options.simulateLatency !== false && result.category) {
      const delayMs = world.latencyFor(result.category);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (result.text) {
      const headers: Record<string, string> = { "Content-Type": result.text.contentType, "X-Correlation-Id": correlationId };
      if (result.text.fileName) headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(result.text.fileName)}"`;
      return new Response(result.text.body, { status: result.status ?? 200, headers });
    }
    return json(result.status ?? 200, result.body, correlationId, result.headers);
  } catch (error) {
    if (error instanceof MockApiError) return errorResponse(error, correlationId);
    const internal = new MockApiError({ code: "INTERNAL", message: error instanceof Error ? error.message : "Interner Fehler im Mock-Server" });
    return errorResponse(internal, correlationId);
  }
}

const REAUTH_MARKER = "reauthToken";

/** An approve of a pending approval needs the token its details view issued (decided/unknown approvals fail in the world). */
function requireApprovalToken(world: MockWorld, operationId: string, approvalId: string | undefined, body: unknown, header: string | null): void {
  if (operationId !== "approveApproval" || !approvalId) return;
  const approval = world.state.approvals.find((candidate) => candidate.id === approvalId);
  if (!approval || approval.status !== "pending") return;
  // Tier 3 without a re-auth token fails first (REAUTH_REQUIRED) and must not spend the token.
  const needsReauth = approval.riskTier === 3 || approval.requiredAuth === "reauth";
  if (needsReauth && !(body as Record<string, unknown> | undefined)?.[REAUTH_MARKER]) return;
  const check = MockApprovalTokens.for(world).consume(header, approvalId);
  if (check === "ok") return;
  throw new MockApiError({
    code: "APPROVAL_REQUIRED",
    message:
      check === "missing"
        ? "Das Freigabe-Token fehlt. Bitte die Freigabe öffnen und erneut entscheiden."
        : check === "expired"
          ? "Das Freigabe-Token ist abgelaufen. Bitte die Freigabe erneut öffnen."
          : "Das Freigabe-Token ist ungültig oder wurde bereits verwendet.",
    details: { reason: check === "missing" ? "missing_approval_token" : check },
  });
}

/** Opening a pending approval issues the token (the role matrix of the mock is the session role, see `requireRole`). */
function issueApprovalToken(world: MockWorld, operationId: string, result: RouteResult): void {
  if (operationId !== "getApproval") return;
  const approval = (result.body as { data?: { id?: string; status?: string } } | undefined)?.data;
  if (!approval?.id || approval.status !== "pending" || world.state.session.role === "viewer") return;
  const { token, expiresAt } = MockApprovalTokens.for(world).issue(approval.id);
  result.headers = { ...(result.headers ?? {}), "X-Approval-Token": token, "X-Approval-Token-Expires": expiresAt };
}

export type { HttpMethod };
