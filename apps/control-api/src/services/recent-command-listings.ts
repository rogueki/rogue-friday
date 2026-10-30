import { createHash } from "node:crypto";

export type ListingKind = "tasks" | "calendar";

const TTL_MS = 5 * 60_000;
const MAX_SESSIONS = 200;

interface Entry { kind: ListingKind; ids: string[]; expiresAt: number }

/**
 * Ids a read command just listed to one owner session, so a follow-up such as "markiere die zweite als erledigt" can
 * name them. Process-local and short-lived on purpose: only ids, never titles or content; after a restart Friday
 * simply asks again.
 */
export class RecentCommandListings {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  private key(ownerId: string, sessionId: string): string {
    return createHash("sha256").update(`${ownerId}\n${sessionId}`).digest("hex");
  }

  remember(ownerId: string, sessionId: string, kind: ListingKind, ids: readonly string[]): void {
    const key = this.key(ownerId, sessionId);
    this.entries.delete(key);
    if (ids.length === 0) return;
    if (this.entries.size >= MAX_SESSIONS) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { kind, ids: [...ids], expiresAt: this.now() + TTL_MS });
  }

  /** A newer read of anything else replaces the listing, so "die erste" never points at an older list. */
  clear(ownerId: string, sessionId: string): void {
    this.entries.delete(this.key(ownerId, sessionId));
  }

  /** Which kind of items this session was shown last, so a bare "den zweiten" goes to that domain. */
  kind(ownerId: string, sessionId: string): ListingKind | null {
    const key = this.key(ownerId, sessionId);
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) return null;
    return entry.kind;
  }

  read(ownerId: string, sessionId: string, kind: ListingKind): readonly string[] | null {
    const key = this.key(ownerId, sessionId);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.kind === kind ? entry.ids : null;
  }
}
