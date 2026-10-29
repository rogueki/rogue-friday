import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { authorize } from "@friday/auth";
import { CONTRACT_VERSION, type Actor, type ErrorDetail } from "@friday/sdk";
import { runWithCorrelation } from "@friday/observability";
import type { AuditDraft } from "../db/audit-store";
import { IdempotencyStore, type StoredResponse } from "../db/stores";
import { buildHandlers } from "../handlers";
import type { Runtime } from "../runtime/types";
import { ACTION_BY_OPERATION, AUDIT_CATEGORY_BY_TAG, NON_AUDITED_POSTS } from "../security/action-map";
import { ApiError, toFailure, validationFailed } from "../util/errors";
import { createCorrelationId } from "../util/ids";
import type { Handler, HandlerResult, RequestContext } from "./context";
import { QueryValidator } from "./query-validator";
import type { OperationId, RouteSpec } from "./route-types";

const CORRELATION_HEADER = "x-correlation-id";
const CORRELATION_PATTERN = /^corr_[0-9A-Za-z]{26}$/;
const ROLE_RANK = { none: 0, viewer: 1, operator: 2, owner: 3 } as const;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Compiled contract patterns per pattern string, so per-request validation does not recompile them. */
const PATH_PATTERN_CACHE = new Map<string, RegExp>();
const VOICE_BRIDGE_OPERATIONS = new Set<OperationId>([
  "executeCommand", // Handler accepts only typed research intent from the local voice bridge.
  "getContentStudioPlan", "createContentProductionJob", "getContentProductionJob", "cancelContentProductionJob",
  "listSkills", "getOnboarding", "putOnboarding",
  "getCodingVoiceRepository", "createVoiceCodingRun",
  "createVoicePowerPointDeck",
  "previewVoiceLocalCalendar", "confirmVoiceLocalCalendar",
  "previewVoiceConnectedCalendar", "confirmVoiceConnectedCalendar",
  "previewVoiceMail", "confirmVoiceMail",
  "listHimalayaMailboxes", "listHimalayaEnvelopes", "getHimalayaMessage",
  "listMailAccounts", "listMailFolders", "listMailEnvelopes", "getMailMessage",
  "captureDurableMemoryEvent", "searchDurableMemory",
  "createVoiceDomainTask", "getVoiceDomainTask", "cancelVoiceDomainTask",
]);
const MAIL_BRIDGE_OPERATIONS = new Set<OperationId>([
  "listHimalayaMailboxes", "listHimalayaEnvelopes", "getHimalayaMessage",
]);

const AUTH_AUDIT_ACTIONS: Partial<Record<OperationId, string>> = {
  login: "auth.login",
  logout: "auth.logout",
  logoutAll: "auth.logout_all",
  reauth: "auth.reauth",
};

const DENIED_CODES = new Set(["UNAUTHENTICATED", "FORBIDDEN", "CSRF_INVALID", "APPROVAL_REQUIRED", "REAUTH_REQUIRED", "RATE_LIMITED", "CAPABILITY_MISSING"]);

interface Outcome {
  /** Served from the idempotency store: nothing executed, nothing to audit. */
  replayed?: boolean;
  status: number;
  result: HandlerResult;
  errorCode: ErrorDetail["code"] | null;
}

/**
 * The request pipeline every contract operation runs through, in this order:
 * correlation id, authentication, role + permission matrix, CSRF, query/path/body validation, `Idempotency-Key`
 * replay, handler (adapter port call), audit entry, response validation (dev/test), metrics and access log.
 */
export class ApiPipeline {
  private readonly handlers: Map<OperationId, Handler>;
  private readonly queries = new QueryValidator();
  private readonly inFlight = new Map<string, Promise<StoredResponse>>();

  constructor(private readonly runtime: Runtime) {
    this.handlers = buildHandlers();
  }

  hasHandler(operationId: OperationId): boolean {
    return this.handlers.has(operationId);
  }

  async handle(spec: RouteSpec, request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const started = performance.now();
    const inbound = request.headers[CORRELATION_HEADER];
    const correlationId = typeof inbound === "string" && CORRELATION_PATTERN.test(inbound) ? inbound : createCorrelationId();
    reply.header("X-Correlation-Id", correlationId);
    reply.header("Cache-Control", "no-store");

    await runWithCorrelation(correlationId, async () => {
      let ctx: RequestContext | undefined;
      let outcome: Outcome;
      try {
        ctx = this.buildContext(spec, request, correlationId);
        outcome = await this.run(ctx, spec);
      } catch (error) {
        outcome = this.failure(error, correlationId, spec);
      }

      if (ctx) this.recordAudit(ctx, spec, outcome, performance.now() - started);
      this.send(reply, outcome.result, spec);
      const seconds = (performance.now() - started) / 1000;
      this.runtime.metrics.recordRequest(spec.method, spec.path, outcome.status, seconds);
      const developer = this.runtime.settings.area("developer");
      if (developer.debugMode) this.runtime.logger.debug("request diagnostic", {
        method: spec.method,
        route: spec.path,
        operationId: spec.operationId,
        status: outcome.status,
        durationMs: Math.round(seconds * 1000),
        role: ctx?.principal?.role,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      });
    });
  }

  // ---- context ----------------------------------------------------------------------------------------------------

  private buildContext(spec: RouteSpec, request: FastifyRequest, correlationId: string): RequestContext {
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
    const principal = this.runtime.auth.authenticate(headers.cookie);
    const voiceBridgeAuthorized = VOICE_BRIDGE_OPERATIONS.has(spec.operationId) &&
      (request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1") &&
      verifyVoiceBridgeKey(headers.authorization, this.runtime.voiceBridgeKey);
    const calendarBridgeAuthorized = spec.operationId === "listCalendarEvents" && spec.method === "GET" &&
      (request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1") &&
      verifyVoiceBridgeKey(headers.authorization, this.runtime.calendarBridgeKey);
    const mailBridgeAuthorized = MAIL_BRIDGE_OPERATIONS.has(spec.operationId) && spec.method === "GET" &&
      (request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1") &&
      verifyVoiceBridgeKey(headers.authorization, this.runtime.mailBridgeKey);
    const hermesMemoryBridgeAuthorized = (spec.operationId === "captureDurableMemoryEvent" && spec.method === "POST" ||
      spec.operationId === "searchDurableMemory" && spec.method === "GET") &&
      (request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1") &&
      !this.runtime.config.server.allowRemote &&
      verifyVoiceBridgeKey(headers.authorization, this.runtime.hermesMemoryBridgeKey);
    const messengerInboundBridgeAuthorized = spec.operationId === "captureMessengerInbound" && spec.method === "POST" &&
      (request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1") &&
      !this.runtime.config.server.allowRemote &&
      verifyVoiceBridgeKey(headers.authorization, this.runtime.messengerInboundBridgeKey);
    const actor: Actor = messengerInboundBridgeAuthorized ? { type: "system", id: "friday-messenger", name: "F.R.I.D.A.Y. Messenger" } :
      hermesMemoryBridgeAuthorized ? { type: "system", id: "friday-hermes-memory", name: "F.R.I.D.A.Y. Hermes Memory" } :
      mailBridgeAuthorized ? { type: "system", id: "friday-mail", name: "F.R.I.D.A.Y. Mail" } :
      calendarBridgeAuthorized ? { type: "system", id: "friday-calendar", name: "F.R.I.D.A.Y. Calendar" } :
      voiceBridgeAuthorized ? { type: "system", id: "friday-voice", name: "F.R.I.D.A.Y. Voice" } :
      principal ? { type: "user", id: principal.userId, name: principal.displayName } : { type: "system", id: "anonymous" };
    const url = new URL(request.url, "http://localhost");
    const idempotencyKey = headers["idempotency-key"];
    const ifMatch = parseIfMatch(headers["if-match"], spec);
    const call = { correlationId, actor };
    return {
      runtime: this.runtime,
      spec,
      correlationId,
      principal,
      voiceBridgeAuthorized,
      calendarBridgeAuthorized,
      mailBridgeAuthorized,
      hermesMemoryBridgeAuthorized,
      messengerInboundBridgeAuthorized,
      actor,
      pathParams: (request.params ?? {}) as Record<string, string>,
      query: {},
      rawQuery: url.searchParams,
      rawBody: typeof request.body === "string" ? request.body : request.body === undefined || request.body === null ? undefined : JSON.stringify(request.body),
      body: undefined,
      headers,
      ip: request.ip,
      call,
      mutation: {
        ...call,
        ...(ifMatch !== undefined ? { ifMatchVersion: ifMatch } : {}),
        ...(idempotencyKey && spec.acceptsIdempotencyKey
          ? { idempotencyKey: scopedIdempotencyKey(idempotencyKey, spec, request.params as Record<string, string> | undefined,
            hermesMemoryBridgeAuthorized ? "friday-hermes-memory" : voiceBridgeAuthorized ? "friday-voice" : principal?.userId ?? request.ip) }
          : {}),
      },
      idempotencyKey: spec.acceptsIdempotencyKey ? idempotencyKey : undefined,
      audit: {},
    };
  }

  // ---- execution --------------------------------------------------------------------------------------------------

  private async run(ctx: RequestContext, spec: RouteSpec): Promise<Outcome> {
    this.authorizeRequest(ctx, spec);
    this.validateInput(ctx, spec, ctx.rawBody);

    const key = ctx.idempotencyKey;
    if (key && !SAFE_METHODS.has(spec.method)) {
      if (key.length < 8 || key.length > 128) throw validationFailed("Idempotency-Key muss 8 bis 128 Zeichen lang sein.", [{ path: "Idempotency-Key", message: "Länge 8..128" }]);
      // Binary speech is not serializable in the JSON idempotency store. Its service
      // journals the scoped key before the external call and rejects a second request.
      if (spec.operationId === "createElevenSpeech" || spec.operationId === "sendHimalayaMessage" || spec.operationId === "sendMailMessage" || spec.operationId === "confirmMessengerMessage" || spec.operationId === "previewCalDavEvent" || spec.operationId === "createCalendarEvent" || spec.operationId === "originateTelephonyCall" || spec.operationId === "originateCloudTalkCall" || spec.operationId === "createVoicePowerPointDeck") return this.execute(ctx, spec);
      return this.runIdempotent(ctx, spec, key);
    }
    return this.execute(ctx, spec);
  }

  private authorizeRequest(ctx: RequestContext, spec: RouteSpec): void {
    const { runtime } = this;
    if (verifyVoiceBridgeKey(ctx.headers.authorization, runtime.messengerInboundBridgeKey)) {
      if (ctx.messengerInboundBridgeAuthorized) return;
      throw new ApiError({ code: "FORBIDDEN", message: "Messenger-Dienstkennung gilt nur für lokalen Gateway-Empfang." });
    }
    if (verifyVoiceBridgeKey(ctx.headers.authorization, runtime.hermesMemoryBridgeKey)) {
      if (ctx.hermesMemoryBridgeAuthorized) return;
      throw new ApiError({ code: "FORBIDDEN", message: "Hermes-Gedächtniskennung gilt nur für lokalen Ereignisabruf und Aufnahme." });
    }
    if (verifyVoiceBridgeKey(ctx.headers.authorization, runtime.mailBridgeKey)) {
      if (ctx.mailBridgeAuthorized) return;
      throw new ApiError({ code: "FORBIDDEN", message: "Mail-Dienstkennung gilt nur fuer lokalen Postfachabruf." });
    }
    if (verifyVoiceBridgeKey(ctx.headers.authorization, runtime.calendarBridgeKey)) {
      if (ctx.calendarBridgeAuthorized) return;
      throw new ApiError({ code: "FORBIDDEN", message: "Kalender-Dienstkennung gilt nur fuer lokalen Terminabruf." });
    }
    if (ctx.voiceBridgeAuthorized) return;
    const principal = ctx.principal;
    if (spec.requiresSession && !principal && spec.operationId !== "getSession") {
      throw new ApiError({ code: "UNAUTHENTICATED", message: "Bitte anmelden." });
    }
    if (!principal) return;

    if (spec.requiresSession && ROLE_RANK[principal.role] < ROLE_RANK[spec.role]) {
      throw new ApiError({
        code: "FORBIDDEN",
        message: `Für diese Aktion ist mindestens die Rolle ${spec.role} erforderlich.`,
        details: { required: spec.role, actual: principal.role },
      });
    }
    if (spec.csrf && spec.requiresSession && !runtime.auth.verifyCsrf(principal, ctx.headers)) {
      throw new ApiError({ code: "CSRF_INVALID", message: "Das CSRF-Token fehlt oder ist ungültig." });
    }
    const action = ACTION_BY_OPERATION[spec.operationId];
    if (action) {
      const decision = authorize(principal.role, action, { devMode: runtime.config.dev.scenarioConsole && runtime.engine !== undefined && runtime.settings.area("developer").scenarioConsole });
      if (!decision.allowed) {
        if (decision.reason === "dev_only") throw new ApiError({ code: "NOT_FOUND", message: "Szenario-Konsole ist nicht aktiviert." });
        throw new ApiError({ code: "FORBIDDEN", message: "Für diese Aktion fehlt die Berechtigung.", details: { action, reason: decision.reason } });
      }
    }
  }

  private validateInput(ctx: RequestContext, spec: RouteSpec, rawBody: string | undefined): void {
    for (const name of spec.pathParams) {
      const value = ctx.pathParams[name];
      const rule = spec.pathParamRules?.[name];
      if (!value || value.length > (rule?.maxLength ?? 128)) throw invalidPathParam(name);
      if (rule?.pattern !== undefined && !pathPattern(rule.pattern).test(value)) throw invalidPathParam(name);
      if (rule?.enum !== undefined && !rule.enum.includes(value)) throw invalidPathParam(name);
    }
    ctx.query = this.queries.parse(spec, ctx.rawQuery);
    if (!spec.requestBody) return;
    let body: unknown;
    if (rawBody !== undefined && rawBody.trim() !== "") {
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new ApiError({ code: "VALIDATION_FAILED", status: 400, message: "Der Anfragekörper ist kein gültiges JSON." });
      }
    }
    if (body === undefined) {
      if (spec.requestBody.required) throw validationFailed("Der Anfragekörper fehlt.", [{ path: "body", message: "erforderlich" }]);
      return;
    }
    const result = this.runtime.validator.validate(spec.requestBody.schema, body);
    if (!result.valid) throw validationFailed("Die Anfrage entspricht nicht dem Schema.", result.errors.map((issue) => ({ path: issue.path, message: issue.message })));
    ctx.body = body;
  }

  private async runIdempotent(ctx: RequestContext, spec: RouteSpec, key: string): Promise<Outcome> {
    const { stores } = this.runtime;
    const actor = ctx.hermesMemoryBridgeAuthorized ? "friday-hermes-memory" :
      ctx.voiceBridgeAuthorized ? "friday-voice" : ctx.principal?.userId ?? ctx.ip;
    const bodyHash = IdempotencyStore.bodyHash({ body: ctx.body, query: ctx.query });
    const lookup = stores.idempotency.lookup(spec.method, requestPath(ctx), key, actor, bodyHash);
    if (lookup.kind === "conflict") {
      throw new ApiError({
        code: "IDEMPOTENCY_CONFLICT",
        message: "Der Idempotency-Key wurde bereits für eine andere Anfrage verwendet.",
        details: { idempotencyKey: key },
      });
    }
    // Cache accounting (PLAN §50.3): a repeated Idempotency-Key is served from the store (hit), a new one executes (miss).
    this.runtime.metrics.recordCache(lookup.kind === "replay");
    if (lookup.kind === "replay") return this.replayed(lookup.response);

    // A double click arrives while the first request is still running: wait for it instead of executing twice.
    const flightKey = IdempotencyStore.keyHash(spec.method, requestPath(ctx), key, actor);
    const pending = this.inFlight.get(flightKey);
    if (pending) {
      this.runtime.metrics.recordCache(true);
      return this.replayed(await pending);
    }

    const execution = (async (): Promise<StoredResponse> => {
      const outcome = await this.execute(ctx, spec);
      const stored: StoredResponse = {
        status: outcome.status,
        body: outcome.result.body ?? null,
        headers: outcome.result.headers ?? {},
      };
      if (outcome.status >= 200 && outcome.status < 300 && outcome.result.body !== undefined && !outcome.result.raw) {
        stores.idempotency.save(spec.method, requestPath(ctx), key, actor, bodyHash, stored);
      }
      return { ...stored, headers: stored.headers };
    })();
    this.inFlight.set(flightKey, execution);
    try {
      const stored = await execution;
      return { status: stored.status, result: { status: stored.status, body: stored.body, headers: stored.headers }, errorCode: null };
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  private replayed(stored: StoredResponse): Outcome {
    return {
      status: stored.status,
      errorCode: null,
      replayed: true,
      result: { status: stored.status, body: stored.body, headers: { ...stored.headers, "Idempotent-Replayed": "true" } },
    };
  }

  private async execute(ctx: RequestContext, spec: RouteSpec): Promise<Outcome> {
    const handler = this.handlers.get(spec.operationId);
    if (!handler) throw new ApiError({ code: "INTERNAL", message: `Für ${spec.operationId} ist kein Handler registriert.` });
    const handled = await handler(ctx);
    const result = handled.status >= 200 && handled.status < 300 && spec.acceptsIdempotencyKey && ctx.idempotencyKey &&
      !handled.headers?.["Idempotent-Replayed"]
      ? { ...handled, headers: { ...handled.headers, "Idempotent-Replayed": "false" } } : handled;
    return { status: result.status, result, errorCode: null };
  }

  // ---- failures, audit, response -----------------------------------------------------------------------------------

  private failure(error: unknown, correlationId: string, spec: RouteSpec): Outcome {
    const failure = toFailure(error, correlationId);
    if (failure.detail.code === "INTERNAL") {
      this.runtime.logger.error("Unerwarteter Fehler", { operationId: spec.operationId, error: failure.cause });
    }
    return {
      status: failure.status,
      errorCode: failure.detail.code,
      result: { status: failure.status, body: { error: failure.detail }, headers: failure.headers },
    };
  }

  private recordAudit(ctx: RequestContext, spec: RouteSpec, outcome: Outcome, durationMs: number): void {
    if (outcome.replayed || SAFE_METHODS.has(spec.method) || NON_AUDITED_POSTS.has(spec.operationId)) return;
    // Anonymous noise (scanners hitting POST routes) is not an audit event, except the login itself.
    if (!ctx.principal && !ctx.voiceBridgeAuthorized && spec.operationId !== "login") return;
    const failed = outcome.status >= 400;
    const result: AuditDraft["result"] = !failed ? "success" : outcome.errorCode && DENIED_CODES.has(outcome.errorCode) ? "denied" : "failure";
    const note = ctx.audit;
    const username = spec.operationId === "login" ? sanitizeUsername((ctx.body as { username?: unknown } | undefined)?.username) : undefined;
    this.runtime.audit.record({
      category: note.category ?? AUDIT_CATEGORY_BY_TAG[spec.tag] ?? "user_action",
      action: note.action ?? AUTH_AUDIT_ACTIONS[spec.operationId] ?? `${spec.tag}.${spec.operationId}`,
      severity: note.severity ?? (result === "success" ? "info" : result === "denied" ? "warning" : "error"),
      result,
      correlationId: ctx.correlationId,
      actor: username ? { type: "user", id: username } : ctx.actor,
      durationMs: Math.round(durationMs),
      errorCode: outcome.errorCode,
      ...(note.approvalId ? { approvalId: note.approvalId } : {}),
      ...(note.taskId !== undefined ? { taskId: note.taskId } : {}),
      ...(note.agentId !== undefined ? { agentId: note.agentId } : {}),
      ...(note.adapterId !== undefined ? { adapterId: note.adapterId } : {}),
      ...(note.before !== undefined ? { before: note.before } : {}),
      ...(note.after !== undefined ? { after: note.after } : {}),
      context: { operationId: spec.operationId, method: spec.method, path: requestPath(ctx), status: outcome.status, ...(note.context ?? {}) },
    });
  }

  private send(reply: FastifyReply, result: HandlerResult, spec: RouteSpec): void {
    const mode = this.runtime.responseValidation;
    let status = result.status;
    let body = result.body;
    let headers = result.headers ?? {};
    if (mode !== "off" && !result.raw && body !== undefined) {
      const problem = this.validateResponse(spec, status, body);
      if (problem) {
        this.runtime.logger.error("Antwort verletzt den Vertrag", { operationId: spec.operationId, status, issues: problem });
        if (mode === "throw") {
          const failure = toFailure(new ApiError({ code: "INTERNAL", message: "Die Antwort verletzt den Vertrag.", details: { operationId: spec.operationId, status, issues: problem } }), String(reply.getHeader("x-correlation-id")));
          status = failure.status;
          body = { error: failure.detail };
          headers = {};
        }
      }
    }
    for (const [name, value] of Object.entries(headers)) reply.header(name, value);
    if (result.setCookie?.length) reply.header("Set-Cookie", result.setCookie);
    reply.status(status);
    if (result.raw) {
      reply.header("Content-Type", result.raw.contentType);
      reply.header("X-Content-Type-Options", "nosniff");
      if (result.raw.disposition) reply.header("Content-Disposition", result.raw.disposition);
      reply.send(result.raw.data);
      return;
    }
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.send(body === undefined ? "" : JSON.stringify(body));
  }

  /** Dev/test guard: the body of every response must satisfy the contract schema of its status. */
  private validateResponse(spec: RouteSpec, status: number, body: unknown): Array<{ path: string; message: string }> | null {
    const declared = spec.responses.find((response) => response.status === status);
    const schema = declared?.schema && declared.schema !== "binary" ? declared.schema : status >= 400 ? "ErrorResponse" : null;
    if (!schema) return null;
    const result = this.runtime.validator.validate(schema, body);
    return result.valid ? null : result.errors.slice(0, 10);
  }
}

/**
 * The key adapters see. A client-chosen key is only unique per user and request target, so the adapter layer gets a key
 * derived from user + operation + resource + client key; two users (or two resources) reusing one key never collide
 * upstream.
 */
export function scopedIdempotencyKey(key: string, spec: RouteSpec, params: Record<string, string> | undefined, actor: string): string {
  const target = spec.path.replace(/\{(\w+)\}/g, (_m, name: string) => params?.[name] ?? name);
  const digest = createHash("sha256").update(`${actor}\0${spec.method} ${target}\0${key}`).digest("hex").toUpperCase();
  return `idem_${digest.slice(0, 26)}`;
}

function verifyVoiceBridgeKey(authorization: string | undefined, expected: Buffer): boolean {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9+/]{43}=)$/)?.[1];
  if (!token || expected.length !== 32) return false;
  const received = Buffer.from(token, "base64");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function requestPath(ctx: RequestContext): string {
  return ctx.spec.path.replace(/\{(\w+)\}/g, (_match, name: string) => ctx.pathParams[name] ?? name);
}

function invalidPathParam(name: string): ApiError {
  return new ApiError({ code: "VALIDATION_FAILED", status: 400, message: `Der Pfadparameter ${name} ist ungültig.` });
}

function pathPattern(pattern: string): RegExp {
  const cached = PATH_PATTERN_CACHE.get(pattern);
  if (cached) return cached;
  const compiled = new RegExp(pattern, "u");
  PATH_PATTERN_CACHE.set(pattern, compiled);
  return compiled;
}

function sanitizeUsername(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/[^A-Za-z0-9._@-]/g, "").slice(0, 64) || undefined : undefined;
}

/** `If-Match` carries the resource version, optionally quoted or weak (`"3"`, `W/"3"`). */
function parseIfMatch(header: string | undefined, spec: RouteSpec): number | undefined {
  if (header === undefined || !spec.acceptsIfMatch) return undefined;
  const cleaned = header.replace(/^W\//, "").replace(/"/g, "").trim();
  if (cleaned === "" || cleaned === "*") return undefined;
  const value = Number(cleaned);
  if (!Number.isInteger(value) || value < 0) {
    throw new ApiError({ code: "VALIDATION_FAILED", status: 400, message: "If-Match muss eine Versionsnummer sein.", details: { fieldErrors: [{ path: "If-Match", message: "ganze Zahl erwartet" }] } });
  }
  return value;
}

export { CONTRACT_VERSION };
