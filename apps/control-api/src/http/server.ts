import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { runWithCorrelation } from "@jarvis/observability";
import type { Runtime } from "../runtime/types";
import { CSP_BASE, SECURITY_HEADERS, createRequestGuards, type RequestGuards } from "../security/guards";
import { ApiError, toFailure } from "../util/errors";
import { createCorrelationId } from "../util/ids";
import type { ApiPipeline } from "./pipeline";
import { ROUTE_TABLE } from "./route-table.generated";
import { StaticWeb } from "./static";

const API_PREFIX = "/api";
const toFastifyPath = (template: string): string => template.slice(API_PREFIX.length).replace(/\{(\w+)\}/g, ":$1");
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  const correlationId = String(reply.getHeader("x-correlation-id") ?? createCorrelationId());
  const failure = toFailure(error, correlationId);
  for (const [name, value] of Object.entries(failure.headers)) reply.header(name, value);
  return reply
    .status(failure.status)
    .header("X-Correlation-Id", correlationId)
    .header("Cache-Control", "no-store")
    .header("Content-Type", "application/json; charset=utf-8")
    .send(JSON.stringify({ error: failure.detail }));
}

function matchesTemplate(template: string, path: string): boolean {
  const pattern = new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\\{\w+\\\}|\{\w+\}/g, "[^/]+")}$`);
  return pattern.test(path);
}

/**
 * Installs hooks, the contract routes and the static web on the Fastify instance that Nest created. Routing is driven
 * by the generated route table, so every OpenAPI operation exists exactly once and nothing else is answered under
 * `/api/` (unknown paths get a contract error, never the SPA shell).
 */
export function configureHttp(fastify: FastifyInstance, runtime: Runtime, pipeline: ApiPipeline): RequestGuards {
  const guards = createRequestGuards(runtime);
  const web = new StaticWeb(runtime.config.paths.webRoot);

  // Bodies arrive as text; the pipeline parses them so malformed JSON yields a contract error instead of Fastify's.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser("*", { parseAs: "string", bodyLimit: 5 * 1024 * 1024 }, (_request, body, done) =>
    done(null, body === "" ? undefined : body),
  );

  fastify.addHook("onRequest", async (request, reply) => {
    const correlationId = createCorrelationId();
    reply.header("X-Correlation-Id", correlationId);
    if (!guards.hostAllowed(request.headers)) {
      return runWithCorrelation(correlationId, () =>
        sendError(reply, new ApiError({ code: "FORBIDDEN", message: "Ungültiger Host-Header.", details: { reason: "host_not_allowed" } })),
      );
    }
    if (!SAFE.has(request.method) && !guards.originAllowed(request.headers)) {
      return runWithCorrelation(correlationId, () =>
        sendError(reply, new ApiError({ code: "FORBIDDEN", message: "Ungültiger Origin.", details: { reason: "origin_not_allowed" } })),
      );
    }
    return undefined;
  });

  fastify.addHook("onSend", async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    if (!reply.hasHeader("content-security-policy")) reply.header("Content-Security-Policy", CSP_BASE);
    if (runtime.config.auth.secureCookies) reply.header("Strict-Transport-Security", "max-age=31536000");
    return payload;
  });

  void fastify.register(
    async (api) => {
      api.setErrorHandler((error, _request, reply) => {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 413) return sendError(reply, new ApiError({ code: "VALIDATION_FAILED", status: 413, message: "Der Anfragekörper ist zu groß." }));
        if (status && status >= 400 && status < 500) {
          return sendError(reply, new ApiError({ code: "VALIDATION_FAILED", status: 400, message: "Die Anfrage ist ungültig." }));
        }
        runtime.logger.error("Fehler im HTTP-Layer", { error });
        return sendError(reply, error);
      });

      for (const spec of ROUTE_TABLE) {
        api.route({
          method: spec.method,
          url: toFastifyPath(spec.path),
          ...(spec.maxBodyBytes !== null ? { bodyLimit: spec.maxBodyBytes } : {}),
          handler: (request, reply) => pipeline.handle(spec, request, reply),
        });
      }
      // Everything else below /api: a contract-shaped 404 (405 when the path exists for another method).
      api.all("/*", (request: FastifyRequest, reply: FastifyReply) => {
        const path = new URL(request.url, "http://localhost").pathname;
        const known = ROUTE_TABLE.some((route) => matchesTemplate(route.path, path));
        return sendError(
          reply,
          new ApiError({
            code: "NOT_FOUND",
            status: known ? 405 : 404,
            message: known ? `Die Methode ${request.method} ist für ${path} nicht vorgesehen.` : `Die Route ${request.method} ${path} existiert nicht.`,
            details: { path, method: request.method },
          }),
        );
      });
    },
    { prefix: API_PREFIX },
  );

  fastify.route({
    method: ["GET", "HEAD"],
    url: "/*",
    handler: (request, reply) => {
      web.handle(request, reply);
    },
  });
  return guards;
}
