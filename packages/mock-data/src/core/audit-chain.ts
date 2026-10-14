import type { AuditEvent, SourceDescriptor } from "@jarvis/sdk";
import { sha256Hex } from "./sha256";
import { canonicalJson } from "./util";

export type AuditDraft = Omit<
  AuditEvent,
  "id" | "version" | "createdAt" | "updatedAt" | "source" | "sequence" | "hash" | "prevHash"
>;

export interface AuditAppendContext {
  id: string;
  sequence: number;
  source: SourceDescriptor;
  prevHash: string | null;
}

/** Hash over every field except `hash` itself; `prevHash` is part of the input, which chains the records. */
export function computeAuditHash(event: Omit<AuditEvent, "hash">): string {
  return sha256Hex(canonicalJson(event));
}

export function createAuditEvent(draft: AuditDraft, context: AuditAppendContext): AuditEvent {
  const unsigned: Omit<AuditEvent, "hash"> = {
    ...draft,
    id: context.id,
    version: 1,
    createdAt: draft.occurredAt,
    updatedAt: draft.occurredAt,
    source: context.source,
    sequence: context.sequence,
    prevHash: context.prevHash,
  };
  return { ...unsigned, hash: computeAuditHash(unsigned) };
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  /** Index of the first broken record. */
  brokenAt?: number;
  reason?: string;
}

export function verifyAuditChain(events: readonly AuditEvent[]): ChainVerification {
  let prevHash: string | null = null;
  for (let index = 0; index < events.length; index++) {
    const event = events[index] as AuditEvent;
    if (event.prevHash !== prevHash) return { valid: false, checked: index, brokenAt: index, reason: "prevHash passt nicht zum Vorgänger" };
    const { hash, ...rest } = event;
    if (computeAuditHash(rest) !== hash) return { valid: false, checked: index, brokenAt: index, reason: "Hash stimmt nicht mit dem Inhalt überein" };
    prevHash = hash;
  }
  return { valid: true, checked: events.length };
}
