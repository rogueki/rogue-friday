import type { AuditEvent } from "@jarvis/sdk";
import { notFound } from "../../core/errors";
import { asIso, asList, clone, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import { checkEnum, pageOf, SEVERITIES, type Query } from "./shared";
import type { ChainVerification } from "../../core/audit-chain";

export type AuditListQuery = Query<"listAuditEvents">;
export type AuditExportFormat = "json" | "ndjson" | "csv";

const CATEGORIES = ["user_action", "agent_action", "tool_call", "approval", "system", "security"];
const RESULTS = ["success", "failure", "denied", "pending"];
const CSV_COLUMNS = [
  "id",
  "sequence",
  "occurredAt",
  "actorType",
  "actorId",
  "category",
  "action",
  "severity",
  "result",
  "agentId",
  "taskId",
  "tool",
  "adapterId",
  "model",
  "approvalId",
  "correlationId",
  "hash",
  "prevHash",
] as const;

export interface AuditExport {
  format: AuditExportFormat;
  contentType: string;
  fileName: string;
  events: AuditEvent[];
  /** Rendered body for ndjson/csv; absent for json (the transport wraps `events` in the list envelope). */
  text?: string;
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export class AuditService {
  constructor(private readonly w: MockWorld) {}

  private filtered(query: AuditListQuery): AuditEvent[] {
    const categories = asList(query.category);
    const severities = asList(query.severity);
    const results = asList(query.result);
    checkEnum("category", categories, CATEGORIES);
    checkEnum("severity", severities, SEVERITIES);
    checkEnum("result", results, RESULTS);
    const from = asIso(query.from, "from");
    const to = asIso(query.to, "to");
    return this.w.state.audit.filter((event) => {
      const at = Date.parse(event.occurredAt);
      if (from !== undefined && at < from) return false;
      if (to !== undefined && at > to) return false;
      if (query.actor && event.actor.id !== query.actor && event.actor.name !== query.actor) return false;
      if (query.agentId && event.agentId !== query.agentId) return false;
      if (query.taskId && event.taskId !== query.taskId) return false;
      if (query.tool && event.tool !== query.tool) return false;
      if (query.adapterId && event.adapterId !== query.adapterId) return false;
      if (query.action && !event.action.startsWith(query.action)) return false;
      if (categories.length && !categories.includes(event.category)) return false;
      if (severities.length && !severities.includes(event.severity)) return false;
      if (results.length && !results.includes(event.result)) return false;
      return true;
    });
  }

  /** Newest first. */
  list(query: AuditListQuery = {}): Page<AuditEvent> {
    return this.w.read("listAuditEvents", () => pageOf([...this.filtered(query)].reverse(), query));
  }

  get(id: string): AuditEvent {
    return this.w.read("getAuditEvent", () => {
      const event = this.w.state.audit.find((candidate) => candidate.id === id);
      if (!event) throw notFound("Audit-Ereignis", id);
      return clone(event);
    });
  }

  /** Chronological export (oldest first) as JSON lines, CSV or plain JSON. */
  export(query: { from?: string; to?: string; format?: AuditExportFormat } = {}): AuditExport {
    return this.w.read("exportAudit", () => {
      const format = query.format ?? "ndjson";
      checkEnum("format", [format], ["json", "ndjson", "csv"]);
      const events = clone(this.filtered({ ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) }));
      this.w.recordAudit({
        category: "security",
        action: "audit.exported",
        correlationId: this.w.correlationId(),
        adapterId: "mock-audit",
        context: { format, count: events.length },
      });
      if (format === "json") return { format, contentType: "application/json", fileName: "audit-export.json", events };
      if (format === "ndjson") {
        return { format, contentType: "application/x-ndjson", fileName: "audit-export.ndjson", events, text: events.map((event) => JSON.stringify(event)).join("\n") + "\n" };
      }
      const rows = events.map((event) =>
        [event.id, event.sequence, event.occurredAt, event.actor.type, event.actor.id, event.category, event.action, event.severity, event.result, event.agentId, event.taskId, event.tool, event.adapterId, event.model, event.approvalId, event.correlationId, event.hash, event.prevHash]
          .map(csvCell)
          .join(","),
      );
      return { format, contentType: "text/csv", fileName: "audit-export.csv", events, text: [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n" };
    });
  }

  verifyChain(): ChainVerification {
    return this.w.verifyAudit();
  }
}
