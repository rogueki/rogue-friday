import type { AuditEvent } from "@friday/sdk";
import type { Db } from "../db/database";

export interface AuditTrailQuery {
  from?: string;
  to?: string;
  actor?: string;
  agentId?: string;
  taskId?: string;
  tool?: string;
  adapterId?: string;
  action?: string;
  category?: string[];
  severity?: string[];
  result?: string[];
  limit?: number;
  cursor?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type Row = { json: string; seq: number; prev_hash: string | null; hash: string };

function clauseFor(query: AuditTrailQuery): { clause: string; params: Array<string | number> } {
  const parts: string[] = [];
  const params: Array<string | number> = [];
  const push = (sql: string, ...values: Array<string | number>) => {
    parts.push(sql);
    params.push(...values);
  };
  if (query.from) push("occurred_at >= ?", query.from);
  if (query.to) push("occurred_at <= ?", query.to);
  if (query.actor) push("json_extract(json, '$.actor.id') = ?", query.actor);
  if (query.agentId) push("json_extract(json, '$.agentId') = ?", query.agentId);
  if (query.taskId) push("json_extract(json, '$.taskId') = ?", query.taskId);
  if (query.tool) push("json_extract(json, '$.tool') = ?", query.tool);
  if (query.adapterId) push("json_extract(json, '$.adapterId') = ?", query.adapterId);
  if (query.action) push("action LIKE ?", `${query.action}%`);
  for (const [values, column] of [
    [query.category, "category"],
    [query.severity, "json_extract(json, '$.severity')"],
    [query.result, "json_extract(json, '$.result')"],
  ] as const) {
    if (values && values.length > 0) {
      push(`${column} IN (${values.map(() => "?").join(",")})`, ...values);
    }
  }
  return { clause: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

function toEvent(row: Row): AuditEvent {
  // The chain lives in its own columns; the stored JSON is the unsigned record.
  return { ...(JSON.parse(row.json) as AuditEvent), prevHash: row.prev_hash, hash: row.hash };
}

export function auditTrailPage(
  db: Db,
  query: AuditTrailQuery = {},
): { items: AuditEvent[]; pageInfo: { nextCursor: string | null; hasNextPage: boolean }; freshness: { state: "fresh"; asOf: string } } {
  const filter = clauseFor(query);
  const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));
  const offset = Math.max(0, Number(String(query.cursor ?? "").replace(/^s/, "") || 0));
  const rows = db
    .prepare(`SELECT seq, json, prev_hash, hash FROM audit_log ${filter.clause} ORDER BY seq DESC LIMIT ? OFFSET ?`)
    .all(...(filter.params as never[]), limit + 1, offset) as unknown as Row[];
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? `s${offset + limit}` : null;
  return {
    items: page.map(toEvent),
    pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
    freshness: { state: "fresh", asOf: new Date().toISOString() },
  };
}

export function auditTrailEvent(db: Db, id: string): AuditEvent | undefined {
  const row = db.prepare("SELECT seq, json, prev_hash, hash FROM audit_log WHERE id = ?").get(id) as Row | undefined;
  return row ? toEvent(row) : undefined;
}