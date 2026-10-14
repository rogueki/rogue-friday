import { createHash } from 'node:crypto';

/** Hash that anchors the first entry of a chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** Deterministic JSON: object keys sorted recursively, `undefined` properties dropped (like JSON.stringify). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  const withJson = value as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === 'function') return sortKeys(withJson.toJSON());
  if (Array.isArray(value)) return value.map((item) => sortKeys(item));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) out[key] = sortKeys(child);
  }
  return out;
}

/** SHA-256 over `prevHash`, a newline and the canonical JSON of the event (hex). */
export function computeAuditHash(prevHash: string, canonicalEventJson: string): string {
  return createHash('sha256').update(prevHash, 'utf8').update('\n', 'utf8').update(canonicalEventJson, 'utf8').digest('hex');
}

export interface AuditChainEntry<T = unknown> {
  event: T;
  prevHash: string;
  hash: string;
}

/** Builds the next chain entry for `event` after the entry with hash `prevHash`. */
export function appendToChain<T>(prevHash: string | null | undefined, event: T): AuditChainEntry<T> {
  const previous = prevHash ?? GENESIS_HASH;
  return { event, prevHash: previous, hash: computeAuditHash(previous, canonicalJson(event)) };
}

export type ChainVerification =
  | { valid: true; length: number; headHash: string }
  | { valid: false; index: number; reason: 'prev_hash_mismatch' | 'hash_mismatch'; expected: string; actual: string };

/** Verifies linkage and content hashes of an ordered chain (oldest first). */
export function verifyChain(entries: readonly AuditChainEntry[], genesisHash: string = GENESIS_HASH): ChainVerification {
  let expectedPrev = genesisHash;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.prevHash !== expectedPrev) {
      return { valid: false, index, reason: 'prev_hash_mismatch', expected: expectedPrev, actual: entry.prevHash };
    }
    const recomputed = computeAuditHash(entry.prevHash, canonicalJson(entry.event));
    if (recomputed !== entry.hash) {
      return { valid: false, index, reason: 'hash_mismatch', expected: recomputed, actual: entry.hash };
    }
    expectedPrev = entry.hash;
  }
  return { valid: true, length: entries.length, headHash: expectedPrev };
}
