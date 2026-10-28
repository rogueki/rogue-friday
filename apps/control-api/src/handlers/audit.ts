import { PORT_SPEC } from "@friday/adapter-core";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import { auditTrailEvent, auditTrailPage, type AuditTrailQuery } from "../services/audit-trail";
import { shape } from "./ports";

function list(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => String(entry).split(",")).filter(Boolean);
  return String(value).split(",").filter(Boolean);
}

function queryOf(ctx: RequestContext): AuditTrailQuery {
  const query = ctx.query;
  const text = (value: unknown) => (value === undefined ? undefined : String(value));
  return {
    ...(text(query.from) ? { from: text(query.from) } : {}),
    ...(text(query.to) ? { to: text(query.to) } : {}),
    ...(text(query.actor) ? { actor: text(query.actor) } : {}),
    ...(text(query.agentId) ? { agentId: text(query.agentId) } : {}),
    ...(text(query.taskId) ? { taskId: text(query.taskId) } : {}),
    ...(text(query.tool) ? { tool: text(query.tool) } : {}),
    ...(text(query.adapterId) ? { adapterId: text(query.adapterId) } : {}),
    ...(text(query.action) ? { action: text(query.action) } : {}),
    ...(text(query.cursor) ? { cursor: text(query.cursor) } : {}),
    ...(text(query.limit) ? { limit: Number(query.limit) } : {}),
    ...(list(query.category).length ? { category: list(query.category) } : {}),
    ...(list(query.severity).length ? { severity: list(query.severity) } : {}),
    ...(list(query.result).length ? { result: list(query.result) } : {}),
  };
}

/**
 * Audit reads come from the durable hash-chained trail, never from an adapter. An adapter would show fixtures and hide
 * exactly the events an audit view has to prove.
 */
export const auditHandlers: Partial<Record<OperationId, Handler>> = {
  listAuditEvents: async (ctx) => shape(ctx, PORT_SPEC.audit.listAuditEvents, auditTrailPage(ctx.runtime.db, queryOf(ctx))),
  exportAudit: async (ctx) => shape(ctx, PORT_SPEC.audit.exportAudit, auditTrailPage(ctx.runtime.db, queryOf(ctx))),
  getAuditEvent: async (ctx) => {
    const event = auditTrailEvent(ctx.runtime.db, String(ctx.pathParams.id ?? ""));
    if (!event) {
      throw Object.assign(new Error(`Audit-Ereignis ${String(ctx.pathParams.id)} nicht gefunden.`), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
    return shape(ctx, PORT_SPEC.audit.getAuditEvent, {
      data: event,
      freshness: { state: "fresh", asOf: new Date().toISOString() },
    });
  },
};
