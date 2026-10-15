import { appendToChain, GENESIS_HASH, verifyChain } from "@friday/observability";
import type { Actor, AuditEvent } from "@friday/sdk";
import type { AuditAnchor, AnchorRead, AnchorRecord } from "./audit-anchor";
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

/** `reason` values of `verify()` that come from the head anchor (the chain itself is consistent). */
export const ANCHOR_REASONS = ["truncated", "head_mismatch", "anchor_tampered"] as const;

/**
 * Append-only control-plane audit trail with a SHA-256 hash chain (PLAN §41.4). Rows are never updated or deleted by the
 * application; `verify()` re-computes the whole chain and pinpoints the first modified, reordered or deleted row.
 */
export class AuditStore {
  private head: string | null;
  private sequence: number;
  private length: number;

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    /** Remembers the chain head outside `audit_log` so a truncated tail is detected (see `AuditAnchor`). */
    private readonly anchor?: AuditAnchor,
  ) {
    const last = db.prepare("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as
      | { seq: number; hash: string }
      | undefined;
    this.head = last?.hash ?? null;
    this.sequence = last?.seq ?? 0;
    this.length = this.count();
  }

  /** Appends one event and returns the complete, hash-sealed AuditEvent (shape of `friday.audit.appended`). */
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
    this.length += 1;
    this.anchor?.write({ length: this.length, hash: entry.hash });
    return event;
  }

  verify(): AuditVerification {
    const rows = this.db.prepare("SELECT seq, json, prev_hash, hash FROM audit_log ORDER BY seq").all() as unknown as AuditRow[];
    const checkedAt = this.now().toISOString();
    const entries = rows.map((row) => ({ event: JSON.parse(row.json) as unknown, prevHash: row.prev_hash, hash: row.hash }));
    const result = verifyChain(entries);
    if (!result.valid) {
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
    const anchored = this.checkAnchor(rows);
    if (anchored) return { valid: false, length: rows.length, headHash: null, brokenAtSequence: anchored.brokenAtSequence, reason: anchored.reason, checkedAt };
    return { valid: true, length: rows.length, headHash: rows.length ? result.headHash : null, checkedAt };
  }

  /**
   * Compares a consistent chain with its anchors. A chain shorter than an anchor was truncated at the tail; a different hash
   * at the anchored position means the history was rewritten (or an older database was restored). A chain that is longer
   * than the anchor is normal (a crash between the insert and the anchor write) and re-anchors itself; missing anchors are
   * recreated from the chain (first start after an upgrade).
   */
  private checkAnchor(rows: readonly AuditRow[]): { reason: (typeof ANCHOR_REASONS)[number]; brokenAtSequence: number } | null {
    if (!this.anchor) return null;
    const reads = this.anchor.read();
    const states: AnchorRead[] = [reads.file, reads.db];
    if (states.some((state) => state.state === "invalid")) return { reason: "anchor_tampered", brokenAtSequence: rows.at(-1)?.seq ?? 0 };
    const records = states.flatMap((state) => (state.state === "ok" ? [state.record] : []));
    for (const record of records) {
      if (record.length > rows.length) return { reason: "truncated", brokenAtSequence: (rows.at(-1)?.seq ?? 0) + 1 };
      if (record.length > 0) {
        const at = rows[record.length - 1];
        if (at?.hash !== record.hash) return { reason: "head_mismatch", brokenAtSequence: at?.seq ?? 0 };
      }
    }
    const last = rows.at(-1);
    if (last) {
      const current: AnchorRecord = { length: rows.length, hash: last.hash };
      const upToDate = (state: AnchorRead): boolean => state.state === "ok" && state.record.length === current.length;
      if (!upToDate(reads.file) || !upToDate(reads.db)) this.anchor.write(current);
    }
    return null;
  }

  /**
   * Re-seals the head anchors with the current server key after `auth.key` was lost and regenerated. The anchors are
   * HMACs under a key derived from it, so they can no longer be read; the stored data is unaffected. Only done when the
   * chain itself verifies (a broken chain stays reported). Returns whether the anchors were rewritten.
   */
  reanchorAfterKeyLoss(): boolean {
    if (!this.anchor) return false;
    const rows = this.db.prepare("SELECT seq, json, prev_hash, hash FROM audit_log ORDER BY seq").all() as unknown as AuditRow[];
    if (rows.length === 0) return false;
    const result = verifyChain(rows.map((row) => ({ event: JSON.parse(row.json) as unknown, prevHash: row.prev_hash, hash: row.hash })));
    if (!result.valid) return false;
    this.anchor.write({ length: rows.length, hash: (rows.at(-1) as AuditRow).hash });
    return true;
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
