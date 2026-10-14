import type { AuditEvent } from "@jarvis/sdk";

/* ── Before/after diff (PLAN §41.3) ───────────────────────────────────── */

export type DiffKind = "added" | "removed" | "changed" | "unchanged";

export interface DiffEntry {
  path: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.set(prefix || "(Wert)", value);
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Key-level diff of the redacted before/after snapshots; `null` snapshots count as empty. */
export function diffSnapshots(before: Record<string, unknown> | null, after: Record<string, unknown> | null): DiffEntry[] {
  const left = new Map<string, unknown>();
  const right = new Map<string, unknown>();
  if (before) flatten(before, "", left);
  if (after) flatten(after, "", right);
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.localeCompare(b));
  return paths.map((path) => {
    const hasBefore = left.has(path);
    const hasAfter = right.has(path);
    const b = left.get(path);
    const a = right.get(path);
    const kind: DiffKind = !hasBefore ? "added" : !hasAfter ? "removed" : same(b, a) ? "unchanged" : "changed";
    return { path, kind, before: b, after: a };
  });
}

export function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/* ── Hash chain (PLAN §41.4) ──────────────────────────────────────────── */

export interface ChainCheck {
  /** Number of directly consecutive pairs whose `prevHash` matches the predecessor's `hash`. */
  linked: number;
  /** Sequence numbers of events whose `prevHash` does not match the previous event's hash. */
  broken: number[];
  /** Pairs that cannot be compared because events between them are not part of the loaded page. */
  gaps: number;
  total: number;
}

/**
 * Checks the visible part of the append-only chain: every event must reference the hash of its predecessor. Hash
 * recomputation needs the raw record and happens server-side; this only proves the links of what is on screen.
 */
export function checkChain(events: readonly AuditEvent[]): ChainCheck {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let linked = 0;
  let gaps = 0;
  const broken: number[] = [];
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1] as AuditEvent;
    const current = ordered[index] as AuditEvent;
    if (current.sequence !== previous.sequence + 1) {
      gaps += 1;
      continue;
    }
    if (current.prevHash === previous.hash) linked += 1;
    else broken.push(current.sequence);
  }
  return { linked, broken, gaps, total: ordered.length };
}

/** Short display form of a hash ("3fa9c1…b2d4"). */
export function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return hash.length <= 14 ? hash : `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}
