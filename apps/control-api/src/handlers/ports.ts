import { Readable } from "node:stream";
import { PORT_SPEC, collectSources, type FileDownload, type MethodSpec, type PortCategory } from "@jarvis/adapter-core";
import { CONTRACT_VERSION, type AuditEvent } from "@jarvis/sdk";
import type { Handler, HandlerResult, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";

type PortFunction = (params: unknown, call: unknown) => Promise<unknown>;

/** Path parameters plus either the validated query (reads) or the body (writes), as the port methods expect them. */
function portParams(ctx: RequestContext): Record<string, unknown> {
  const params: Record<string, unknown> = { ...ctx.pathParams };
  if (ctx.spec.method === "GET") {
    for (const [key, value] of Object.entries(ctx.query)) if (value !== undefined) params[key] = value;
  } else if (ctx.body !== undefined) {
    params.body = ctx.body;
  }
  return params;
}

function successStatus(ctx: RequestContext): number {
  return ctx.spec.responses.find((response) => response.status >= 200 && response.status < 300)?.status ?? 200;
}

function locationOf(ctx: RequestContext, data: unknown): string | undefined {
  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === "string" ? `${ctx.spec.path}/${id}` : undefined;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const AUDIT_CSV_COLUMNS = [
  "id", "sequence", "occurredAt", "actorType", "actorId", "category", "action", "severity", "result", "agentId", "taskId",
  "tool", "adapterId", "model", "approvalId", "correlationId", "hash", "prevHash",
] as const;

export function renderAuditExport(events: readonly AuditEvent[], format: string): { contentType: string; text: string; fileName: string } {
  if (format === "csv") {
    const rows = events.map((event) =>
      [event.id, event.sequence, event.occurredAt, event.actor.type, event.actor.id, event.category, event.action, event.severity, event.result,
        event.agentId, event.taskId, event.tool, event.adapterId, event.model, event.approvalId, event.correlationId, event.hash, event.prevHash]
        .map(csvCell)
        .join(","),
    );
    return { contentType: "text/csv; charset=utf-8", text: `${[AUDIT_CSV_COLUMNS.join(","), ...rows].join("\n")}\n`, fileName: "audit-export.csv" };
  }
  return {
    contentType: "application/x-ndjson; charset=utf-8",
    text: events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : ""),
    fileName: "audit-export.ndjson",
  };
}

function shape(ctx: RequestContext, spec: MethodSpec, result: unknown): HandlerResult {
  const status = successStatus(ctx);
  const value = result as Record<string, unknown>;
  switch (spec.result.kind) {
    case "page": {
      if (ctx.spec.operationId === "exportAudit") {
        const format = String(ctx.query.format ?? "ndjson");
        const events = value.items as AuditEvent[];
        if (format !== "json") {
          const rendered = renderAuditExport(events, format);
          return { status, raw: { contentType: rendered.contentType, data: rendered.text, disposition: `attachment; filename="${rendered.fileName}"` } };
        }
      }
      return {
        status,
        body: {
          contractVersion: CONTRACT_VERSION,
          items: value.items,
          pageInfo: value.pageInfo,
          freshness: value.freshness,
          sources: value.sources ?? collectSources(value.items),
        },
      };
    }
    case "hits":
      return {
        status,
        body: { contractVersion: CONTRACT_VERSION, items: value.items, freshness: value.freshness, sources: value.sources ?? collectSources(value.items) },
      };
    case "single": {
      const location = status === 201 ? locationOf(ctx, value.data) : undefined;
      return {
        status,
        body: { contractVersion: CONTRACT_VERSION, data: value.data, freshness: value.freshness },
        ...(location ? { headers: { Location: location } } : {}),
      };
    }
    case "action":
      return { status, body: { contractVersion: CONTRACT_VERSION, ...value } };
    case "flat":
      return { status, body: { contractVersion: CONTRACT_VERSION, ...value } };
    case "delete-file": {
      if (value.kind === "approval_required") {
        const approval = value.approval as { data: unknown; freshness: unknown };
        return { status: 202, body: { contractVersion: CONTRACT_VERSION, data: approval.data, freshness: approval.freshness } };
      }
      const { kind: _kind, ...outcome } = value;
      return { status: 200, body: { contractVersion: CONTRACT_VERSION, ...outcome } };
    }
    case "raw": {
      const download = result as FileDownload;
      const data = download.body instanceof Uint8Array ? download.body : Readable.fromWeb(download.body as never);
      const asciiName = download.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      return {
        status,
        raw: {
          contentType: download.contentType,
          data,
          disposition: `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(download.filename)}`,
        },
      };
    }
  }
}

export function portHandler(category: PortCategory, method: string, spec: MethodSpec): Handler {
  return async (ctx) => {
    const port = ctx.runtime.registry.getPort(category) as unknown as Record<string, PortFunction | undefined>;
    const fn = port[method];
    if (!fn) throw new Error(`Port ${category}.${method} fehlt`);
    const call = spec.mutating ? ctx.mutation : ctx.call;
    const result = await fn.call(port, portParams(ctx), call);
    return shape(ctx, spec, result);
  };
}

/** One handler per port-backed operation, derived from `PORT_SPEC` so contract and ports cannot drift apart. */
export function buildPortHandlers(): Map<OperationId, Handler> {
  const handlers = new Map<OperationId, Handler>();
  for (const [category, methods] of Object.entries(PORT_SPEC) as Array<[PortCategory, Record<string, MethodSpec>]>) {
    for (const [method, spec] of Object.entries(methods)) {
      handlers.set(spec.operationId, portHandler(category, method, spec));
    }
  }
  return handlers;
}
