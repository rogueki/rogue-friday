import { appendToChain, GENESIS_HASH, verifyChain } from "@jarvis/observability";
import type { Actor, AuditEvent } from "@jarvis/sdk";
import type { Db } from "./database";
import { newAuditId } from "../util/ids";

export type AuditDraft = Pick<
  AuditEvent,
  "category" | "action" | "severity" | "result" | "correlationId"
> &
  Partial<
    Pick<
      AuditEvent,
      | "occurredAt"
      | "durationMs"
      | "artifactIds"
      | "childEventIds"
      | "before"
      | "after"
      | "errorCode"
      | "agentId"
      | "taskId"
      | "tool"
      | "adapterId"
      | "model"
      | "approvalId"
      | "context"
    >
  > & {
    actor: Actor;
  };

interface AuditRow {
  seq: number;
  json: string;
  prev_hash: string;
  hash: string;
}

export interface AuditVerification {
  valid: boolean;
  length: number;
  headHash: string | null;
  brokenAtSequence?: number;
  reason?: string;
  checkedAt: string;
}

/**
 * Append-only control-plane audit trail with a SHA-256 hash chain (PLAN §41.4). Rows are never updated or deleted by the
 * application; `verify()` re-computes the whole chain and pinpoints the first modified, reordered or deleted row.
 */
export class AuditStore {
  private head: string | null;
  private sequence: number;

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {
    const last = db.prepare("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as
      | { seq: number; hash: string }
      | undefined;
    this.head = last?.hash ?? null;
    this.sequence = last?.seq ?? 0;
  }

  /** Appends one event and returns the complete, hash-sealed AuditEvent (shape of `jarvis.audit.appended`). */
  append(draft: AuditDraft): AuditEvent {
    const occurredAt = draft.occurredAt ?? this.now().toISOString();
    const prevHash = this.head ?? GENESIS_HASH;
    const { actor, ...rest } = draft;
    const unsigned = {
      ...rest,
      actor,
      id: newAuditId(),
      version: 1,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      source: { adapterId: "control-api", system: "control-api", lastSyncedAt: occurredAt },
      sequence: this.sequence + 1,
      occurredAt,
      durationMs: draft.durationMs ?? null,
      before: draft.before ?? null,
      after: draft.after ?? null,
      artifactIds: draft.artifactIds ?? [],
      childEventIds: draft.childEventIds ?? [],
      prevHash: this.head,
    };
    const entry = appendToChain(this.head, unsigned);
    const event = { ...unsigned, hash: entry.hash } as unknown as AuditEvent;
    const result = this.db
      .prepare(
        "INSERT INTO audit_log (id, occurred_at, correlation_id, category, action, json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(event.id, occurredAt, event.correlationId, event.category, event.action, JSON.stringify(unsigned), prevHash, entry.hash);
    const rowId = Number(result.lastInsertRowid);
    if (rowId !== unsigned.sequence) throw new Error(`Audit sequence drift: expected ${unsigned.sequence}, got ${rowId}`);
    this.sequence = rowId;
    this.head = entry.hash;
    return event;
  }

  verify(): AuditVerification {
    const rows = this.db.prepare("SELECT seq, json, prev_hash, hash FROM audit_log ORDER BY seq").all() as unknown as AuditRow[];
    const checkedAt = this.now().toISOString();
    const entries = rows.map((row) => ({ event: JSON.parse(row.json) as unknown, prevHash: row.prev_hash, hash: row.hash }));
    const result = verifyChain(entries);
    if (result.valid) return { valid: true, length: rows.length, headHash: rows.length ? result.headHash : null, checkedAt };
    const broken = rows[result.index];
    return {
      valid: false,
      length: rows.length,
      headHash: null,
      ...(broken ? { brokenAtSequence: broken.seq } : {}),
      reason: result.reason,
      checkedAt,
    };
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
  }

  headHash(): string | null {
    return this.head;
  }

  /** Newest first; for diagnostics and tests. */
  recent(limit = 50): AuditEvent[] {
    const rows = this.db.prepare("SELECT json, hash FROM audit_log ORDER BY seq DESC LIMIT ?").all(limit) as Array<{
      json: string;
      hash: string;
    }>;
    return rows.map((row) => ({ ...(JSON.parse(row.json) as Omit<AuditEvent, "hash">), hash: row.hash }) as AuditEvent);
  }
}
